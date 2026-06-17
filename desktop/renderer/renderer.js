/**
 * Renderer wiring for the MoviPlayer desktop shell.
 *
 * Media reaches <movi-player> by source:
 *   drag & drop  → File object → player.setFile()      (zero-copy)
 *   pick / recent / OS open-with → path → /_local?p=…   (range-streamed)
 *   URL bar      → /_proxy?url=…                         (range pass-through)
 */
const player = document.getElementById("player");
const welcome = document.getElementById("welcome");
const dropzone = document.getElementById("dropzone");
const urlForm = document.getElementById("url-form");
const urlInput = document.getElementById("url-input");
const dropOverlay = document.getElementById("drop-overlay");
const toast = document.getElementById("toast");
const recentsSection = document.getElementById("recents");
const recentsList = document.getElementById("recents-list");
const recentsClear = document.getElementById("recents-clear");

document.body.classList.add(
  window.movi.platform === "darwin" ? "mac" : window.movi.platform === "win32" ? "win" : "linux"
);

// Carry the real filename as a throwaway path segment. The player derives its
// title fallback from the URL's basename, so without this it would read
// "_local"/"_proxy" (→ "Local"/"Proxy"). The EMBEDDED container title still
// wins — the element only falls back to this filename when the media carries
// no title metadata. The query (?p= / ?url=) is what the server actually reads.
const baseName = (p) => String(p).split(/[?#]/)[0].split(/[\\/]/).pop() || String(p);
const localSrc = (p) => `/_local/${encodeURIComponent(baseName(p))}?p=${encodeURIComponent(p)}`;
const proxySrc = (u) => `/_proxy/${encodeURIComponent(baseName(u))}?url=${encodeURIComponent(u)}`;

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 4000);
}

function prime() {
  welcome.style.display = "none";
  player.hidden = false;
  player.setAttribute("autoplay", "");
}
function loadSrc(src) {
  prime();
  player.src = src;
}
async function loadFile(file) {
  prime();
  // Prefer loading by path (via the local server) so the file also works in
  // the PiP window and lands in Recents. Fall back to a zero-copy File when the
  // path isn't available (then PiP isn't possible for that source).
  const fp = window.movi.pathForFile(file);
  if (fp) {
    try { await window.movi.grant([fp]); } catch {}
    player.src = localSrc(fp);
  } else if (typeof player.setFile === "function") {
    player.setFile(file);
  } else {
    player.src = file;
  }
}
function loadPaths(paths) {
  if (!paths || !paths.length) return;
  loadSrc(localSrc(paths[0]));
  if (paths.length > 1) showToast(`Playing 1 of ${paths.length} — playlist is coming`);
}

// ---------- Recents ----------
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

async function refreshRecents() {
  let items = [];
  try {
    items = (await window.movi.getRecents()) || [];
  } catch {
    items = [];
  }
  recentsList.replaceChildren();
  if (!items.length) {
    recentsSection.hidden = true;
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recent";
    btn.title = it.path;

    const ext = document.createElement("span");
    ext.className = "recent-ext";
    ext.textContent = (it.ext || "FILE").toUpperCase();

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = it.name;

    const meta = document.createElement("span");
    meta.className = "recent-meta";
    meta.textContent = fmtSize(it.size);

    btn.append(ext, name, meta);
    btn.addEventListener("click", () => window.movi.openRecent(it.path));
    li.append(btn);
    recentsList.append(li);
  }
  recentsSection.hidden = false;
}

recentsClear.addEventListener("click", async () => {
  await window.movi.clearRecents();
  refreshRecents();
});

// ---------- UI events ----------
urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const u = urlInput.value.trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) return showToast("Enter a full http(s):// link");
  loadSrc(proxySrc(u));
  urlInput.blur();
});

const pickFile = () => window.movi.openDialog();
dropzone.addEventListener("click", pickFile);
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickFile();
  }
});

// ---------- Drag & drop (anywhere) ----------
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add("active");
  document.body.classList.add("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay.classList.remove("active");
    document.body.classList.remove("dragging");
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove("active");
  document.body.classList.remove("dragging");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// Surface player errors instead of failing silently
player.addEventListener("error", (e) => {
  const msg = (e && e.detail && (e.detail.message || e.detail)) || "Couldn't play that file";
  showToast(String(msg));
});

// ---------- Wires from main ----------
window.movi.onLoadPaths(loadPaths);
window.movi.onFocusUrl(() => {
  urlInput.focus();
  urlInput.select();
});
window.movi.onFullscreen((on) => document.body.classList.toggle("osfs", on));

// The player's shadow root is open, so patch desktop-only things into it.
function patchPlayerShadow(attempt = 0) {
  const sr = player.shadowRoot;
  if (!sr) {
    if (attempt < 20) setTimeout(() => patchPlayerShadow(attempt + 1), 100);
    return;
  }

  // macOS full-bleed: push the title below the traffic lights (no window strip).
  if (window.movi.platform === "darwin" && !sr.querySelector("#movi-desktop-patches")) {
    const style = document.createElement("style");
    style.id = "movi-desktop-patches";
    style.textContent = ":host(:not(:fullscreen)) .movi-title-bar { padding-top: 46px; }";
    sr.appendChild(style);
  }

  // Document PiP doesn't render in Electron, so route the built-in PiP button
  // to our native always-on-top PiP window instead. Intercept in the capture
  // phase to pre-empt the element's own (no-op) Document-PiP handler.
  if (!sr.__moviPipHooked) {
    sr.__moviPipHooked = true;
    sr.addEventListener(
      "click",
      (e) => {
        const onPip = e.composedPath().some((el) => el.classList && el.classList.contains("movi-pip-btn"));
        if (!onPip) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        openPip();
      },
      true
    );
  }
}
patchPlayerShadow();

// ---------- Native Picture-in-Picture ----------
let pipWasPlaying = false;
function openPip() {
  const src = player.src;
  if (typeof src !== "string" || !src) {
    showToast("Picture-in-Picture isn't available for this source");
    return;
  }
  pipWasPlaying = !player.paused;
  window.movi.pipOpen({ src, time: player.currentTime || 0, playing: pipWasPlaying });
}

// The built-in "p" shortcut calls the element's Document PiP (dead in Electron).
// Intercept it in the capture phase (before the element's own keydown handler)
// and route to our native PiP instead.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "p" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!e.composedPath().includes(player)) return; // only when the player is focused
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPip();
  },
  true
);
window.movi.onPipActive(() => {
  try { player.pause(); } catch {}
});
window.movi.onPipClosed((state) => {
  const t = (state && state.time) || 0;
  const src = state && state.src;
  const resume = () => {
    if (t > 0) { try { player.currentTime = t; } catch {} }
    if (pipWasPlaying) { try { player.play(); } catch {} }
  };
  const apply = () => {
    if (src && src !== player.src) {
      // PiP switched to a different file — bring it back to the main window.
      prime();
      player.src = src;
      let n = 0;
      const iv = setInterval(() => {
        if (++n > 100) return clearInterval(iv);
        if (player.duration > 0) { clearInterval(iv); resume(); }
      }, 100);
    } else {
      resume();
    }
  };
  // The window was hidden during PiP. Reloading before it's actually visible
  // leaves the player's snapshot-poster / deferred-load half-applied, so the
  // controls never re-enable. Wait until we're visible, then apply.
  if (document.visibilityState === "visible") {
    requestAnimationFrame(apply);
  } else {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      document.removeEventListener("visibilitychange", onVis);
      requestAnimationFrame(apply);
    };
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    setTimeout(run, 800); // fallback if the event never arrives
  }
});

refreshRecents();
window.movi.ready();
