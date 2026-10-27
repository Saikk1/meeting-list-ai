import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const version = JSON.parse(await readFile(resolve("package.json"), "utf8")).version;
const desktopVersion = JSON.parse(await readFile(resolve("desktop/package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || version !== desktopVersion) throw new Error("Release versions must match");
const directory = resolve("release/desktop");
const name = `MeetingAssistant-${version}-Setup.exe`;
const destination = resolve(directory, name);
await copyFile(resolve(directory, `会务智办-${version}-安装版.exe`), destination);
const hash = createHash("sha256");
for await (const chunk of createReadStream(destination)) hash.update(chunk);
const digest = hash.digest("hex");
await writeFile(resolve(directory, `SHA256SUMS-${version}.txt`), `${digest}  ${name}\n`);
console.log(`Release installer: ${destination}\nSHA-256: ${digest}`);
