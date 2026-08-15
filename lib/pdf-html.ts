type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type PdfTextLine = {
  items: PdfTextItem[];
  y: number;
  segments: Array<{ x: number; text: string }>;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function groupTextLines(sourceItems: PdfTextItem[]) {
  const items = sourceItems
    .filter((item) => cleanText(item.str))
    .map((item) => ({ ...item, str: item.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextLine[] = [];
  for (const item of items) {
    const tolerance = Math.max(2.5, item.fontSize * 0.42);
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      line.y = (line.y + item.y) / 2;
    } else {
      lines.push({ items: [item], y: item.y, segments: [] });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const segments: Array<{ x: number; text: string }> = [];
    let current: { x: number; text: string } | null = null;
    let previous: PdfTextItem | null = null;
    for (const item of line.items) {
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const split = Boolean(current && gap > Math.max(18, item.fontSize * 1.65));
      if (!current || split) {
        current = { x: item.x, text: item.str };
        segments.push(current);
      } else {
        const needsSpace = gap > Math.max(2, item.fontSize * 0.28)
          && /[A-Za-z0-9)\]】]$/u.test(current.text)
          && /^[A-Za-z0-9([【]/u.test(item.str);
        current.text += `${needsSpace ? " " : ""}${item.str}`;
      }
      previous = item;
    }
    line.segments = segments.map((segment) => ({ x: segment.x, text: cleanText(segment.text) }));
  }
  return lines;
}

function clusterColumnStarts(lines: PdfTextLine[]) {
  const values = lines.flatMap((line, lineIndex) =>
    (line.segments.length >= 2 ? line.segments : []).map((segment) => ({ x: segment.x, lineIndex })),
  ).sort((a, b) => a.x - b.x);
  const clusters: Array<{ x: number; values: number[]; lines: Set<number> }> = [];
  for (const value of values) {
    const cluster = clusters.at(-1);
    if (cluster && Math.abs(value.x - cluster.x) <= 12) {
      cluster.values.push(value.x);
      cluster.lines.add(value.lineIndex);
      cluster.x = cluster.values.reduce((sum, item) => sum + item, 0) / cluster.values.length;
    } else {
      clusters.push({ x: value.x, values: [value.x], lines: new Set([value.lineIndex]) });
    }
  }
  return clusters
    .filter((cluster) => cluster.lines.size >= 2)
    .map((cluster) => cluster.x)
    .filter((x, index, all) => index === 0 || x - all[index - 1] >= 24);
}

function columnForX(x: number, columns: number[]) {
  if (!columns.length) return -1;
  if (x < columns[0] - 18) return -1;
  for (let index = 0; index < columns.length - 1; index += 1) {
    if (x < (columns[index] + columns[index + 1]) / 2) return index;
  }
  return columns.length - 1;
}

function lineCells(line: PdfTextLine, columns: number[]) {
  const cells = new Map<number, string[]>();
  for (const segment of line.segments) {
    const column = columnForX(segment.x, columns);
    if (column < 0) continue;
    const values = cells.get(column) ?? [];
    values.push(segment.text);
    cells.set(column, values);
  }
  return cells;
}

function renderCell(value: string) {
  return escapeHtml(value).replace(/\n/gu, "<br>");
}

function renderTable(rows: Array<Map<number, string[]>>, columnCount: number) {
  const mergedRows: Array<Map<number, string[]>> = [];
  for (const row of rows) {
    const firstCell = row.get(0)?.join(" ").trim() ?? "";
    const previous = mergedRows.at(-1);
    if (!firstCell && previous) {
      for (const [column, values] of row.entries()) {
        previous.set(column, [...(previous.get(column) ?? []), ...values]);
      }
    } else {
      mergedRows.push(new Map(row));
    }
  }
  const htmlRows = mergedRows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, column) =>
      (row.get(column) ?? []).join(" ").trim(),
    );
    const rendered = cells.map((cell) => {
      const tag = rowIndex === 0 ? "th" : "td";
      return `<${tag}${rowIndex === 0 ? ' scope="col"' : ""}>${renderCell(cell)}</${tag}>`;
    }).join("");
    return `<tr>${rendered}</tr>`;
  });
  return `<table class="pdf-table"><thead>${htmlRows[0] ?? ""}</thead><tbody>${htmlRows.slice(1).join("")}</tbody></table>`;
}

function renderPlainLine(line: PdfTextLine) {
  return `<div class="pdf-line">${escapeHtml(line.segments.map((segment) => segment.text).join(" "))}</div>`;
}

/**
 * Converts positioned PDF text into copyable HTML tables when the page contains
 * repeated aligned columns. The original PDF remains available beside this
 * layer, so uncertain layouts are never silently rewritten as a fake table.
 */
export function renderPdfPageHtml(items: PdfTextItem[], pageNumber: number) {
  const lines = groupTextLines(items);
  const columns = clusterColumnStarts(lines);
  const tableLines = lines.map((line) => {
    const cells = lineCells(line, columns);
    const filled = [...cells.keys()];
    return { cells, filled, isTableLine: filled.length >= 2 && (Math.max(...filled) - Math.min(...filled) >= 1) };
  });
  const consumed = new Set<number>();
  const blocks: string[] = [];
  let tableCount = 0;
  let index = 0;
  while (index < tableLines.length) {
    if (!tableLines[index].isTableLine) {
      blocks.push(renderPlainLine(lines[index]));
      index += 1;
      continue;
    }
    const start = index;
    const rows: Array<Map<number, string[]>> = [];
    while (index < tableLines.length && tableLines[index].isTableLine) {
      rows.push(tableLines[index].cells);
      consumed.add(index);
      index += 1;
    }
    const usedColumns = new Set(rows.flatMap((row) => [...row.keys()]));
    const isTable = rows.length >= 2 && usedColumns.size >= 3 && columns.length >= 3
      && rows.reduce((sum, row) => sum + [...row.values()].flat().join(" ").length, 0) >= 20;
    if (!isTable) {
      for (let lineIndex = start; lineIndex < index; lineIndex += 1) blocks.push(renderPlainLine(lines[lineIndex]));
      continue;
    }
    tableCount += 1;
    blocks.push(`<div class="pdf-table-wrap" data-table-number="${tableCount}"><div class="pdf-table-label">可複製表格 ${tableCount}</div>${renderTable(rows, columns.length)}</div>`);
  }
  // `consumed` is intentionally only used to document the block ownership; the
  // loop above already emits every line exactly once and keeps non-table text.
  void consumed;
  return {
    html: `<section class="pdf-page" id="page-${pageNumber}"><div class="page-label">第 ${pageNumber} 頁</div><div class="pdf-page-content">${blocks.join("") || '<div class="pdf-line pdf-empty">此頁沒有可擷取的文字。</div>'}</div></section>`,
    tableCount,
  };
}

export function plainPdfPageText(items: PdfTextItem[]) {
  return groupTextLines(items).map((line) => line.segments.map((segment) => segment.text).join(" ")).join("\n");
}
