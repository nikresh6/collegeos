const HTML_PATTERN = /<\/?[a-z][\s\S]*>/i;

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function noteContentToPlainText(value: string | null | undefined) {
  const source = value?.trim() ?? "";
  if (!source) return "";
  if (!HTML_PATTERN.test(source)) return source;

  return decodeEntities(
    source
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function noteWordCount(value: string | null | undefined) {
  const text = noteContentToPlainText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function noteContentIsHtml(value: string | null | undefined) {
  return HTML_PATTERN.test(value?.trim() ?? "");
}
