/** Capture the welcome screen to /tmp for visual review. electron scripts/screenshot.js */
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
    // Inject sample recents so that section is visible in the shot.
    await win.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('recents-list');
      const data = [
        { ext:'MKV', name:'Interstellar.2014.2160p.HDR.HEVC.mkv', meta:'14.2 GB' },
        { ext:'WEBM', name:'big_buck_bunny.av1.10bit.webm', meta:'318 MB' },
        { ext:'MP4', name:'wedding_drone_4k.mp4', meta:'2.1 GB' },
      ];
      for (const it of data) {
        const li=document.createElement('li');
        const b=document.createElement('button'); b.className='recent'; b.type='button';
        const e=document.createElement('span'); e.className='recent-ext'; e.textContent=it.ext;
        const n=document.createElement('span'); n.className='recent-name'; n.textContent=it.name;
        const m=document.createElement('span'); m.className='recent-meta'; m.textContent=it.meta;
        b.append(e,n,m); li.append(b); list.append(li);
      }
      document.getElementById('recents').hidden=false;
    })()`);
    await new Promise((r) => setTimeout(r, 1000)); // let load-in animation settle
    const img = await win.webContents.capturePage();
    const out = "/tmp/movi-desktop-welcome.png";
    fs.writeFileSync(out, img.toPNG());
    console.log("saved", out);
    server.close();
    win.destroy();
    app.exit(0);
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
});
