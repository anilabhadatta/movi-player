/** Capture the playlist panel layout. electron scripts/screenshot-playlist.js */
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
    width: 1180, height: 720, show: false, backgroundColor: "#000",
    webPreferences: { preload: path.join(__dirname, "..", "src", "preload.js"), contextIsolation: true },
  });

  win.webContents.on("did-finish-load", async () => {
    await win.webContents.executeJavaScript(`(() => {
      document.getElementById('welcome').style.display='none';
      const p=document.getElementById('player'); p.hidden=false;
      p.style.background='#1a120a';
      const panel=document.getElementById('playlist-panel'); panel.classList.add('open');
      const items=document.getElementById('pl-items');
      const names=['Interstellar.2014.2160p.HDR.mkv','big_buck_bunny.av1.10bit.webm','Coke Studio - Pasoori.4k.mp4','Maa Tujhe Salaam.mkv','wedding_drone_4k.mov'];
      names.forEach((nm,i)=>{
        const li=document.createElement('li');
        const b=document.createElement('button'); b.type='button'; b.className='pl-item'+(i===2?' active':'');
        const idx=document.createElement('span'); idx.className='pl-index'; idx.textContent=String(i+1).padStart(2,'0');
        const name=document.createElement('span'); name.className='pl-name'; name.textContent=nm;
        b.append(idx,name); li.append(b); items.append(li);
      });
      document.getElementById('pl-count').textContent=names.length;
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync("/tmp/movi-desktop-playlist.png", (await win.webContents.capturePage()).toPNG());
    console.log("saved /tmp/movi-desktop-playlist.png");
    server.close(); win.destroy(); app.exit(0);
  });

  win.loadURL("http://127.0.0.1:" + port + "/");
});
