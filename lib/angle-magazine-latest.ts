export type LatestAngleMagazineIssue = {
  issue: number;
  title: string;
  publishDate: string;
  url: string;
  availability: "published" | "upcoming";
};

export type AngleIssueStatusRequest = {
  issue: number;
  series: "classroom" | "law-journal";
};

const ANGLE_CLASSROOM_INDEX = "https://www.angle.com.tw/magazine/m_search.asp?KindID=12";
const ANGLE_LAW_JOURNAL_INDEX = "https://www.angle.com.tw/magazine/m_search.asp?KindID=13";

function normalizeAngleQuery(query: string) {
  return query
    .replace(/\s+/g, "")
    .replace(/月[但單]/gu, "月旦")
    .replace(/法學教[是式]/gu, "法學教室");
}

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
  const compact = normalizeAngleQuery(query);
  if (/不要《?月旦法學教室/u.test(compact)) return false;
  const asksLatest = /最新|最近|近三|前三/u.test(compact);
  const asksClassroom = /法學教室/u.test(compact);
  const identifiesAngle = /月旦|元照|三份|三分|3份|三期|3期/u.test(compact);
  return asksLatest && asksClassroom && identifiesAngle;
}

export function isLatestAngleLawJournalRequest(query: string) {
  const compact = normalizeAngleQuery(query);
  if (/不要《?月旦法學雜誌/u.test(compact)) return false;
  return /最新|最近|近三|前三/u.test(compact) && /月旦法學雜誌/u.test(compact);
}

export function requestedAngleIssueStatus(query: string): AngleIssueStatusRequest | null {
  const compact = normalizeAngleQuery(query);
  if (!/已出刊|即將上市|上市|出刊|狀態/u.test(compact)) return null;
  const issue = Number(compact.match(/第(\d{1,4})期/u)?.[1]);
  if (!Number.isInteger(issue) || issue < 1) return null;
  if (compact.includes("月旦法學教室")) return { issue, series: "classroom" };
  if (compact.includes("月旦法學雜誌")) return { issue, series: "law-journal" };
  return null;
}

export function requestedAngleSeriesIndex(query: string): "classroom" | "law-journal" | null {
  const compact = normalizeAngleQuery(query);
  if (!/找|查|搜尋|官網|歷期|索引/u.test(compact) || /第\d{1,4}期/u.test(compact)) return null;
  const deniesClassroom = /不要《?月旦法學教室/u.test(compact);
  const deniesLawJournal = /不要《?月旦法學雜誌/u.test(compact);
  if (compact.includes("月旦法學教室") && !deniesClassroom) return "classroom";
  if (compact.includes("月旦法學雜誌") && !deniesLawJournal) return "law-journal";
  return null;
}

export function requestedLatestIssueCount(query: string) {
  const compact = normalizeAngleQuery(query);
  const arabic = compact.match(/(?:最新|最近|前|找)(\d{1,2})(?:份|期)/u)?.[1];
  if (arabic) return Math.min(10, Math.max(1, Number(arabic)));
  const chinese = compact.match(/(?:最新|最近|前|找)([一二三四五六七八九十])(?:份|分|期)/u)?.[1];
  if (chinese) {
    const value = chinese === "十" ? 10 : "一二三四五六七八九".indexOf(chinese) + 1;
    if (value > 0) return value;
  }
  return 3;
}

export function requestedExcludedIssueNumbers(query: string) {
  const compact = normalizeAngleQuery(query);
  return new Set(
    [...compact.matchAll(/(?:不要|排除)(?:第)?(\d{1,4})期/gu)]
      .map((match) => Number(match[1]))
      .filter((issue) => Number.isInteger(issue) && issue > 0),
  );
}

