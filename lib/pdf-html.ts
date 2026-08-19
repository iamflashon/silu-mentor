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

type PdfPathOperatorList = {
  fnArray: number[];
  argsArray: unknown[][];
};

export type PdfTableGrid = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  columns: number[];
  rows: number[];
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

function numericArray(value: unknown) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<number>).map(Number).filter(Number.isFinite);
  return [];
}

function segmentGroups(values: Array<{ coordinate: number; start: number; end: number }>, tolerance = 2.5) {
  const groups: Array<{ coordinate: number; start: number; end: number; count: number }> = [];
  for (const value of values.sort((a, b) => a.coordinate - b.coordinate)) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.coordinate - value.coordinate) <= tolerance) {
      previous.coordinate = (previous.coordinate * previous.count + value.coordinate) / (previous.count + 1);
      previous.start = Math.min(previous.start, value.start);
      previous.end = Math.max(previous.end, value.end);
      previous.count += 1;
    } else {
      groups.push({ ...value, count: 1 });
    }
  }
  return groups;
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Read vector borders emitted by PDF.js. This is much more reliable than
 * guessing columns from text when a PDF contains a real drawn table. */
export function extractPdfTableGrid(operatorList: PdfPathOperatorList, ops: { constructPath: number; rectangle: number; moveTo: number; lineTo: number; curveTo: number; curveTo2: number; curveTo3: number; closePath: number }) {
  const verticalSegments: Array<{ coordinate: number; start: number; end: number }> = [];
  const horizontalSegments: Array<{ coordinate: number; start: number; end: number }> = [];
  const addSegment = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x1 - x2) <= 2.5 && Math.abs(y1 - y2) >= 18) verticalSegments.push({ coordinate: (x1 + x2) / 2, start: Math.min(y1, y2), end: Math.max(y1, y2) });
    if (Math.abs(y1 - y2) <= 2.5 && Math.abs(x1 - x2) >= 18) horizontalSegments.push({ coordinate: (y1 + y2) / 2, start: Math.min(x1, x2), end: Math.max(x1, x2) });
  };
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];
    if (fn === ops.rectangle) {
      const [x, y, width, height] = numericArray(args).slice(0, 4);
      if ([x, y, width, height].every(Number.isFinite)) {
        addSegment(x, y, x + width, y);
        addSegment(x + width, y, x + width, y + height);
        addSegment(x + width, y + height, x, y + height);
        addSegment(x, y + height, x, y);
      }
      continue;
    }
    if (fn !== ops.constructPath) continue;
    const paths = args[1];
    if (!Array.isArray(paths)) continue;
    for (const path of paths) {
      const values = numericArray(path);
      let current: { x: number; y: number } | null = null;
      for (let offset = 0; offset < values.length;) {
        const command = values[offset++];
        if (command === 0 || command === ops.moveTo) {
          if (offset + 1 >= values.length) break;
          current = { x: values[offset++], y: values[offset++] };
        } else if (command === 1 || command === ops.lineTo) {
          if (!current || offset + 1 >= values.length) break;
          const next = { x: values[offset++], y: values[offset++] };
          addSegment(current.x, current.y, next.x, next.y);
          current = next;
        } else if (command === 2 || command === ops.curveTo) {
          offset += 6;
          current = offset >= 2 ? { x: values[offset - 2], y: values[offset - 1] } : current;
        } else if (command === 3 || command === ops.curveTo2) {
          offset += 4;
          current = offset >= 2 ? { x: values[offset - 2], y: values[offset - 1] } : current;
        } else if (command === 4 || command === ops.closePath) {
          current = null;
        } else {
          // Unknown path command: stop parsing this path rather than inventing
          // coordinates from the following values.
          break;
        }
      }
    }
  }
  const verticals = segmentGroups(verticalSegments).filter((line) => line.end - line.start >= 22);
  const horizontals = segmentGroups(horizontalSegments).filter((line) => line.end - line.start >= 22);
  if (verticals.length < 3 || horizontals.length < 3) return null;
  const bestVerticals = verticals.map((line) => verticals.filter((other) => overlapLength(line.start, line.end, other.start, other.end) >= 18)).sort((a, b) => b.length - a.length)[0] ?? [];
  const bestHorizontals = horizontals.map((line) => horizontals.filter((other) => overlapLength(line.start, line.end, other.start, other.end) >= 18)).sort((a, b) => b.length - a.length)[0] ?? [];
  if (bestVerticals.length < 3 || bestHorizontals.length < 3) return null;
  const bottom = Math.max(...bestVerticals.map((line) => line.start));
  const top = Math.min(...bestVerticals.map((line) => line.end));
  const left = Math.max(...bestHorizontals.map((line) => line.start));
  const right = Math.min(...bestHorizontals.map((line) => line.end));
  const columns = bestVerticals.map((line) => line.coordinate).filter((x) => x >= left - 3 && x <= right + 3).sort((a, b) => a - b);
  const rows = bestHorizontals.map((line) => line.coordinate).filter((y) => y >= bottom - 3 && y <= top + 3).sort((a, b) => b - a);
  if (columns.length < 3 || rows.length < 3 || right - left < 80 || top - bottom < 30) return null;
  return { left, right, top, bottom, columns, rows };
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

