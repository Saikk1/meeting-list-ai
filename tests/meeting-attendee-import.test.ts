import assert from "node:assert/strict";
import test from "node:test";
import { appendRecognizedAttendees, recognizeMeetingAttendees } from "../app/lib/meeting-attendee-import";
import { parseWithRules } from "../app/lib/roster-parser";
import { activeModelRequestConfig, makeDefaultAISettings } from "../app/lib/ai-settings";
import { normalizeMeetingAttendees } from "../app/lib/meeting-data";
import type { UnitAliasRule } from "../app/lib/admin-config";

const config = activeModelRequestConfig(makeDefaultAISettings());

test("local parsing recognizes every name in a pasted sentence and marks missing units", () => {
  const records = parseWithRules("参会人员：张三、李四，王五。\n赵六；张三");
  assert.deepEqual(records.map((row) => row.name), ["张三", "李四", "王五", "赵六", "张三"]);
  assert.ok(records.every((row) => row.unit === "" && row.issues.includes("单位缺失")));
  assert.ok(records.at(-1)?.issues.includes("疑似重复人员"));
  assert.equal(normalizeMeetingAttendees(records.slice(0, 4)).length, 4);
});

test("shared parser keeps table columns, sources, spaced names, and independent vehicles", () => {
  const records = parseWithRules("【来源：演示表格】\n序号\t姓名\t单位\t部门\t职务\n1\t张 三\t示例公司\t市场部\t经理\n2\t李四\t示例研究院\t研发部\t研究员");
  assert.deepEqual(records.map(({ name, unit, department, title, source }) => ({ name, unit, department, title, source })), [
    { name: "张三", unit: "示例公司", department: "市场部", title: "经理", source: "演示表格" },
    { name: "李四", unit: "示例研究院", department: "研发部", title: "研究员", source: "演示表格" },
  ]);
  assert.equal(parseWithRules("张三\t示例单位").length, 1);
  assert.equal(parseWithRules("姓名;单位;职务\n张三;示例公司;经理")[0].unit, "示例公司");
  assert.equal(parseWithRules("参会人员\n姓名\n张三").length, 1);
  assert.equal(parseWithRules("张三 示例公司 经理 浙A12345")[0].unit, "示例公司");
});

test("confirming an import preserves manual fields and only skips exact configured identities", () => {
  const existing = [{ id: "manual", name: "张三", unit: "示例科技有限公司", department: "人工部门", title: "人工职务", source: "手动录入" }];
  const aliases: UnitAliasRule[] = [{ id: "example", enabled: true, canonical: "示例科技有限公司", aliases: ["示例科技"], mode: "auto", notes: "测试" }];
  const incoming = [
    { name: "张三", unit: "示例科技", department: "AI部门", title: "AI职务", source: "粘贴文本" },
    { name: "张三", unit: "另一公司", department: "", title: "", source: "粘贴文本" },
    { name: "李四", unit: "", department: "", title: "", source: "粘贴文本" },
    { name: "李四", unit: "", department: "", title: "", source: "粘贴文本" },
  ];
  const result = appendRecognizedAttendees(existing, incoming, aliases);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.attendees[0], existing[0]);
  assert.deepEqual(result.attendees.map((row) => row.unit), ["示例科技有限公司", "另一公司", ""]);
  assert.equal(existing.length, 1);
  assert.equal(new Set(result.attendees.map((row) => row.id)).size, 3);
  assert.equal(appendRecognizedAttendees(result.attendees, incoming, aliases).added, 0);
});

test("natural language extraction sends the chosen model and extraction rules without saving", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push(url);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.config.model, "test-model");
    assert.equal(body.promptSuffix, "保留原文信息");
    assert.equal(body.text, "示例公司的张三经理与示例研究院的李四研究员参加。");
    return Response.json({ records: [
      { name: "张三", unit: "示例公司", title: "经理" },
      { name: "李四", unit: "示例研究院", title: "研究员", issues: ["职务待核对"] },
    ] });
  });
  const result = await recognizeMeetingAttendees("示例公司的张三经理与示例研究院的李四研究员参加。", {
    config: { ...config, apiKey: "test-key", model: "test-model" }, promptSuffix: "保留原文信息",
  });
  assert.deepEqual(result.records.map((row) => row.name), ["张三", "李四"]);
  assert.deepEqual(result.records[1].issues, ["职务待核对"]);
  assert.deepEqual(calls, ["/api/extract"]);
});

test("no model, a failed model, and empty AI results all use local rules", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ configured: false }));
  const local = await recognizeMeetingAttendees("张三、李四", { config, promptSuffix: "" });
  assert.equal(local.records.length, 2);
  assert.match(local.message, /未配置 AI/);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: "服务繁忙" }, { status: 503 }));
  const fallback = await recognizeMeetingAttendees("张三、李四", { config: { ...config, apiKey: "test" }, promptSuffix: "" });
  assert.equal(fallback.records.length, 2);
  assert.match(fallback.message, /本地规则.*服务繁忙/);
  fetchMock.mock.mockImplementation(async () => Response.json({ records: [null, { name: "" }] }));
  const empty = await recognizeMeetingAttendees("张三、李四", { config: { ...config, apiKey: "test" }, promptSuffix: "" });
  assert.equal(empty.records.length, 2);
  assert.match(empty.message, /未返回有效人员/);
});

test("empty and oversized imports fail before any network access; abort does not add a fallback", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("aborted"); });
  await assert.rejects(recognizeMeetingAttendees(" ", { config, promptSuffix: "" }), /先粘贴/);
  await assert.rejects(recognizeMeetingAttendees("张".repeat(100_001), { config, promptSuffix: "" }), /100,000/);
  assert.equal(fetchMock.mock.callCount(), 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(recognizeMeetingAttendees("张三", { config, promptSuffix: "", signal: controller.signal }), /aborted/);
});
