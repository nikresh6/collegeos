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

  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
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
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3.5);
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
          if (items.length === 0) return "";

          const segments: Array<{
            x: number;
            end: number;
            text: string;
          }> = [];

          for (const item of items) {
            const previous = segments[segments.length - 1];
            if (!previous) {
              segments.push({
                x: item.x,
                end: item.x + item.width,
                text: item.text,
              });
              continue;
            }

            const gap = item.x - previous.end;
            const previousCharWidth =
              previous.text.length > 0
                ? Math.max(1, (previous.end - previous.x) / previous.text.length)
                : 4;
            const adaptiveGap = Math.max(5, Math.min(11, previousCharWidth * 1.8));

            if (gap <= adaptiveGap) {
              previous.text = `${previous.text} ${item.text}`.replace(/\s+/g, " ").trim();
              previous.end = Math.max(previous.end, item.x + item.width);
            } else {
              segments.push({
                x: item.x,
                end: item.x + item.width,
                text: item.text,
              });
            }
          }

          if (segments.length === 1) {
            return segments[0].text;
          }

          // Preserve actual PDF x positions for table/grid rows. This lets the
          // AI distinguish columns even when PDF.js emits cells in a flattened
          // text stream. Coordinates are rounded to keep token overhead low.
          return segments
            .map((segment) => `[x=${Math.round(segment.x)}] ${segment.text}`)
            .join("  ");
        })
        .filter(Boolean)
        .join("\n");

      pageTexts.push(text);
      pages.push(`\n\n===== PAGE ${pageNumber} =====\n${text}`);

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
