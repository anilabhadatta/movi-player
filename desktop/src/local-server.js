/**
 * Local HTTP server for the MoviPlayer desktop shell.
 *
 * Why a server instead of file:// ?
 *   The player's FFmpeg-WASM demuxer uses SharedArrayBuffer, which the
 *   browser only hands out to a *cross-origin-isolated* document. That
 *   requires the top-level document to be served with COOP+COEP headers
 *   over a secure context. file:// is neither isolated nor lets us set
 *   headers, so we serve everything from 127.0.0.1 — which Chromium treats
 *   as a secure context — with the exact same headers production uses.
 *
 * Three roles, all same-origin (so COEP never blocks them):
 *   /            renderer shell + bundled element.js (static)
 *   /_local?p=   stream an OS-opened local file, with HTTP Range support
 *   /_proxy?url= stream a remote URL, with Range pass-through (no CORS limits)
 */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

// Best-effort content types for streamed media. The player sniffs the
// container itself, so these are advisory only.
const MEDIA_MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".flv": "video/x-flv",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".m4b": "audio/mp4",
  ".mka": "audio/x-matroska",
};

// COOP/COEP make the document cross-origin isolated → SharedArrayBuffer.
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

function mediaType(p) {
  return MEDIA_MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}

/**
 * Stream a readable byte range to the response, honouring the Range header.
 * Works for both local files (statSize + createReadStream) and is reused by
 * the proxy via its own path.
 */
function streamLocalFile(req, res, filePath, size, contentType) {
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === "" ? null : parseInt(m[1], 10);
      let end = m[2] === "" ? null : parseInt(m[2], 10);

      if (start === null) {
        // suffix range: last N bytes
        start = Math.max(0, size - (end || 0));
        end = size - 1;
      } else if (end === null || end >= size) {
        end = size - 1;
      }

      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}`, ...baseHeaders });
        return res.end();
      }

      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...baseHeaders, "Content-Length": size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

async function handleStatic(req, res, pathname, rendererDir) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(rendererDir, rel));

  // Path-traversal guard: stay inside the renderer directory.
  if (!filePath.startsWith(path.normalize(rendererDir + path.sep)) && filePath !== path.normalize(path.join(rendererDir, "index.html"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    res.writeHead(404);
    return res.end("Not Found");
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    ...ISOLATION_HEADERS,
    "Content-Type": type,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function handleLocal(req, res, url, isLocalAllowed) {
  const p = url.searchParams.get("p");
  if (!p || !isLocalAllowed(p)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  let stat;
  try {
    stat = await fsp.stat(p);
  } catch {
    res.writeHead(404);
    return res.end("Not Found");
  }
  streamLocalFile(req, res, p, stat.size, mediaType(p));
}

async function handleProxy(req, res, url) {
  const target = url.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400);
    return res.end("Bad target");
  }

  const fwd = {};
  if (req.headers.range) fwd["Range"] = req.headers.range;
  fwd["User-Agent"] = req.headers["user-agent"] || "MoviPlayer-Desktop";

  let upstream;
  try {
    upstream = await fetch(target, { headers: fwd, redirect: "follow", method: req.method === "HEAD" ? "HEAD" : "GET" });
  } catch (err) {
    res.writeHead(502);
    return res.end("Upstream fetch failed: " + err.message);
  }

  const out = {
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  const cl = upstream.headers.get("content-length");
  if (cl) out["Content-Length"] = cl;
  const cr = upstream.headers.get("content-range");
  if (cr) out["Content-Range"] = cr;
  // Forward Content-Disposition so the player can read the real filename for
  // its title (its priority-2 title source), not just the URL basename.
  const cd = upstream.headers.get("content-disposition");
  if (cd) out["Content-Disposition"] = cd;

  res.writeHead(upstream.status, out);
  if (req.method === "HEAD" || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res).on("error", () => res.end());
}

/**
 * @param {{ rendererDir: string, isLocalAllowed: (absPath: string) => boolean }} opts
 */
function createLocalServer({ rendererDir, isLocalAllowed }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      // A trailing /<filename> segment may be present purely to give the
      // player a clean title; the real args live in the query string.
      if (pathname === "/_proxy" || pathname.startsWith("/_proxy/")) return await handleProxy(req, res, url);
      if (pathname === "/_local" || pathname.startsWith("/_local/")) return await handleLocal(req, res, url, isLocalAllowed);
      return await handleStatic(req, res, pathname, rendererDir);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500);
      res.end("Server error: " + err.message);
    }
  });
}

module.exports = { createLocalServer };
