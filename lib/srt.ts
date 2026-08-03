export type ParsedSrtSegment = {
  start: number;
  end: number;
  text: string;
};

function seconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [hours, minutes, secondsValue] = parts.map(Number);
    if (![hours, minutes, secondsValue].every(Number.isFinite)) return NaN;
    return Math.round(hours * 3600 + minutes * 60 + secondsValue);
  }
  if (parts.length === 2) {
    const [minutes, secondsValue] = parts.map(Number);
    if (![minutes, secondsValue].every(Number.isFinite)) return NaN;
    return Math.round(minutes * 60 + secondsValue);
  }
  return NaN;
}

export function parseSrt(raw: string): ParsedSrtSegment[] {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  const cuePattern = /(?:^|\n)\s*(?:\d+\s*\n)?\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*(?:\d+\s*\n)?\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->|$)/g;
  const cues: ParsedSrtSegment[] = [];
  for (const match of normalized.matchAll(cuePattern)) {
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = match[3]
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start)
      cues.push({ start, end, text });
  }

  const groups: ParsedSrtSegment[] = [];
  for (const cue of cues) {
    const current = groups.at(-1);
    if (!current || cue.end - current.start > 90 || current.text.length >= 650)
      groups.push({ ...cue });
    else {
      current.end = cue.end;
      current.text += ` ${cue.text}`;
    }
  }
  return groups;
}

export function looksLikeRawSrt(value: string) {
  return /\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->/.test(value);
}

