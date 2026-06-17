/** Verify desktop shadow patches: PiP button hidden + macOS title inset. */
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
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true },
  });

  win.webContents.on("did-finish-load", async () => {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const p = document.getElementById('player');
      for (let i = 0; i < 30 && !(p.shadowRoot && p.shadowRoot.querySelector('.movi-pip-btn')); i++)
        await new Promise(r => setTimeout(r, 50));
      const sr = p.shadowRoot;
      const bar = sr?.querySelector('.movi-title-bar');
      return {
        pipHooked: !!sr?.__moviPipHooked,
        padTop: bar ? getComputedStyle(bar).paddingTop : null,
      };
    })()`, true);

    const isMac = process.platform === "darwin";
    const checks = [
      ["PiP button click intercepted", r.pipHooked],
      ["title below lights (mac, padding-top ≥40px)", isMac ? parseInt(r.padTop) >= 40 : true],
    ];
    let fail = 0;
    for (const [n, ok] of checks) { console.log(ok ? "✓" : "✗", n, ok ? "" : `→ ${JSON.stringify(r)}`); if (!ok) fail++; }
    console.log(`\n${checks.length - fail} passed, ${fail} failed`);
    server.close();
    win.destroy();
    app.exit(fail ? 1 : 0);
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
  setTimeout(() => app.exit(4), 20000);
});
