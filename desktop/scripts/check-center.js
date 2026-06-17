/** Diagnose center play/pause position in the PiP-sized window. */
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
    width: 480, height: 270, show: false,
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true },
  });

  win.webContents.on("did-finish-load", async () => {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const p = document.getElementById('pip-player');
      for (let i = 0; i < 60 && !(p.shadowRoot && p.shadowRoot.querySelector('.movi-center-play-pause')); i++)
        await new Promise(r => setTimeout(r, 50));
      const sr = p.shadowRoot;
      const center = sr.querySelector('.movi-center-play-pause');
      const loader = sr.querySelector('.movi-loading-indicator');
      if (!center || !loader) return { err: 'missing', center: !!center, loader: !!loader };
      const topOf = (el) => getComputedStyle(el).top;

      // Host class drives both: visible (raised) vs hidden (centred).
      p.classList.add('movi-bar-visible');
      const centerRaised = topOf(center), loaderRaised = topOf(loader);
      p.classList.remove('movi-bar-visible');
      const centerCentered = topOf(center), loaderCentered = topOf(loader);

      return {
        h: p.getBoundingClientRect().height,
        centerRaised, centerCentered,
        loaderRaised, loaderCentered,
        centerAnimatesTop: /\\btop\\b/.test(getComputedStyle(center).transition),
        loaderAnimatesTop: /\\btop\\b/.test(getComputedStyle(loader).transition),
      };
    })()`, true);

    console.log(JSON.stringify(r, null, 2));
    if (r.h) {
      console.log("trueCenter = " + (r.h / 2) + "px (height " + r.h + ")");
    }
    server.close();
    win.destroy();
    app.exit(0);
  });

  win.loadURL("http://127.0.0.1:" + port + "/pip.html");
  setTimeout(() => app.exit(4), 20000);
});
