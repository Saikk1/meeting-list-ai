import assert from "node:assert/strict";
import test from "node:test";

import type { UnitAliasRule } from "../app/lib/admin-config";
import {
  buildUnitDirectory,
  resolveCanonicalUnit,
  searchUnitDirectory,
} from "../app/lib/unit-directory";

const RULES: UnitAliasRule[] = [
  {
    id: "ningbo-low-altitude",
    canonical: "宁波低空经济发展有限公司",
    aliases: ["宁波低空", "低空公司"],
    mode: "auto",
    enabled: true,
    notes: "",
  },
  {
    id: "shanghai-jiushi",
    canonical: "上海九誓科技有限公司",
    aliases: ["上海九誓", "九誓科技"],
    mode: "confirm",
    enabled: true,
    notes: "",
  },
  {
    id: "disabled-unit",
    canonical: "已停用单位有限公司",
    aliases: ["停用单位"],
    mode: "auto",
    enabled: false,
    notes: "",
  },
];

test("unit directory fuzzy-searches canonical names and aliases", () => {
  const directory = buildUnitDirectory(RULES);

  assert.equal(
    searchUnitDirectory("宁波低", directory)[0]?.canonical,
    "宁波低空经济发展有限公司",
  );
  assert.equal(
    searchUnitDirectory("九誓", directory)[0]?.canonical,
    "上海九誓科技有限公司",
  );
});

test("unit directory resolves an exact alias to its canonical full name", () => {
  const directory = buildUnitDirectory(RULES);

  assert.equal(
    resolveCanonicalUnit(" 上海九誓 ", directory)?.canonical,
    "上海九誓科技有限公司",
  );
  assert.equal(
    resolveCanonicalUnit("宁波低空经济发展有限公司", directory)?.canonical,
    "宁波低空经济发展有限公司",
  );
});

test("disabled unit mappings stay out of suggestions and normalization", () => {
  const directory = buildUnitDirectory(RULES);

  assert.equal(searchUnitDirectory("停用单位", directory).length, 0);
  assert.equal(resolveCanonicalUnit("停用单位", directory), null);
});
