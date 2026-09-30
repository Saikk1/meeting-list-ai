import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-wasm";

// Produce a Windows ICO from the application's existing vector mark.
const { initWasm } = await import("@resvg/resvg-wasm");
await initWasm(await readFile(resolve("node_modules/@resvg/resvg-wasm/index_bg.wasm")));
const svg = await readFile(resolve("public/favicon.svg"), "utf8");
const png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 256 } }).render().asPng());
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await mkdir(resolve("build/desktop"), { recursive: true });
await writeFile(resolve("build/desktop/icon.ico"), Buffer.concat([header, png]));
console.log("Desktop icon ready.");
