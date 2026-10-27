import { extractPdfWithOcr, recognizeImageText } from "./pdf-ocr";

/** Local reader shared by roster and assistant reports. */
export async function readBusinessDocument(
  file: File,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<{
  content: string;
  kind: "excel" | "word" | "text" | "pdf" | "image";
  pages?: { page: number; text: string; ocr: boolean }[];
}> {
  signal?.throwIfAborted();
  if (file.size > 20 * 1024 * 1024)
    throw new Error(`${file.name} 超过 20 MB，暂不支持`);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let content = "";
  let pages: { page: number; text: string; ocr: boolean }[] | undefined;
  let kind: "excel" | "word" | "text" | "pdf" | "image";
  if (["xlsx", "xls", "csv"].includes(extension)) {
    const XLSX = await import("xlsx");
    const workbook =
      extension === "csv"
        ? XLSX.read(await file.text(), { type: "string", cellDates: false })
        : XLSX.read(await file.arrayBuffer(), {
            type: "array",
            cellDates: false,
          });
    content = workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
        header: 1,
        defval: "",
        raw: false,
      });
      if (rows.length > 5_000)
        throw new Error(
          `${file.name} 的“${name}”超过单次 5,000 行上限，请拆分后导入`,
        );
      return `【工作表：${name}】\n${rows
        .map((row) =>
          row
            .map((cell) =>
              String(cell ?? "")
                .trim()
                .replace(/\t/g, " "),
            )
            .join("\t")
            .replace(/\t+$/g, ""),
        )
        .filter(Boolean)
        .join("\n")}`;
    }).join("\n");
    kind = "excel";
  } else if (extension === "docx") {
    const mammoth = await import("mammoth/mammoth.browser.js");
    content = (
      await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    ).value;
    kind = "word";
  } else if (["txt", "md"].includes(extension)) {
    const bytes = await file.arrayBuffer();
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      content = new TextDecoder("gb18030").decode(bytes);
    }
    kind = "text";
  } else if (extension === "pdf") {
    const result = await extractPdfWithOcr(
      await file.arrayBuffer(),
      (state) =>
        onProgress?.(
          state.stage === "ocr"
            ? `正在 OCR 扫描页 ${state.page}/${state.pages}（${Math.round(state.progress * 100)}%）`
            : `正在读取 PDF 第 ${state.page}/${state.pages} 页`,
        ),
      signal,
    );
    content = result.text;
    pages = result.sections;
    kind = "pdf";
  } else if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    onProgress?.("正在加载图片文字识别组件（首次需要联网下载），请稍候");
    content = await recognizeImageText(
      file,
      (progress) =>
        onProgress?.(`正在 OCR 图片（${Math.round(progress * 100)}%）`),
      signal,
    );
    pages = [{ page: 1, text: content, ocr: true }];
    kind = "image";
  } else {
    throw new Error(
      `${file.name} 格式不支持，请上传 Excel、Word（.docx）、PDF、图片或文本文件`,
    );
  }
  if (!content.trim()) throw new Error(`${file.name} 未识别到可用文字`);
  signal?.throwIfAborted();
  return { content: content.trim(), kind, ...(pages ? { pages } : {}) };
}
