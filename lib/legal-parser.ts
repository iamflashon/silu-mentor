export type LegalCategory = "法律" | "命令";

export type LegalArchiveEntry = {
  record: Record<string, unknown>;
  category: LegalCategory;
};

function valueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("\n").trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["#text", "Text", "text", "Content", "content", "Value", "value"]) {
      const nested = valueText(record[key]);
      if (nested) return nested;
    }
  }
  return "";
}

export function pickLegalValue(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = valueText(record[name]);
    if (value) return value;
  }
  return "";
}

function articleContainer(record: Record<string, unknown>) {
  return record.LawArticles ?? record.Articles ?? record.條文 ?? record.法規內容;
}

export function normalizeLegalRecord(record: Record<string, unknown>) {
  const content = record.法規內容;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const nested = content as Record<string, unknown>;
    return {
      ...record,
      條文: nested.條文 ?? record.條文,
      編章節: nested.編章節 ?? record.編章節,
    };
  }
  return record;
}

export function collectLawObjects(value: unknown, rows: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectLawObjects(item, rows);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (pickLegalValue(record, ["LawName", "法規名稱"]) && articleContainer(record)) {
      rows.push(normalizeLegalRecord(record));
    } else {
      for (const child of Object.values(record)) collectLawObjects(child, rows);
    }
  }
  return rows;
}

export function collectArticles(value: unknown, rows: Array<{ no: string; hierarchy: string; content: string }> = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectArticles(item, rows);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const content = pickLegalValue(record, ["ArticleContent", "ArticleText", "Content", "條文內容", "條文"]);
    const no = pickLegalValue(record, ["ArticleNo", "ArticleNumber", "ArticleNum", "條號", "條次"]);
    if (content && (no || /第\s*[^\s]+\s*條/.test(content))) {
      rows.push({
        no: no || content.match(/第\s*[^\s]+\s*條/)?.[0] || "",
        hierarchy: pickLegalValue(record, ["ArticleKind", "Chapter", "Section", "編章節"]),
        content,
      });
    } else {
      for (const child of Object.values(record)) collectArticles(child, rows);
    }
  }
  return rows;
}

export function normalizedArticles(value: unknown) {
  return collectArticles(value)
    .map((item, index) => ({
      articleNo: item.no || `第${index + 1}條`,
      hierarchy: item.hierarchy || "",
      content: item.content.trim(),
    }))
    .filter((item) => item.content.length > 0);
}

export function compactLegalRecord(record: Record<string, unknown>) {
  const normalized = normalizeLegalRecord(record);
  const compact: Record<string, unknown> = {};
  for (const name of [
    "LawName", "法規名稱", "LawModifiedDate", "ModifiedDate", "最新異動日期",
    "LawEffectiveDate", "EffectiveDate", "生效日期", "LawHistories", "Histories",
    "沿革內容", "LawURL", "Url", "法規網址", "LawType", "法規性質",
    "Category", "法規類別", "LawCategory", "LawArticles", "Articles", "條文", "編章節",
  ]) {
    if (normalized[name] !== undefined) compact[name] = normalized[name];
  }
  return compact;
}

export function legalCategory(record: Record<string, unknown>, fallback: LegalCategory = "法律"): LegalCategory {
  const nature = pickLegalValue(record, ["LawType", "法規性質", "RegulationType"]);
  if (/命令|行政規則|法規命令/.test(nature)) return "命令";
  if (/法律|憲法/.test(nature)) return "法律";
  return fallback;
}

export function legalClassification(record: Record<string, unknown>) {
  return pickLegalValue(record, ["Category", "法規類別", "LawCategory", "分類"]);
}

export function legalTitle(record: Record<string, unknown>) {
  return pickLegalValue(record, ["LawName", "法規名稱"]);
}

export function parseLegalXml(xml: string) {
  // fast-xml-parser is imported dynamically so this pure helper can be shared
  // by the browser importer and the Worker route without bundling it twice.
  return import("fast-xml-parser").then(({ XMLParser }) => {
    const parsed = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
      isArray: (name: string) => name === "法規" || name === "條文",
    }).parse(xml);
    return collectLawObjects(parsed);
  });
}

