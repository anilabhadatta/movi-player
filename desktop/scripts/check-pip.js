/** Verify the PiP window machinery: pip.html loads isolated, player registers,
 *  the window is always-on-top, and the preload exposes the PiP/path bridge. */
const { app, BrowserWindow, shell } = require("electron");
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

  // Mimic main.js openPip()
  const pip = new BrowserWindow({
    width: 480, height: 270, alwaysOnTop: true, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true },
  });
  pip.setAlwaysOnTop(true, "floating");
  pip.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  pip.webContents.on("did-finish-load", async () => {
    const r = await pip.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 40 && !customElements.get('movi-player'); i++) await new Promise(r => setTimeout(r, 50));
      const pp = document.getElementById('pip-player');
      const innerPip = pp?.shadowRoot?.querySelector('.movi-pip-btn');
      return {
        isolated: crossOriginIsolated,
        playerDefined: !!customElements.get('movi-player'),
        hasPipPlayer: !!pp,
        hasExitBtn: !!document.getElementById('pip-exit'),
        innerPipHidden: innerPip ? getComputedStyle(innerPip).display === 'none' : true,
        bridgePip: typeof window.movi?.pipReportState === 'function' && typeof window.movi?.pipClose === 'function' && typeof window.movi?.onPipLoad === 'function',
      };
    })()`, true);

    const checks = [
      ["pip window always-on-top", pip.isAlwaysOnTop()],
      ["pip window fullscreenable", pip.isFullScreenable()],
      ["pip.html cross-origin isolated", r.isolated],
      ["<movi-player> registered in PiP", r.playerDefined],
      ["return-to-main button present", r.hasExitBtn],
      ["inner (dead) PiP button hidden", r.innerPipHidden],
      ["preload PiP bridge exposed", r.bridgePip],
    ];
    let fail = 0;
    for (const [n, ok] of checks) { console.log(ok ? "✓" : "✗", n, ok ? "" : `→ ${JSON.stringify(r)}`); if (!ok) fail++; }
    console.log(`\n${checks.length - fail} passed, ${fail} failed`);
    server.close();
    pip.destroy();
    app.exit(fail ? 1 : 0);
  });

  pip.loadURL(`http://127.0.0.1:${port}/pip.html?src=${encodeURIComponent("/_proxy/x?url=http://example.com/v.mp4")}&t=5&playing=1`);
  setTimeout(() => app.exit(4), 20000);
});
