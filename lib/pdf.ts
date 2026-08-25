export async function extractPdfText(file: File) {
  // pdfjs-dist's Node auto-polyfill relies on process.getBuiltinModule, which
  // is unavailable in some Vercel Node runtimes. Install the canvas-backed
  // DOM primitives explicitly before importing PDF.js.
  const canvas = await import("@napi-rs/canvas");
  const serverGlobals = globalThis as typeof globalThis & {
    DOMMatrix?: typeof globalThis.DOMMatrix;
    ImageData?: typeof globalThis.ImageData;
    Path2D?: typeof globalThis.Path2D;
  };

  serverGlobals.DOMMatrix ??=
    canvas.DOMMatrix as unknown as typeof globalThis.DOMMatrix;
  serverGlobals.ImageData ??=
    canvas.ImageData as unknown as typeof globalThis.ImageData;
  serverGlobals.Path2D ??=
    canvas.Path2D as unknown as typeof globalThis.Path2D;

  // Keep pdf.js out of the route's module initialization. If the deployment is
  // missing an optional PDF runtime dependency, the request can now return a
  // useful JSON error instead of Next.js/Vercel returning an HTML 500 page.
  const { getDocument } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  const bytes = new Uint8Array(await file.arrayBuffer());

  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
  });

  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (
      let pageNumber = 1;
      pageNumber <= document.numPages;
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      const text = content.items
        .map((item) => {
          if ("str" in item && typeof item.str === "string") {
            return item.str;
          }

          return "";
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pages.push(
        `\n\n===== PAGE ${pageNumber} =====\n${text}`,
      );

      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return {
    pageCount: pages.length,
    text: pages.join("").trim(),
  };
}
