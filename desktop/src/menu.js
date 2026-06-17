/**
 * Native application menu. Keeps the platform conventions (app menu on macOS),
 * with File ▸ Open / Open URL, the standard View + Window roles, and a Help
 * link back to the project.
 */
const { app, Menu, shell } = require("electron");

function buildMenu({ onOpen, onOpenUrl }) {
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open File…", accelerator: "CmdOrCtrl+O", click: onOpen },
        { label: "Open URL…", accelerator: "CmdOrCtrl+L", click: onOpenUrl },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
    {
      role: "help",
      submenu: [
        { label: "MoviPlayer Website", click: () => shell.openExternal("https://moviplayer.com") },
        { label: "Documentation", click: () => shell.openExternal("https://mrujjwalg.github.io/movi-player/") },
        { label: "Report an Issue", click: () => shell.openExternal("https://github.com/mrujjwalg/movi-player/issues") },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
