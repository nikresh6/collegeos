import JSZip from "jszip";
import { extractPdfText } from "./pdf";

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<a:br\/>/g, "\n")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/a:p>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPptxText(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNumber = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const bNumber = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return aNumber - bNumber;
    });

  const slides: string[] = [];

  for (let index = 0; index < slideFiles.length; index += 1) {
    const xml = await zip.file(slideFiles[index])?.async("string");
    if (!xml) continue;

    const text = xmlText(xml);
    slides.push(`===== SLIDE ${index + 1} =====\n${text}`);
  }

  return {
    pageCount: slides.length,
    text: slides.join("\n\n").trim(),
  };
}

async function extractDocxText(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("string");

  if (!documentXml) {
    throw new Error("Could not read the DOCX document.");
  }

  return {
    pageCount: null as number | null,
    text: xmlText(documentXml),
  };
}

export async function extractMaterialText(file: File) {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const result = await extractPdfText(file);
    return {
      kind: "pdf",
      pageCount: result.pageCount,
      text: result.text,
    };
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    name.endsWith(".pptx")
  ) {
    const result = await extractPptxText(file);
    return {
      kind: "slides",
      pageCount: result.pageCount,
      text: result.text,
    };
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const result = await extractDocxText(file);
    return {
      kind: "document",
      pageCount: result.pageCount,
      text: result.text,
    };
  }

  if (
    mime.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv")
  ) {
    return {
      kind: "text",
      pageCount: null as number | null,
      text: (await file.text()).trim(),
    };
  }

  throw new Error(
    "This file type is not supported for topic analysis yet. Use PDF, PPTX, DOCX, TXT, MD, or CSV.",
  );
}

export function sampleMaterialText(text: string, maxCharacters = 16000) {
  const cleaned = text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  const expandedBudget = Math.max(
    maxCharacters,
    Math.min(50_000, maxCharacters * 5),
  );

  if (cleaned.length <= expandedBudget) {
    return cleaned;
  }

  const segmentCount = 10;
  const separatorReserve = 48 * (segmentCount - 1);
  const segmentLength = Math.max(
    900,
    Math.floor((expandedBudget - separatorReserve) / segmentCount),
  );
  const maxStart = Math.max(0, cleaned.length - segmentLength);
  const parts: string[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const ratio = index / (segmentCount - 1);
    const start = Math.round(maxStart * ratio);
    const raw = cleaned.slice(start, start + segmentLength);
    const firstBreak = index === 0 ? -1 : raw.search(/[\n.!?]\s/);
    const segment =
      firstBreak >= 0 && firstBreak < 180
        ? raw.slice(firstBreak + 1).trim()
        : raw.trim();

    if (segment) {
      parts.push(
        `===== DOCUMENT SAMPLE ${index + 1} OF ${segmentCount} =====\n${segment}`,
      );
    }
  }

  return parts.join("\n\n").slice(0, expandedBudget + 1200);
}