function gridColumnForX(x: number, columns: number[]) {
  for (let index = 0; index < columns.length - 1; index += 1) {
    if (x >= columns[index] - 3 && x < columns[index + 1] + 3) return index;
  }
  return -1;
}

function gridRowForY(y: number, rows: number[]) {
  for (let index = 0; index < rows.length - 1; index += 1) {
    if (y <= rows[index] + 3 && y >= rows[index + 1] - 3) return index;
  }
  return -1;
}

function renderGridTable(items: PdfTextItem[], grid: PdfTableGrid) {
  const cellItems = new Map<string, PdfTextItem[]>();
  for (const item of items) {
    const column = gridColumnForX(item.x, grid.columns);
    const row = gridRowForY(item.y, grid.rows);
    if (column < 0 || row < 0) continue;
    const key = `${row}:${column}`;
    cellItems.set(key, [...(cellItems.get(key) ?? []), item]);
  }
  const rows: Array<Map<number, string[]>> = [];
  const columnCount = grid.columns.length - 1;
  for (let row = 0; row < grid.rows.length - 1; row += 1) {
    const cells = new Map<number, string[]>();
    for (let column = 0; column < columnCount; column += 1) {
      const source = cellItems.get(`${row}:${column}`) ?? [];
      if (!source.length) continue;
      const grouped = groupTextLines(source).map((line) => line.segments.map((segment) => segment.text).join(" "));
      cells.set(column, grouped.filter(Boolean));
    }
    rows.push(cells);
  }
  const textCount = rows.reduce((sum, row) => sum + [...row.values()].flat().join("").length, 0);
  if (textCount < 8) return null;
  return { rows, columnCount };
}

/**
 * Converts positioned PDF text into copyable HTML tables when the page contains
 * repeated aligned columns. The original PDF remains available beside this
 * layer, so uncertain layouts are never silently rewritten as a fake table.
 */
export function renderPdfPageHtml(items: PdfTextItem[], pageNumber: number, grid?: PdfTableGrid | null) {
  const lines = groupTextLines(items);
  if (grid) {
    const table = renderGridTable(items, grid);
    if (table) {
      const tableTop = grid.top;
      const tableBottom = grid.bottom;
      const before = lines.filter((line) => line.y > tableTop + 3).map(renderPlainLine);
      const after = lines.filter((line) => line.y < tableBottom - 3).map(renderPlainLine);
      const tableMarkup = `<div class="pdf-table-wrap" data-table-number="1"><div class="pdf-table-label">可複製表格 1</div>${renderTable(table.rows, table.columnCount)}</div>`;
      return {
        html: `<section class="pdf-page" id="page-${pageNumber}"><div class="page-label">第 ${pageNumber} 頁</div><div class="pdf-page-content">${[...before, tableMarkup, ...after].join("")}</div></section>`,
        tableCount: 1,
      };
    }
  }
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
