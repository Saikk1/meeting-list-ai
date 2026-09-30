import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = resolve(projectDirectory, ".sites-runtime");
const vinext =
  process.platform === "win32"
    ? resolve(projectDirectory, "node_modules", ".bin", "vinext.cmd")
    : resolve(projectDirectory, "node_modules", ".bin", "vinext");

for (const directory of [
  "home",
  "npm-cache",
  "xdg-config",
  "tmp",
  join("wrangler", "logs"),
]) {
  await mkdir(resolve(runtimeDirectory, directory), { recursive: true });
}

const environment = {
  ...process.env,
  SITES_ENV_READY: "1",
  SITES_PROJECT_ROOT: projectDirectory,
  HOME: resolve(runtimeDirectory, "home"),
  XDG_CONFIG_HOME: resolve(runtimeDirectory, "xdg-config"),
  TMPDIR: resolve(runtimeDirectory, "tmp"),
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: resolve(runtimeDirectory, "wrangler", "logs"),
  MINIFLARE_REGISTRY_PATH: resolve(
    runtimeDirectory,
    "wrangler",
    "registry",
  ),
  npm_config_cache: resolve(runtimeDirectory, "npm-cache"),
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};

for (const key of [
  "npm_config_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
  "NPM_CONFIG_PROXY",
  "NPM_CONFIG_HTTP_PROXY",
  "NPM_CONFIG_HTTPS_PROXY",
]) {
  delete environment[key];
}

await access(vinext, constants.F_OK).catch(() => {
  throw new Error("vinext is unavailable. Run npm install before building.");
});

console.log("Running bounded vinext build...");
await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn(vinext, ["build"], {
    cwd: projectDirectory,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  const timeout = setTimeout(() => {
    child.kill();
    rejectBuild(new Error("Build timed out after 3 minutes."));
  }, 180_000);
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectBuild(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    if (code === 0) resolveBuild();
    else rejectBuild(new Error(`vinext build exited with code ${code}`));
  });
});

const workerPath = resolve(projectDirectory, "dist", "server", "index.js");
const hostingPath = resolve(
  projectDirectory,
  "dist",
  ".openai",
  "hosting.json",
);
await Promise.all([
  access(workerPath, constants.F_OK),
  access(hostingPath, constants.F_OK),
]);
JSON.parse(await readFile(hostingPath, "utf8"));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error(
    "dist/server/index.js must export a default object with fetch().",
  );
}

await new Promise((resolveDefaults, rejectDefaults) => {
  const child = spawn(process.execPath, ["--import", "tsx", resolve(projectDirectory, "scripts/prepare-default-config.ts")], { cwd: projectDirectory, env: environment, stdio: "inherit", windowsHide: true });
  child.once("error", rejectDefaults);
  child.once("exit", (code) => code === 0 ? resolveDefaults() : rejectDefaults(new Error(`Default config preparation exited with code ${code}`)));
});
JSON.parse(await readFile(resolve(projectDirectory, "dist/default-admin-config.json"), "utf8"));
console.log("Validated build artifact and bundled default configuration.");
