import { extractPdfWithOcr, recognizeImageText } from "./pdf-ocr";

/** Shared local file reader for roster imports and assistant meeting reports. */
export async function readBusinessDocument(
  file: File,
  onProgress?: (message: string) => void,
): Promise<{ content: string; kind: "excel" | "word" | "text" | "pdf" | "image" }> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，暂不支持`);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let content = "";
  let kind: "excel" | "word" | "text" | "pdf" | "image";
  if (["xlsx", "xls", "csv"].includes(extension)) {
    const XLSX = await import("xlsx");
    const workbook = extension === "csv"
      ? XLSX.read(await file.text(), { type: "string", cellDates: false })
      : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    content = workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
      if (rows.length > 5_000) throw new Error(`${file.name} 的“${name}”超过单次 5,000 行上限，请拆分后导入`);
      return `【工作表：${name}】\n${rows.map((row) => row.map((cell) => String(cell ?? "").trim().replace(/\t/g, " ")).join("\t").replace(/\t+$/g, "")).filter(Boolean).join("\n")}`;
    }).join("\n");
    kind = "excel";
  } else if (extension === "docx") {
    const mammoth = await import("mammoth");
    content = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    kind = "word";
  } else if (["txt", "md"].includes(extension)) {
    content = await file.text();
    kind = "text";
  } else if (extension === "pdf") {
    content = (await extractPdfWithOcr(await file.arrayBuffer(), (state) => onProgress?.(
      state.stage === "ocr" ? `正在 OCR 扫描页 ${state.page}/${state.pages}（${Math.round(state.progress * 100)}%）` : `正在读取 PDF 第 ${state.page}/${state.pages} 页`,
    ))).text;
    kind = "pdf";
  } else if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    content = await recognizeImageText(file, (progress) => onProgress?.(`正在 OCR 图片（${Math.round(progress * 100)}%）`));
    kind = "image";
  } else {
    throw new Error(`${file.name} 格式不支持，请上传 Excel、Word（.docx）、PDF、图片或文本文件`);
  }
  if (!content.trim()) throw new Error(`${file.name} 未识别到可用文字`);
  return { content: content.trim(), kind };
}
