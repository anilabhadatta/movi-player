/**
 * Headless boot check: launches the real main-process server + a hidden
 * window, then verifies the renderer is cross-origin isolated (→ SAB works),
 * the <movi-player> element registered, and WebCodecs is present. Exits
 * non-zero if any check fails. Run: electron scripts/smoke.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { createLocalServer } = require("../src/local-server");

app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport,SharedArrayBuffer");

app.whenReady().then(async () => {
  const server = createLocalServer({
    rendererDir: path.join(__dirname, "..", "renderer"),
    isLocalAllowed: () => false,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true, nodeIntegration: false },
  });

  let done = false;
  const finish = (code) => { if (done) return; done = true; server.close(); win.destroy(); app.exit(code); };

  win.webContents.on("did-finish-load", async () => {
    // Give the 9.5MB module a beat to define the element, then probe.
    const probe = `(async () => {
      for (let i = 0; i < 40 && !customElements.get('movi-player'); i++) await new Promise(r => setTimeout(r, 50));
      return {
        isolated: crossOriginIsolated,
        hasSAB: typeof SharedArrayBuffer !== 'undefined',
        hasWebCodecs: typeof VideoDecoder !== 'undefined',
        defined: !!customElements.get('movi-player'),
        hasSetFile: typeof document.getElementById('player')?.setFile === 'function',
        bridge: typeof window.movi?.openDialog === 'function',
      };
    })()`;
    try {
      const r = await win.webContents.executeJavaScript(probe, true);
      const checks = [
        ["cross-origin isolated", r.isolated],
        ["SharedArrayBuffer available", r.hasSAB],
        ["WebCodecs (VideoDecoder)", r.hasWebCodecs],
        ["<movi-player> registered", r.defined],
        ["player.setFile() present", r.hasSetFile],
        ["preload bridge exposed", r.bridge],
      ];
      let fail = 0;
      for (const [name, pass] of checks) { console.log(pass ? "✓" : "✗", name); if (!pass) fail++; }
      console.log(`\n${checks.length - fail} passed, ${fail} failed`);
      finish(fail ? 1 : 0);
    } catch (err) {
      console.error("probe failed:", err);
      finish(2);
    }
  });

  win.webContents.on("render-process-gone", (_e, d) => { console.error("renderer gone:", d.reason); finish(3); });
  win.loadURL(`http://127.0.0.1:${port}/`);
  setTimeout(() => { console.error("timeout"); finish(4); }, 20000);
});
