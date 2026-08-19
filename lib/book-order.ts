type BookOrderRow = {
  lessonLabel?: string | null;
  title?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  sequence?: number | null;
};

const MISSING_ORDER = Number.MAX_SAFE_INTEGER;

function firstNumber(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return MISSING_ORDER;
}

function dottedNumber(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1].replaceAll("．", ".").split(".").map(Number);
  }
  return [MISSING_ORDER];
}

function compareNumberPath(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference) return difference;
  }
  return 0;
}

function orderKey(row: BookOrderRow) {
  const label = String(row.lessonLabel ?? "").normalize("NFKC");
  const title = String(row.title ?? "").normalize("NFKC");
  const part = firstNumber(label, [/第\s*(\d+)\s*部分/u, /第\s*(\d+)\s*篇/u]);
  const chapter = firstNumber(label, [/第\s*(\d+)\s*章/u]);
  const topic = dottedNumber(label, [/(?:主題|題組|單元)\s*(\d+(?:[.．]\d+)*)/u]);
  const question = dottedNumber(title, [/(?:題型|案例|例題)\s*(\d+(?:[.．]\d+)*)/u, /第\s*(\d+)\s*題/u]);
  const effectiveTopic = topic[0] === MISSING_ORDER && question[0] !== MISSING_ORDER
    ? [question[0]]
    : topic;

  return {
    part,
    chapter,
    topic: effectiveTopic,
    question,
    pageStart: row.pageStart ?? MISSING_ORDER,
    pageEnd: row.pageEnd ?? MISSING_ORDER,
    sequence: row.sequence ?? MISSING_ORDER,
    title,
  };
}

/** Sort verified rows by absolute PDF position. Printed topic numbers repeat. */
export function sortByBookOrder<T extends BookOrderRow>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const a = orderKey(left);
    const b = orderKey(right);
    return a.pageStart - b.pageStart
      || a.pageEnd - b.pageEnd
      || a.sequence - b.sequence
      || a.title.localeCompare(b.title, "zh-Hant", { numeric: true });
  });
}
