export type MagazineAnalysis = {
  summary: string;
  issue: string;
};

function clean(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function formatMagazineAnalysis(summary: string, issue: string) {
  return `摘要：${clean(summary)}\n核心爭點：${clean(issue)}`.trim();
}

export function parseMagazineAnalysis(value: string): MagazineAnalysis {
  const normalized = clean(value);
  if (!normalized) return { summary: "", issue: "" };

  const labelledSummary = normalized.match(
    /(?:^|\n)摘要[:：]\s*([\s\S]*?)(?=\n(?:核心|主要)?爭點[:：]|$)/,
  )?.[1]?.trim();
  const labelledIssue = normalized.match(
    /(?:^|\n)(?:核心|主要)?爭點[:：]\s*([\s\S]*?)$/,
  )?.[1]?.trim();
  if (labelledSummary || labelledIssue) {
    return { summary: labelledSummary ?? "", issue: labelledIssue ?? "" };
  }

  const legacy = normalized.match(/^爭點[:：]\s*(.*?)(?:[｜|]\s*([\s\S]*))?$/);
  if (legacy) {
    return { issue: legacy[1]?.trim() ?? "", summary: legacy[2]?.trim() ?? "" };
  }

  // The latest pre-structured importer stored only the issue in this field.
  return { summary: "", issue: normalized };
}
