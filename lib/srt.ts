export type ParsedSrtSegment = {
  start: number;
  end: number;
  text: string;
};

function seconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  const numeric = parts.map(Number);
  if (!numeric.every(Number.isFinite)) return NaN;
  if (parts.length === 3) return numeric[0] * 3600 + numeric[1] * 60 + numeric[2];
  if (parts.length === 2) return numeric[0] * 60 + numeric[1];
  return NaN;
}

function cleanSubtitleText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

const timestamp = String.raw`\d{1,3}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?`;
const timestampLine = new RegExp(String.raw`^\s*(${timestamp})\s*-->\s*(${timestamp})(?:\s+.*)?\s*$`);

function normalizeSrt(raw: string) {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

/** Parse individual cues, accepting common SRT variants and WebVTT-style headers. */
export function parseSrtCues(raw: string): ParsedSrtSegment[] {
  const lines = normalizeSrt(raw).split("\n");
  const cues: ParsedSrtSegment[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    const match = line.match(timestampLine);
    if (!match && /^\d+$/.test(line) && timestampLine.test(lines[index + 1] ?? "")) {
      index += 1;
      continue;
    }
    if (!match) {
      index += 1;
      continue;
    }
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && !timestampLine.test(lines[index])) {
      const next = lines[index];
      if (/^\s*\d+\s*$/.test(next) && timestampLine.test(lines[index + 1] ?? "")) break;
      if (next.trim()) textLines.push(next);
      index += 1;
    }
    const text = cleanSubtitleText(textLines.join("\n"));
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Keep the historical chunking behavior for callers that need larger study segments. */
export function parseSrt(raw: string): ParsedSrtSegment[] {
  const cues = parseSrtCues(raw);
  const groups: ParsedSrtSegment[] = [];
  for (const cue of cues) {
    const current = groups.at(-1);
    if (!current || cue.end - current.start > 90 || current.text.length >= 650) {
      groups.push({ ...cue });
    } else {
      current.end = cue.end;
      current.text += ` ${cue.text}`;
    }
  }
  return groups;
}

export function decodeSubtitle(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.slice(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.slice(2));
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder("utf-8").decode(data.slice(3));
  // Windows editors sometimes save UTF-16 SRT without a BOM. Detect the
  // characteristic NUL-byte pattern before falling back to UTF-8.
  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < Math.min(data.length, 4096); index += 1) {
    if (data[index] !== 0) continue;
    if (index % 2 === 0) evenNuls += 1;
    else oddNuls += 1;
  }
  if (oddNuls > 20 && oddNuls > evenNuls * 2) return new TextDecoder("utf-16le").decode(data);
  if (evenNuls > 20 && evenNuls > oddNuls * 2) return new TextDecoder("utf-16be").decode(data);
  return new TextDecoder("utf-8").decode(data);
}

export function looksLikeRawSrt(value: string) {
  return new RegExp(`${timestamp}\\s*-->`).test(value);
}
