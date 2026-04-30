const vscode = acquireVsCodeApi();

// Wire log buffer to extension Output channel
if (typeof window.__moviSetLogForward === "function") {
  window.__moviSetLogForward((entry) => {
    try { vscode.postMessage({ type: "log", entry }); } catch {}
  });
}

// Enable verbose logging in movi-player so fullscreen + decoder paths trace
import("./dist/element.js").then((mod) => {
  try {
    if (mod.Logger && mod.LogLevel) {
      mod.Logger.setLevel(mod.LogLevel.DEBUG);
      console.info("[Movi] Logger set to DEBUG");
    }
  } catch (e) { console.warn("[Movi] Could not enable Logger:", e); }
}).catch(() => {});

// Surface fullscreen API behavior so we can see WHY clicks fail
document.addEventListener("fullscreenchange", () => {
  console.info("[Movi] fullscreenchange — element:", document.fullscreenElement && document.fullscreenElement.tagName);
});
document.addEventListener("fullscreenerror", (e) => {
  console.error("[Movi] fullscreenerror:", e.type, "target:", e.target && e.target.tagName);
  // Fallback path (e.g. double-tap gesturefs) — primary paths (button
  // click, 'f' key) are intercepted in capture phase below before they
  // ever reach the player's toggleFullscreen.
  sendFullscreen();
});

// Debounce so capture-intercept + fullscreenerror fallback can't double-fire.
let _lastFullscreenAt = 0;
let _inMoviFullscreen = false;
let _fullscreenDisabled = false;
function sendFullscreen() {
  if (_fullscreenDisabled) return;
  const now = Date.now();
  if (now - _lastFullscreenAt < 300) return;
  _lastFullscreenAt = now;

  // Skip the confirm dialog on EXIT — only ask before entering fullscreen.
  if (_inMoviFullscreen) {
    _inMoviFullscreen = false;
    try { vscode.postMessage({ type: "fullscreen" }); } catch {}
    return;
  }

  showFullscreenConfirm().then((ok) => {
    if (!ok) return;
    _inMoviFullscreen = true;
    try { vscode.postMessage({ type: "fullscreen" }); } catch {}
  });
}

function showFullscreenConfirm() {
  return new Promise((resolve) => {
    const overlay = document.getElementById("fsConfirmOverlay");
    const continueBtn = document.getElementById("fsConfirmContinue");
    const cancelBtn = document.getElementById("fsConfirmCancel");
    if (!overlay || !continueBtn || !cancelBtn) return resolve(true);

    function cleanup(answer) {
      overlay.classList.add("hidden");
      continueBtn.removeEventListener("click", onContinue);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    }
    function onContinue() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cleanup(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cleanup(true); }
    }

    continueBtn.addEventListener("click", onContinue);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey, true);
    overlay.classList.remove("hidden");
    setTimeout(() => continueBtn.focus(), 0);
  });
}

// Capture-phase 'f' interceptor — fires before the player's keydown handler
// or our document-level forwarder, so the player never sees the keypress
// and never attempts requestFullscreen (which would fail with a permissions
// error AND leave the player's internal fullscreen state inconsistent).
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (e.code === "KeyF" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    sendFullscreen();
  }
}, true);

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingName = document.getElementById("loadingName");

function showLoading(name) {
  if (loadingName) loadingName.textContent = name || "";
  loadingOverlay.classList.remove("hidden");
}
function hideLoading() {
  loadingOverlay.classList.add("hidden");
}

customElements.whenDefined("movi-player").then(() => {
  const player = document.getElementById("player");
  player.addEventListener("loadeddata", () => {
    hideLoading();
    const title = player.title;
    if (title) document.title = title + " — Movi Player";
  });
  // Hide fullscreen + PiP buttons (not supported in VS Code webviews) and
  // remove their entries from the right-click context menu. Inject into
  // shadow DOM since regular page CSS can't reach inside it.
  function hideUnsupported() {
    if (!player.shadowRoot) return;
    if (player.shadowRoot.getElementById("movi-vscode-hide")) return;
    const style = document.createElement("style");
    style.id = "movi-vscode-hide";
    // VS Code webview top-level frame: Permissions-Policy denies both
    // fullscreen and PiP. PiP button is hidden entirely. Fullscreen button
    // stays visible (familiar UI) but disabled — clicking does nothing.
    style.textContent = `
      .movi-pip-btn,
      .movi-context-menu-item[data-action="pip"] { display: none !important; }
    `;
    player.shadowRoot.appendChild(style);

    // Capture-phase click interceptor on the shadow root: fullscreen button
    // and the right-click context-menu fullscreen entry both bypass the
    // player's own click handler — we send the message ourselves and stop
    // propagation so the player never calls requestFullscreen.
    if (!player.shadowRoot._moviFsClickIntercept) {
      player.shadowRoot.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest(
          '.movi-fullscreen-btn, .movi-context-menu-item[data-action="fullscreen"]'
        );
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        sendFullscreen();
      }, true);
      player.shadowRoot._moviFsClickIntercept = true;
    }
  }
  hideUnsupported();
  // Re-apply after first frame in case shadow root populates async
  setTimeout(hideUnsupported, 0);
  setTimeout(hideUnsupported, 500);
});

