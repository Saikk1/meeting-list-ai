import assert from "node:assert/strict";
import test from "node:test";
import {
  compactEditableLines,
  splitEditableLines,
} from "../app/lib/multiline-list";

test("multiline alias editing preserves a trailing line break", () => {
  const editing = splitEditableLines("宁波低空\n");

  assert.deepEqual(editing, ["宁波低空", ""]);
  assert.equal(editing.join("\n"), "宁波低空\n");
});

test("multiline alias editing accepts Windows line breaks", () => {
  assert.deepEqual(splitEditableLines("宁波低空\r\n低空公司"), [
    "宁波低空",
    "低空公司",
  ]);
});

test("multiline alias values are cleaned and deduplicated on blur", () => {
  assert.deepEqual(
    compactEditableLines([" 宁波低空 ", "", "低空公司", "宁波低空"]),
    ["宁波低空", "低空公司"],
  );
});
