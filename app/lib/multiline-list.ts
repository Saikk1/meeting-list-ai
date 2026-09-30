export function splitEditableLines(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

export function compactEditableLines(values: readonly string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}
