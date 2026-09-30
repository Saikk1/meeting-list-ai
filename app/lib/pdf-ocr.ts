export type DocumentReadProgress = {
  stage: "reading" | "ocr";
  page: number;
  pages: number;
  progress: number;
};

function canvasForPage(width: number, height: number) {
  const canvas = document.createElement("canvas");
  const maximumSide = 2600;
  const scale = Math.min(1, maximumSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

export async function recognizeImageText(
  image: File | HTMLCanvasElement,
  onProgress?: (progress: number) => void,
) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["chi_sim", "eng"], undefined, {
    logger(message) {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(message.progress);
      }
    },
  });
  try {
    const result = await worker.recognize(image);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractPdfWithOcr(
  buffer: ArrayBuffer,
  onProgress?: (state: DocumentReadProgress) => void,
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await documentTask.promise;
  if (pdf.numPages > 60) {
    throw new Error(`PDF 共 ${pdf.numPages} 页，超过单次 60 页上限，请拆分后导入`);
  }

  const sections: string[] = [];
  const scannedPages: Array<{ pageNumber: number; page: Awaited<ReturnType<typeof pdf.getPage>> }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.({ stage: "reading", page: pageNumber, pages: pdf.numPages, progress: pageNumber / pdf.numPages });
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) =>
        "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
      )
      .join("")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text.replace(/\s/g, "").length >= 12) {
      sections.push(`【PDF 第 ${pageNumber} 页】\n${text}`);
    } else {
      scannedPages.push({ pageNumber, page });
    }
  }

  if (scannedPages.length > 30) {
    throw new Error(`PDF 中有 ${scannedPages.length} 页扫描内容，超过单次 OCR 30 页上限，请拆分后导入`);
  }
  if (scannedPages.length) {
    const { createWorker } = await import("tesseract.js");
    let activeOcrPage = scannedPages[0]?.pageNumber ?? 1;
    const worker = await createWorker(["chi_sim", "eng"], undefined, {
      logger(message) {
        if (message.status !== "recognizing text" || typeof message.progress !== "number") return;
        const current = scannedPages.findIndex((item) => item.pageNumber === activeOcrPage);
        onProgress?.({
          stage: "ocr",
          page: activeOcrPage,
          pages: pdf.numPages,
          progress: current < 0 ? message.progress : (current + message.progress) / scannedPages.length,
        });
      },
    });
    try {
      for (const item of scannedPages) {
        activeOcrPage = item.pageNumber;
        const viewport = item.page.getViewport({ scale: 2 });
        const canvas = canvasForPage(viewport.width, viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("浏览器无法创建 OCR 画布");
        const renderViewport = item.page.getViewport({
          scale: 2 * (canvas.width / viewport.width),
        });
        await item.page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        }).promise;
        const result = await worker.recognize(canvas);
        const text = result.data.text.trim();
        if (text) sections.push(`【PDF 第 ${item.pageNumber} 页 · OCR】\n${text}`);
      }
    } finally {
      await worker.terminate();
    }
  }

  sections.sort((left, right) => {
    const leftPage = Number(left.match(/第 (\d+) 页/)?.[1] ?? 0);
    const rightPage = Number(right.match(/第 (\d+) 页/)?.[1] ?? 0);
    return leftPage - rightPage;
  });
  return {
    text: sections.join("\n\n"),
    pages: pdf.numPages,
    ocrPages: scannedPages.length,
  };
}
