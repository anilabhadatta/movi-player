/**
 * Launches Electron with a clean environment.
 *
 * The shell here sets ELECTRON_RUN_AS_NODE=1 globally, which makes the
 * electron binary behave like plain Node (so `app` is undefined and nothing
 * works). We strip it before spawning. Cross-platform — no `env -u` needed.
 *
 * Usage: node scripts/run-electron.mjs [entry]   (defaults to ".")
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // resolves to the binary path under Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
if (args.length === 0) args.push(".");

const child = spawn(electronPath, args, { stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 0));
