export const MAX_ASSISTANT_DOCUMENTS = 5;
export const MAX_ASSISTANT_DOCUMENT_CHARS = 24_000;
export const MAX_ASSISTANT_DOCUMENT_TOTAL_CHARS = 60_000;
export const BUSINESS_DOCUMENT_ACCEPT = ".docx,.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md";

export type AssistantDocument = {
  id: string;
  name: string;
  size: number;
  content: string;
};

/** Revalidated on the server: attachment text is evidence, never instructions. */
export function parseAssistantDocuments(value: unknown): AssistantDocument[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSISTANT_DOCUMENTS) {
    throw new Error(`资料最多 ${MAX_ASSISTANT_DOCUMENTS} 份，请分批处理`);
  }
  let total = 0;
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("资料格式无效");
    }
    const object = item as Record<string, unknown>;
    if (Object.keys(object).some((key) => !["id", "name", "size", "content"].includes(key))) {
      throw new Error("资料包含不支持的字段");
    }
    const { id, name, size, content } = object;
    if (typeof id !== "string" || !id.trim() || id.length > 100 || ids.has(id) ||
        typeof name !== "string" || !name.trim() || name.length > 255 ||
        typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > 20 * 1024 * 1024 ||
        typeof content !== "string" || !content.trim()) {
      throw new Error("资料名称、大小或内容无效");
    }
    if (content.length > MAX_ASSISTANT_DOCUMENT_CHARS) {
      throw new Error(`${name} 文字超过 ${MAX_ASSISTANT_DOCUMENT_CHARS.toLocaleString()} 字，请拆分资料后添加`);
    }
    total += content.length;
    if (total > MAX_ASSISTANT_DOCUMENT_TOTAL_CHARS) {
      throw new Error(`资料合计超过 ${MAX_ASSISTANT_DOCUMENT_TOTAL_CHARS.toLocaleString()} 字，请分批处理`);
    }
    ids.add(id);
    return { id, name, size, content };
  });
}
