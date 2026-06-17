/** Capture the player card + ambient halo layout. electron scripts/screenshot-player.js */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
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
    width: 1180,
    height: 760,
    show: false,
    backgroundColor: "#0c0c11",
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true },
  });

  win.webContents.on("did-finish-load", async () => {
    await win.webContents.executeJavaScript(`(() => {
      // Reveal the full-bleed player (letterbox tint needs a real video, so
      // this just confirms the layout + macOS top strip).
      document.getElementById('welcome').style.display = 'none';
      document.body.classList.add('playing');
      document.getElementById('player').hidden = false;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync("/tmp/movi-desktop-player.png", img.toPNG());
    console.log("saved /tmp/movi-desktop-player.png");
    server.close();
    win.destroy();
    app.exit(0);
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
});