function parseLatestAngleIssues(html: string, seriesTitle: string, indexUrl: string, limit: number, includeUpcoming = false): LatestAngleMagazineIssue[] {
  const found = new Map<number, LatestAngleMagazineIssue>();
  const escapedTitle = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(`href=["']([^"']*m_single\\.asp\\?BKID=\\d+[^"']*)["'][^>]*>\\s*${escapedTitle}第\\s*(\\d+)\\s*期`, "gi");
  const matches = [...html.matchAll(linkPattern)];
  const taipeiParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const currentYearMonth = Number(`${taipeiParts.find((part) => part.type === "year")?.value ?? "0"}${taipeiParts.find((part) => part.type === "month")?.value ?? "00"}`);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const issue = Number(match[2]);
    if (!Number.isInteger(issue) || found.has(issue)) continue;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? Math.min(html.length, start + 1800);
    const nearby = cleanHtml(html.slice(start, end));
    const date = nearby.match(/出刊日[^\d]*(\d{4})[年/]\s*(\d{1,2})/u);
    const issueYearMonth = date ? Number(`${date[1]}${String(Number(date[2])).padStart(2, "0")}`) : 0;
    const upcoming = /即將上市|預購/u.test(nearby) || (issueYearMonth > 0 && issueYearMonth > currentYearMonth);
    const url = new URL(match[1].replaceAll("&amp;", "&"), indexUrl).toString();
    found.set(issue, {
      issue,
      title: `${seriesTitle}第${issue}期`,
      publishDate: date ? `${date[1]}年${Number(date[2])}月` : "",
      url,
      availability: upcoming ? "upcoming" : "published",
    });
  }
  return [...found.values()]
    .filter((item) => includeUpcoming || item.availability === "published")
    .sort((a, b) => b.issue - a.issue)
    .slice(0, limit);
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

export async function fetchAngleIssueStatus(request: AngleIssueStatusRequest) {
  const indexUrl = request.series === "classroom" ? ANGLE_CLASSROOM_INDEX : ANGLE_LAW_JOURNAL_INDEX;
  const seriesTitle = request.series === "classroom" ? "月旦法學教室" : "月旦法學雜誌";
  const response = await fetch(indexUrl, {
    headers: { "user-agent": "AnglePedia/1.0", accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`元照歷期頁回應 ${response.status}`);
  const html = new TextDecoder("big5").decode(await response.arrayBuffer());
  return parseLatestAngleIssues(html, seriesTitle, indexUrl, 100, true).find((item) => item.issue === request.issue) ?? null;
}

function formatLatestAngleReply(issues: LatestAngleMagazineIssue[], seriesTitle: string, indexUrl: string) {
  const rows = issues.map((item, index) => [
    `### ${index + 1}. [${item.title}](${item.url})`,
    item.publishDate ? `- 出刊日：${item.publishDate}` : "",
    "- 出版單位：元照出版公司",
  ].filter(Boolean).join("\n")).join("\n\n");
  return `已找到《${seriesTitle}》最新已出刊${issues.length === 3 ? "三" : issues.length}期（已排除「即將上市」項目，並依元照官方歷期頁的期號排序）：\n\n${rows}\n\n[查看《${seriesTitle}》全部歷期](${indexUrl})`;
}

export function formatAngleSeriesIndexReply(series: "classroom" | "law-journal") {
  const seriesTitle = series === "classroom" ? "月旦法學教室" : "月旦法學雜誌";
  const indexUrl = series === "classroom" ? ANGLE_CLASSROOM_INDEX : ANGLE_LAW_JOURNAL_INDEX;
  return `已找到元照官方的《${seriesTitle}》歷期索引：\n\n- [查看《${seriesTitle}》全部歷期](${indexUrl})\n\n這是該刊專屬索引，不包含其他名稱相近的期刊。`;
}

export function formatAngleIssueStatusReply(item: LatestAngleMagazineIssue) {
  const status = item.availability === "upcoming" ? "即將上市，尚未列為已出刊" : "已出刊";
  const date = item.publishDate ? `，官方頁標示出刊月份為 ${item.publishDate}` : "";
  return `依元照官方歷期頁，《${item.title}》目前狀態是：**${status}**${date}。\n\n- [查看元照官方期刊頁](${item.url})`;
}

export function formatLatestAngleClassroomReply(issues: LatestAngleMagazineIssue[]) {
  return formatLatestAngleReply(issues, "月旦法學教室", ANGLE_CLASSROOM_INDEX);
}

export function formatLatestAngleLawJournalReply(issues: LatestAngleMagazineIssue[]) {
  return formatLatestAngleReply(issues, "月旦法學雜誌", ANGLE_LAW_JOURNAL_INDEX);
}
