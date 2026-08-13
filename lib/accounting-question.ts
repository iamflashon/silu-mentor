export function removeAccountingPageFurniture(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/\[\[PAGE:\s*\d+\]\]/gu, "")
    // Chapter running heads, with or without spaces between title and page code.
    .replace(/^\s*第\s*[一二三四五六七八九十百0-9]+\s*章[^\n]{0,80}?(?:\s|^)(?:\d{1,2}\s*[-－–]\s*\d{1,3})\s*$/gmu, "")
    .replace(/^\s*\d{1,2}\s*[-－–]\s*\d{1,3}\s*第\s*[一二三四五六七八九十百0-9]+\s*章[^\n]{0,80}$/gmu, "")
    .replace(/^\s*第\s*[一二三四五六七八九十百0-9]+\s*章\s*[^\n]{1,50}\s*$/gmu, (line) => /\d{1,2}\s*[-－–]\s*\d{1,3}\s*$/u.test(line) ? "" : line)
    .replace(/^\s*(?:中級會計學|題庫制霸|申論題完全制霸|解題全攻略)\s*\d*\s*$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function accountingQuestionFlags(value: string) {
  const lines = value.split("\n").map(line => line.trim()).filter(Boolean);
  const pageFurniture = lines.some(line => /^第\s*[一二三四五六七八九十百0-9]+\s*章.*\d{1,2}\s*[-－–]\s*\d{1,3}$/u.test(line));
  const denseNumericRows = lines.filter(line => (line.match(/(?:\$?\(?-?\d[\d,]*(?:\.\d+)?\)?)/gu) ?? []).length >= 3).length;
  const brokenGlyphs = /[□�]|\[\[PAGE:/u.test(value);
  return { pageFurniture, denseNumericRows, brokenGlyphs, needsTableReview: denseNumericRows >= 2 };
}

export type AccountingDisplayBlock =
  | { type: "text"; lines: string[] }
  | { type: "table"; rows: Array<{ label: string; values: string[] }> };

const numberToken = /\$?\(?-?\d[\d,]*(?:\.\d+)?\)?/gu;

export function accountingDisplayBlocks(value: string): AccountingDisplayBlock[] {
  const lines = removeAccountingPageFurniture(value).split("\n").map(line => line.trim()).filter(Boolean);
  const blocks: AccountingDisplayBlock[] = [];
  let text: string[] = [];
  let rows: Array<{ label: string; values: string[] }> = [];
  const flushText = () => { if (text.length) blocks.push({ type: "text", lines: text }); text = []; };
  const flushRows = () => { if (rows.length) blocks.push(rows.length >= 2 ? { type: "table", rows } : { type: "text", lines: rows.map(row => [row.label, ...row.values].join(" ")) }); rows = []; };
  for (const line of lines) {
    const matches = [...line.matchAll(numberToken)];
    const looksLikeStatementRow = matches.length >= 2 && matches[0]?.index !== 0;
    if (looksLikeStatementRow) {
      flushText();
      const first = matches[0].index ?? line.length;
      rows.push({ label: line.slice(0, first).trim(), values: matches.map(match => match[0]) });
    } else {
      flushRows();
      text.push(line);
    }
  }
  flushRows(); flushText();
  return blocks;
}