// ─── Streaming File proxy ──────────────────────────────────
// Bridges movi-player's FileSource.slice() calls to extension-host
// fs.createReadStream chunks. Memory cost = ~chunk size, not file size,
// so 10 GB files work without loading anything.
const pendingChunks = new Map(); // id → { resolve, reject }
let nextChunkId = 1;

function requestChunk(start, length) {
  const id = nextChunkId++;
  return new Promise((resolve, reject) => {
    pendingChunks.set(id, { resolve, reject });
    vscode.postMessage({ type: "readChunk", id, start, length });
  });
}

function createStreamingFile(name, size, mimeType) {
  // Real File for `instanceof File` checks; size + slice are overridden
  // to pull bytes on demand from the extension host.
  const file = new File([new Uint8Array(0)], name, { type: mimeType });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  Object.defineProperty(file, "slice", {
    value: function (start = 0, end = size) {
      const realStart = Math.max(0, start);
      const realEnd = Math.min(size, end);
      const length = Math.max(0, realEnd - realStart);
      const blob = new Blob([new Uint8Array(0)], { type: mimeType });
      Object.defineProperty(blob, "size", { value: length, configurable: true });
      Object.defineProperty(blob, "arrayBuffer", {
        value: async function () {
          if (length === 0) return new ArrayBuffer(0);
          return await requestChunk(realStart, length);
        },
        configurable: true,
      });
      return blob;
    },
    configurable: true,
  });
  return file;
}

function loadStream(name, size, mimeType) {
  hideLoading();
  if (name) document.title = name + " — Movi Player";
  const file = createStreamingFile(name || "video", size, mimeType || "video/mp4");
  customElements.whenDefined("movi-player").then(() => {
    document.getElementById("player").src = file;
  });
}

async function loadFromUrl(url, name) {
  // Fallback: fetch+blob path (used for remote URLs from openUrl command).
  showLoading(name || "");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    const file = new File([blob], name || "video", {
      type: blob.type || "video/mp4",
    });
    if (name) document.title = name + " — Movi Player";
    customElements.whenDefined("movi-player").then(() => {
      document.getElementById("player").src = file;
    });
  } catch (err) {
    console.error("[Movi] Failed to load:", err);
    hideLoading();
  }
}

function loadRemoteUrl(url) {
  const name = decodeURIComponent(url.split("/").pop().split("?")[0]).replace(/\.[^.]+$/, "");
  if (name) document.title = name + " — Movi Player";
  customElements.whenDefined("movi-player").then(() => {
    document.getElementById("player").src = url;
  });
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === "loadStream") {
    loadStream(msg.name, msg.size, msg.mimeType);
  } else if (msg.type === "loadFile") {
    loadFromUrl(msg.url, msg.name);
  } else if (msg.type === "loadUrl") {
    loadRemoteUrl(msg.url);
  } else if (msg.type === "chunkData") {
    const pending = pendingChunks.get(msg.id);
    if (pending) {
      pendingChunks.delete(msg.id);
      pending.resolve(msg.buffer);
    }
  } else if (msg.type === "chunkError") {
    const pending = pendingChunks.get(msg.id);
    if (pending) {
      pendingChunks.delete(msg.id);
      pending.reject(new Error(msg.error));
    }
  } else if (msg.type === "disableFullscreen") {
    _fullscreenDisabled = true;
    hideFullscreenUi();
  }
});

// Inject CSS into the player's shadow root that hides the fullscreen
// button + its context-menu entry. Re-applied on a small interval since
// the shadow root may populate asynchronously after the message arrives.
function hideFullscreenUi() {
  function apply() {
    const player = document.getElementById("player");
    if (!player || !player.shadowRoot) return;
    if (player.shadowRoot.getElementById("movi-fs-disable")) return;
    const style = document.createElement("style");
    style.id = "movi-fs-disable";
    style.textContent = `
      .movi-fullscreen-btn,
      .movi-context-menu-item[data-action="fullscreen"] { display: none !important; }
    `;
    player.shadowRoot.appendChild(style);
  }
  apply();
  setTimeout(apply, 0);
  setTimeout(apply, 500);
  setTimeout(apply, 1500);
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  const player = document.getElementById("player");
  if (!player || !player.shadowRoot) return;
  if (document.activeElement === player || player.contains(e.target)) return;
  player.dispatchEvent(new KeyboardEvent("keydown", {
    key: e.key, code: e.code, keyCode: e.keyCode,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
    bubbles: true, cancelable: true
  }));
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
});

vscode.postMessage({ type: "ready" });
