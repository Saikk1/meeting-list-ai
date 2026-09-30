import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const cache = resolve(".tmp/desktop-cache");
await mkdir(cache, { recursive: true });
const child = spawn(process.execPath, [
  resolve("node_modules/electron-builder/cli.js"),
  "--config", "electron-builder.config.cjs", "--win", "nsis", "portable", "--x64", "--publish", "never",
], {
  env: {
    ...process.env,
    ELECTRON_CACHE: resolve(cache, "electron"),
    ELECTRON_BUILDER_CACHE: resolve(cache, "builder"),
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
  stdio: "inherit",
  windowsHide: true,
});
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
