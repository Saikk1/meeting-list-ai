import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDER_PRESET_MAP,
  CUSTOM_MODEL_OPTION_VALUE,
  isCatalogModel,
} from "../app/lib/ai-model-catalog";

test("each built-in AI provider has a usable curated default model", () => {
  for (const providerId of ["deepseek", "openai", "kimi", "doubao"] as const) {
    const preset = AI_PROVIDER_PRESET_MAP[providerId];
    assert.ok(preset.baseUrl.startsWith("https://"));
    assert.ok(preset.apiKeyUrl.startsWith("https://"));
    assert.ok(preset.docsUrl.startsWith("https://"));
    assert.ok(preset.models.length >= 2);
    assert.equal(isCatalogModel(providerId, preset.model), true);
  }
});

test("custom providers do not invent an API key registration destination", () => {
  assert.equal(AI_PROVIDER_PRESET_MAP.custom.apiKeyUrl, "");
});

test("curated models use current provider model names and custom remains available", () => {
  assert.deepEqual(
    AI_PROVIDER_PRESET_MAP.deepseek.models.map((model) => model.id),
    ["deepseek-v4-flash", "deepseek-v4-pro"],
  );
  assert.equal(isCatalogModel("openai", "gpt-5.6-terra"), true);
  assert.equal(isCatalogModel("kimi", "kimi-k3"), true);
  assert.equal(
    isCatalogModel("doubao", "doubao-seed-2-0-lite-260215"),
    true,
  );
  assert.equal(isCatalogModel("custom", CUSTOM_MODEL_OPTION_VALUE), false);
  assert.equal(isCatalogModel("deepseek", "future-model-id"), false);
});

test("model selectors keep labels to names without marketing descriptions", () => {
  for (const preset of Object.values(AI_PROVIDER_PRESET_MAP)) {
    for (const model of preset.models) {
      assert.doesNotMatch(
        model.label,
        /推荐|旗舰|速度优先|效果优先|性价比|高频任务|编程专用|高速编程/,
      );
    }
  }
});
