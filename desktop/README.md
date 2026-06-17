# MoviPlayer Desktop

Electron wrapper around the MoviPlayer engine — plays MKV, HEVC, AV1, VP9, 4K
and HDR locally on **Windows, macOS and Linux**. Nothing is uploaded; every
file is decoded on-device with WebCodecs + the FFmpeg-WASM demuxer.

## Why Electron (not Tauri)

The engine needs WebCodecs **and** `SharedArrayBuffer` (the WASM demuxer).
Electron ships a fixed Chromium, so HEVC/AV1 decode and cross-origin isolation
behave identically on all three OSes. Tauri's system webview — especially
WebKitGTK on Linux — doesn't reliably expose WebCodecs, which is the whole
point of MoviPlayer.

## How it works

- A tiny **localhost server** serves the renderer with `COOP: same-origin` +
  `COEP: require-corp`, exactly like production. That makes the page
  cross-origin isolated, so `SharedArrayBuffer` is available. (`file://`
  can't do this.)
- The player bundle `dist/element.js` (WASM embedded) is served same-origin.
- Files load three ways: drag & drop (zero-copy `File`), the native Open
  dialog and OS "Open with" (range-streamed via `/_local`), and pasted URLs
  (range pass-through via `/_proxy`, so no CORS limits).

## Develop

```bash
# 1) from the repo root, build the player bundle (produces dist/element.js)
npm run build:ts            # or: npm run build  (also rebuilds WASM)

# 2) in this folder
cd desktop
npm install
npm start                   # prestart copies dist/element.js in, then launches
```

## Package installers

```bash
cd desktop
npm run dist          # current OS
npm run dist:mac      # dmg + zip   (arm64 + x64)
npm run dist:win      # nsis + portable
npm run dist:linux    # AppImage + deb
```

Output lands in `desktop/dist-desktop/`.

> Icons: `build/icon.png` is copied from `app/favicon-512x512.png` on first
> sync. Drop in a 1024×1024 PNG there for crisper installer icons.

## Notes

- `renderer/vendor/element.js` and `build/icon.png` are generated (gitignored);
  run `npm run sync` to refresh them after rebuilding the bundle.
- HEVC uses the OS decoder via `--enable-features=PlatformHEVCDecoderSupport`;
  the software FFmpeg-WASM path covers anything the platform can't decode.
