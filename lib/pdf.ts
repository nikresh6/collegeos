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

  // PDF.js disables real workers in Node and falls back to its worker module
  // in-process. Its internal fallback uses a relative dynamic import that
  // points at a non-existent Next.js chunk after Vercel bundles the route.
  // Importing the worker explicitly registers WorkerMessageHandler on
  // globalThis.pdfjsWorker, which PDF.js checks before attempting that import.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

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
  const pageTexts: string[] = [];

  try {
    for (
      let pageNumber = 1;
      pageNumber <= document.numPages;
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      const rows: Array<{
        y: number;
        items: Array<{ x: number; width: number; text: string }>;
      }> = [];

      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        const itemText = item.str.replace(/\s+/g, " ").trim();
        if (!itemText) continue;

        const x = Number(item.transform?.[4] ?? 0);
        const y = Number(item.transform?.[5] ?? 0);
        const width = Number(item.width ?? 0);
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x, width, text: itemText });
      }

      const text = rows
        .sort((left, right) => right.y - left.y)
        .map((row) => {
          const items = row.items.sort((left, right) => left.x - right.x);
          let cursor = 0;
          return items
            .map((item, index) => {
              const separator =
                index === 0 ? "" : item.x - cursor > 18 ? " | " : " ";
              cursor = Math.max(cursor, item.x + item.width);
              return `${separator}${item.text}`;
            })
            .join("")
            .trim();
        })
        .filter(Boolean)
        .join("\n");

      pageTexts.push(text);

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
    pageTexts,
    text: pages.join("").trim(),
  };
}
