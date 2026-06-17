/**
 * PiP window. Plays whatever source the main window (or a Finder open, or a
 * drag-drop) hands it, seeked to the right position, and reports its state back
 * so the main window can resume from there. Escape / the button / double-click
 * return to the main window.
 */
const p = document.getElementById("pip-player");
const params = new URLSearchParams(location.search);

const baseName = (x) => String(x).split(/[?#]/)[0].split(/[\\/]/).pop() || String(x);
const localSrc = (fp) => "/_local/" + encodeURIComponent(baseName(fp)) + "?p=" + encodeURIComponent(fp);

function seekWhenReady(t) {
  if (!(t > 0)) return;
  let n = 0;
  const iv = setInterval(() => {
    if (++n > 80) return clearInterval(iv);
    if (p.duration > 0) {
      clearInterval(iv);
      try { p.currentTime = t; } catch {}
    }
  }, 100);
}

function load(src, time, playing) {
  if (!src) return;
  if (playing) p.setAttribute("autoplay", "");
  p.src = src;
  seekWhenReady(time || 0);
  reportState();
}

function reportState() {
  const src = typeof p.src === "string" ? p.src : null;
  try { window.movi.pipReportState(src, p.currentTime || 0); } catch {}
}

// Initial handoff from the main window.
load(params.get("src"), parseFloat(params.get("t") || "0"), params.get("playing") === "1");

setInterval(reportState, 1000);
window.addEventListener("beforeunload", reportState);

// A Finder open while PiP is active is routed here by the main process.
window.movi.onPipLoad((d) => load(d && d.src, (d && d.time) || 0, true));

// Drag & drop onto the PiP window.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  const fp = window.movi.pathForFile(f);
  if (fp) {
    try { await window.movi.grant([fp]); } catch {}
    load(localSrc(fp), 0, true);
  } else if (typeof p.setFile === "function") {
    p.setFile(f);
  }
});

// Return to the main window: the button, Escape, or a double-click.
document.getElementById("pip-exit").addEventListener("click", () => window.movi.pipClose());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.movi.pipClose();
});
document.addEventListener("dblclick", () => window.movi.pipClose());

// Hide the player's own (dead) Document-PiP button inside the PiP window.
function hideInnerPipBtn(attempt = 0) {
  const sr = p.shadowRoot;
  if (!sr) {
    if (attempt < 20) setTimeout(() => hideInnerPipBtn(attempt + 1), 100);
    return;
  }
  if (sr.querySelector("#pip-hide-pipbtn")) return;
  const s = document.createElement("style");
  s.id = "pip-hide-pipbtn";
  s.textContent = ".movi-pip-btn, .movi-context-menu-pip { display: none !important; }";
  sr.appendChild(s);
}
hideInnerPipBtn();
