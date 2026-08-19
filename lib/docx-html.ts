import { unzipSync } from "fflate";

type Entries = Record<string, Uint8Array>;
const decoder = new TextDecoder("utf-8", { fatal: false });

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attr(source: string, name: string) {
  const match = source.match(new RegExp("(?:^|\\s)(?:[\\w.-]+:)?" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  return match ? xmlDecode(match[1]) : "";
}

function valueOf(source: string, tag: string, attribute = "val") {
  const match = source.match(new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*\\b" + attribute + "\\s*=\\s*[\"']([^\"']*)[\"'][^>]*/?>", "i"));
  return match ? xmlDecode(match[1]) : "";
}

function inner(source: string, tag: string) {
  const match = source.match(new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + tag + "\\s*>", "i"));
  return match?.[1] ?? "";
}

function all(source: string, tag: string) {
  return source.match(new RegExp("<(?:[\\w.-]+:)?" + tag + "\\b[\\s\\S]*?<\\/(?:[\\w.-]+:)?" + tag + "\\s*>", "gi")) ?? [];
}

function normalizePath(target: string) {
  const raw = target.replace(/^\/+/, "");
  const parts = raw.startsWith("word/") ? raw.split("/") : ["word", ...raw.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function contentType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

function relationshipMap(entries: Entries) {
  const xml = entries["word/_rels/document.xml.rels"] ? decoder.decode(entries["word/_rels/document.xml.rels"]) : "";
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (id && target && !/^https?:/i.test(target)) result.set(id, normalizePath(target));
  }
  return result;
}

function runHtml(run: string, entries: Entries, relationships: Map<string, string>, assetPrefix: string) {
  const properties = inner(run, "rPr");
  let output = "";
  const tokens = run.match(/<(?:[\w.-]+:)?t\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?t\s*>|<(?:[\w.-]+:)?tab\b[^>]*\/?>|<(?:[\w.-]+:)?br\b[^>]*\/?>|<(?:[\w.-]+:)?cr\b[^>]*\/?>/gi) ?? [];
  for (const token of tokens) {
    if (/<(?:[\w.-]+:)?t\b/i.test(token)) output += escapeHtml(xmlDecode(token.replace(/<[^>]+>/g, "")));
    else if (/<(?:[\w.-]+:)?tab\b/i.test(token)) output += "&emsp;";
    else if (/type\s*=\s*["']page["']/i.test(token)) output += '<hr class="docx-page-break">';
    else output += "<br>";
  }
  for (const drawing of all(run, "drawing")) {
    const blip = drawing.match(/<(?:[\w.-]+:)?blip\b[^>]*>/i)?.[0] ?? "";
    const imagePath = relationships.get(attr(blip, "embed"));
    if (imagePath && entries[imagePath]) output += '<img src="' + assetPrefix + encodeURIComponent(imagePath) + '" alt="文件中的圖片" loading="lazy">';
  }
  if (!output) return "";
  if (/<(?:[\w.-]+:)?b\b[^>]*\/?>/i.test(properties)) output = "<strong>" + output + "</strong>";
  if (/<(?:[\w.-]+:)?i\b[^>]*\/?>/i.test(properties)) output = "<em>" + output + "</em>";
  if (/<(?:[\w.-]+:)?u\b[^>]*\/?>/i.test(properties)) output = "<u>" + output + "</u>";
  const vertical = valueOf(properties, "vertAlign");
  if (vertical === "superscript") output = "<sup>" + output + "</sup>";
  if (vertical === "subscript") output = "<sub>" + output + "</sub>";
  return output;
}

function paragraphHtml(paragraph: string, entries: Entries, relationships: Map<string, string>, assetPrefix: string) {
  const properties = inner(paragraph, "pPr");
  const style = valueOf(properties, "pStyle");
  const align = valueOf(properties, "jc");
  const runs = paragraph.match(/<(?:[\w.-]+:)?r\b[\s\S]*?<\/(?:[\w.-]+:)?r\s*>/gi) ?? [];
  const content = runs.map(run => runHtml(run, entries, relationships, assetPrefix)).join("");
  if (!content.trim()) return '<p class="docx-empty">&nbsp;</p>';
  const alignment = ["center", "right", "left", "both"].includes(align) ? ' style="text-align:' + (align === "both" ? "justify" : align) + '"' : "";
  const heading = style.match(/heading([1-6])/i)?.[1];
  if (heading) return "<h" + heading + alignment + ">" + content + "</h" + heading + ">";
  return /<(?:[\w.-]+:)?numPr\b/i.test(properties) ? "<li" + alignment + ">" + content + "</li>" : "<p" + alignment + ">" + content + "</p>";
}

function tableHtml(table: string, entries: Entries, relationships: Map<string, string>, assetPrefix: string) {
  const rows = all(table, "tr").map(row => {
    const cells = all(row, "tc").map(cell => {
      const span = Number(valueOf(inner(cell, "tcPr"), "gridSpan")) || 1;
      const paragraphs = cell.match(/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p\s*>/gi) ?? [];
      const content = paragraphs.map(paragraph => paragraphHtml(paragraph, entries, relationships, assetPrefix)).join("");
      return "<td" + (span > 1 ? ' colspan="' + span + '"' : "") + ">" + (content || "&nbsp;") + "</td>";
    }).join("");
    return "<tr>" + cells + "</tr>";
  }).join("");
  return "<table><tbody>" + rows + "</tbody></table>";
}

export function docxToHtml(bytes: ArrayBuffer, assetPrefix: string) {
  let entries: Entries;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("Word 檔案無法解壓，請確認檔案沒有損壞");
  }
  const documentXml = entries["word/document.xml"];
  if (!documentXml) throw new Error("Word 檔案內找不到文件正文");
  const body = inner(decoder.decode(documentXml), "body");
  const relationships = relationshipMap(entries);
  const blocks = body.match(/<(?:[\w.-]+:)?p\b[\s\S]*?<\/(?:[\w.-]+:)?p\s*>|<(?:[\w.-]+:)?tbl\b[\s\S]*?<\/(?:[\w.-]+:)?tbl\s*>/gi) ?? [];
  const rendered: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) rendered.push("<ul>" + list.join("") + "</ul>");
    list = [];
  };
  for (const block of blocks) {
    if (/<(?:[\w.-]+:)?tbl\b/i.test(block)) {
      flushList();
      rendered.push(tableHtml(block, entries, relationships, assetPrefix));
    } else {
      const html = paragraphHtml(block, entries, relationships, assetPrefix);
      if (html.startsWith("<li")) list.push(html);
      else {
        flushList();
        rendered.push(html);
      }
    }
  }
  flushList();
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>\n' +
    'body{margin:0;background:#edf3f2;color:#171d1d;font-family:"Noto Serif TC","PMingLiU","Times New Roman",serif;line-height:1.65}.docx-sheet{box-sizing:border-box;width:min(210mm,100%);min-height:297mm;margin:22px auto;padding:22mm 19mm;background:#fff;box-shadow:0 2px 16px #173f3c22;overflow-wrap:anywhere}p,h1,h2,h3,h4,h5,h6{margin:0 0 12px;white-space:pre-wrap}h1,h2,h3,h4,h5,h6{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#173f3c}ul{margin:0 0 14px;padding-left:1.8em}table{width:100%;border-collapse:collapse;table-layout:auto;margin:16px 0;font-size:.96em}td,th{border:1px solid #667875;padding:6px 9px;vertical-align:top;white-space:pre-wrap}td p,td li{margin:0}img{display:block;max-width:100%;height:auto;margin:10px auto}li{margin:3px 0}.docx-empty{min-height:1em}.docx-page-break{border:0;border-top:1px dashed #c79f32;margin:32px 0;page-break-after:always}\n' +
    '@media(max-width:700px){.docx-sheet{width:100%;min-height:0;margin:0;padding:15mm 12mm;box-shadow:none}table{font-size:.9em}td,th{padding:5px;word-break:break-word}}\n' +
    '</style></head><body><article class="docx-sheet">' + rendered.join("\n") + "</article></body></html>";
}

export function docxAsset(bytes: ArrayBuffer, assetPath: string) {
  let entries: Entries;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("Word 檔案無法解壓");
  }
  const safePath = normalizePath(assetPath);
  if (!safePath.startsWith("word/media/")) return null;
  const image = entries[safePath];
  return image ? { bytes: image, contentType: contentType(safePath) } : null;
}
