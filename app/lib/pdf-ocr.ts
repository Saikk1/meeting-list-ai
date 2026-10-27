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

function boundedRead<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("文字识别超时，请检查组件下载网络，或改用文字记录")),
      120000,
    );
    const abort = () => fail(new DOMException("已停止读取资料", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      cleanup();
      resolve(value);
    }, fail);
    if (signal?.aborted) abort();
  });
}

async function ocrWorker(
  logger: (message: { status: string; progress: number }) => void,
  signal?: AbortSignal,
) {
  const { createWorker } = await import("tesseract.js");
  const pending = createWorker(["chi_sim", "eng"], undefined, { logger });
  try {
    return await boundedRead(pending, signal);
  } catch (error) {
    void pending.then((worker) => worker.terminate()).catch(() => {});
    throw error;
  }
}

export async function recognizeImageText(
  image: File | HTMLCanvasElement,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
) {
  const worker = await ocrWorker((message) => {
    if (
      message.status === "recognizing text" &&
      typeof message.progress === "number"
    ) {
      onProgress?.(message.progress);
    }
  }, signal);
  try {
    const result = await boundedRead(worker.recognize(image), signal);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractPdfWithOcr(
  buffer: ArrayBuffer,
  onProgress?: (state: DocumentReadProgress) => void,
  signal?: AbortSignal,
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const abort = () => {
    void documentTask.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await boundedRead(documentTask.promise, signal);
    if (pdf.numPages > 60) {
      throw new Error(
        `PDF 共 ${pdf.numPages} 页，超过单次 60 页上限，请拆分后导入`,
      );
    }

    const sections: { page: number; text: string; ocr: boolean }[] = [];
    const scannedPages: Array<{
      pageNumber: number;
      page: Awaited<ReturnType<typeof pdf.getPage>>;
    }> = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.({
        stage: "reading",
        page: pageNumber,
        pages: pdf.numPages,
        progress: pageNumber / pdf.numPages,
      });
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
        sections.push({ page: pageNumber, text, ocr: false });
      } else {
        scannedPages.push({ pageNumber, page });
      }
    }

    if (scannedPages.length > 30) {
      throw new Error(
        `PDF 中有 ${scannedPages.length} 页扫描内容，超过单次 OCR 30 页上限，请拆分后导入`,
      );
    }
    if (scannedPages.length) {
      let activeOcrPage = scannedPages[0]?.pageNumber ?? 1;
      const worker = await ocrWorker((message) => {
        if (
          message.status !== "recognizing text" ||
          typeof message.progress !== "number"
        )
          return;
        const current = scannedPages.findIndex(
          (item) => item.pageNumber === activeOcrPage,
        );
        onProgress?.({
          stage: "ocr",
          page: activeOcrPage,
          pages: pdf.numPages,
          progress:
            current < 0
              ? message.progress
              : (current + message.progress) / scannedPages.length,
        });
      }, signal);
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
          const result = await boundedRead(worker.recognize(canvas), signal);
          const text = result.data.text.trim();
          sections.push({ page: item.pageNumber, text, ocr: true });
        }
      } finally {
        await worker.terminate();
      }
    }

    sections.sort((left, right) => left.page - right.page);
    return {
      text: sections
        .filter((s) => s.text)
        .map(
          (s) => `【PDF 第 ${s.page} 页${s.ocr ? " · OCR" : ""}】\n${s.text}`,
        )
        .join("\n\n"),
      sections,
      pages: pdf.numPages,
      ocrPages: scannedPages.length,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await documentTask.destroy().catch(() => {});
  }
}
