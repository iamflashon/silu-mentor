const entityMap: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

export type ConstitutionalListing = {
  externalId: string;
  title: string;
  sourceUrl: string;
};

export function decodeHtml(value: string) {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => {
      const number = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    })
    .replace(/&(?:nbsp|amp|quot|#39|lt|gt);/gi, (entity) => entityMap[entity.toLowerCase()] ?? entity);
}

function textFromHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>(?=.)/gi, "\n")
      .replace(/<\/(?:p|div|li|pre|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractConstitutionalListings(html: string, sourceUrl: string, sourceKey: string) {
  const fid = sourceKey === "constitutional-interpretations" ? "100" : "38";
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const rows: ConstitutionalListing[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1];
    const hrefMatch = attributes.match(/\bhref=["']([^"']*docdata\.aspx\?[^"']*)["']/i);
    if (!hrefMatch) continue;
    const href = decodeHtml(hrefMatch[1]);
    const hrefUrl = new URL(href, sourceUrl);
    const id = hrefUrl.searchParams.get("id") ?? "";
    if (hrefUrl.searchParams.get("fid") !== fid || !id) continue;
    if (seen.has(id)) continue;
    const titleMatch = attributes.match(/\btitle=["']([^"']+)["']/i);
    const title = decodeHtml((titleMatch?.[1] || textFromHtml(match[2])).trim()).replace(/\s+/g, " ");
    if (!title) continue;
    seen.add(id);
    rows.push({ externalId: `${sourceKey}:${id}`, title, sourceUrl: hrefUrl.toString() });
  }
  return rows;
}

export function extractConstitutionalContent(html: string) {
  const sections: string[] = [];
  for (const match of html.matchAll(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi)) {
    const text = textFromHtml(match[1]);
    if (text.length >= 2 && !sections.includes(text)) sections.push(text);
  }
  return sections.join("\n\n").slice(0, 500_000);
}

export function extractConstitutionalField(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(
    `<li[^>]*class=["'][^"']*title[^"']*["'][^>]*>\\s*${escaped}\\s*<\\/li>\\s*<li[^>]*class=["'][^"']*text[^"']*["'][^>]*>([\\s\\S]*?)(?=<li[^>]*class=["'][^"']*title|<\\/ul>\\s*<div[^>]*article-justice-box)`,
    "i",
  ));
  return match ? textFromHtml(match[1]) : "";
}
