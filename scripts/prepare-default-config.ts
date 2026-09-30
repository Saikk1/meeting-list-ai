import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneAdminConfig } from "../app/lib/admin-config";
import { validateAdminConfig } from "./local-store.mjs";

const defaults = cloneAdminConfig();
validateAdminConfig(defaults);
// This file is generated from checked-in defaults, never from local user data.
await writeFile(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/default-admin-config.json"), `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
