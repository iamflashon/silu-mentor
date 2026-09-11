export type LatestAngleMagazineIssue = {
  issue: number;
  title: string;
  publishDate: string;
  url: string;
};

const ANGLE_CLASSROOM_INDEX = "https://www.angle.com.tw/magazine/m_search.asp?KindID=12";
const ANGLE_LAW_JOURNAL_INDEX = "https://www.angle.com.tw/magazine/m_search.asp?KindID=13";

function cleanHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLatestAngleClassroomRequest(query: string) {
  const compact = query.replace(/\s+/g, "");
  const asksLatest = /最新|最近|近三|前三/u.test(compact);
  const asksClassroom = /法學教室/u.test(compact);
  const identifiesAngle = /月旦|元照|三份|三分|3份|三期|3期/u.test(compact);
  return asksLatest && asksClassroom && identifiesAngle;
}

export function isLatestAngleLawJournalRequest(query: string) {
  const compact = query.replace(/\s+/g, "");
  return /最新|最近|近三|前三/u.test(compact) && /月旦法學雜誌/u.test(compact);
}

export function requestedLatestIssueCount(query: string) {
  const compact = query.replace(/\s+/g, "");
  const arabic = compact.match(/(?:最新|最近|前|找)(\d{1,2})(?:份|期)/u)?.[1];
  if (arabic) return Math.min(10, Math.max(1, Number(arabic)));
  const chinese = compact.match(/(?:最新|最近|前|找)([一二三四五六七八九十])(?:份|分|期)/u)?.[1];
  if (chinese) {
    const value = chinese === "十" ? 10 : "一二三四五六七八九".indexOf(chinese) + 1;
    if (value > 0) return value;
  }
  return 3;
}

function parseLatestAngleIssues(html: string, seriesTitle: string, indexUrl: string, limit: number): LatestAngleMagazineIssue[] {
  const found = new Map<number, LatestAngleMagazineIssue>();
  const escapedTitle = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(`href=["']([^"']*m_single\\.asp\\?BKID=\\d+[^"']*)["'][^>]*>\\s*${escapedTitle}第\\s*(\\d+)\\s*期`, "gi");
  for (const match of html.matchAll(linkPattern)) {
    const issue = Number(match[2]);
    if (!Number.isInteger(issue) || found.has(issue)) continue;
    const nearby = cleanHtml(html.slice(match.index ?? 0, (match.index ?? 0) + 1200));
    const date = nearby.match(/出刊日[^\d]*(\d{4})[年/]\s*(\d{1,2})/u);
    const url = new URL(match[1].replaceAll("&amp;", "&"), indexUrl).toString();
    found.set(issue, {
      issue,
      title: `${seriesTitle}第${issue}期`,
      publishDate: date ? `${date[1]}年${Number(date[2])}月` : "",
      url,
    });
  }
  return [...found.values()].sort((a, b) => b.issue - a.issue).slice(0, limit);
}

export function parseLatestAngleClassroomIssues(html: string, limit = 3) {
  return parseLatestAngleIssues(html, "月旦法學教室", ANGLE_CLASSROOM_INDEX, limit);
}

export function parseLatestAngleLawJournalIssues(html: string, limit = 3) {
  return parseLatestAngleIssues(html, "月旦法學雜誌", ANGLE_LAW_JOURNAL_INDEX, limit);
}

async function fetchLatestAngleIssues(indexUrl: string, seriesTitle: "月旦法學教室" | "月旦法學雜誌", limit: number) {
  const response = await fetch(indexUrl, {
    headers: { "user-agent": "AnglePedia/1.0", accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`元照歷期頁回應 ${response.status}`);
  const html = new TextDecoder("big5").decode(await response.arrayBuffer());
  return parseLatestAngleIssues(html, seriesTitle, indexUrl, limit);
}

export function fetchLatestAngleClassroomIssues(limit = 3) {
  return fetchLatestAngleIssues(ANGLE_CLASSROOM_INDEX, "月旦法學教室", limit);
}

export function fetchLatestAngleLawJournalIssues(limit = 3) {
  return fetchLatestAngleIssues(ANGLE_LAW_JOURNAL_INDEX, "月旦法學雜誌", limit);
}

function formatLatestAngleReply(issues: LatestAngleMagazineIssue[], seriesTitle: string, indexUrl: string) {
  const rows = issues.map((item, index) => [
    `### ${index + 1}. [${item.title}](${item.url})`,
    item.publishDate ? `- 出刊日：${item.publishDate}` : "",
    "- 出版單位：元照出版公司",
  ].filter(Boolean).join("\n")).join("\n\n");
  return `已找到《${seriesTitle}》最新${issues.length === 3 ? "三" : issues.length}期（依元照官方歷期頁的期號排序）：\n\n${rows}\n\n[查看《${seriesTitle}》全部歷期](${indexUrl})`;
}

export function formatLatestAngleClassroomReply(issues: LatestAngleMagazineIssue[]) {
  return formatLatestAngleReply(issues, "月旦法學教室", ANGLE_CLASSROOM_INDEX);
}

export function formatLatestAngleLawJournalReply(issues: LatestAngleMagazineIssue[]) {
  return formatLatestAngleReply(issues, "月旦法學雜誌", ANGLE_LAW_JOURNAL_INDEX);
}
