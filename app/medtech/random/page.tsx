import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import MedtechRetakeOptions from "../MedtechRetakeOptions";
import MedtechPackDiscount from "../MedtechPackDiscount";
import { memberLoginPath } from "../../../lib/member-login-path";
import { documents, examQuestions, medtechPointLedger, medtechPracticeSessions } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";

const PACKAGE_SIZE = 30;
const PACKAGE_HOURS = 7 * 24;
const chapterNames = new Set(["臨床病毒學總論", "DNA 病毒", "RNA 病毒"]);

function topicOf(sourceName = "", subject = "") {
  const source = `${sourceName} ${subject}`;
  if (/DNA\s*病毒/i.test(source)) return "DNA 病毒";
  if (/RNA\s*病毒/i.test(source)) return "RNA 病毒";
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source)) return "臨床病毒學總論";
  return "";
}

function descriptions(packNumber: number) {
  return [`隨機模考第 ${packNumber} 包（7 天內可隨意刷）`];
}

function remainingText(until: Date | null, now: number) {
  if (!until) return "";
  const minutes = Math.max(0, Math.floor((until.getTime() - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `剩餘 ${days} 天 ${hours} 小時` : `剩餘 ${hours} 小時 ${minutes % 60} 分`;
}

export default async function MedtechRandomPackages() {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech/random", { headers: requestHeaders }));
  if ("error" in auth) return <main className="medtech-member-page"><section className="medtech-member-card login"><span>醫檢師隨機模考</span><h1>登入後開始闖關</h1><p>登入後可以保存每一關的作答紀錄、完成時間與錯題分析。</p><a className="primary" href={memberLoginPath("/medtech/random")}>登入會員帳號</a></section></main>;

  const [sourceRows, questionRows, ledgerRows, sessionRows] = await Promise.all([
    auth.db.select({ id: documents.id, storageKey: documents.storageKey, fileName: documents.fileName, subject: documents.subject }).from(documents).where(eq(documents.examCategory, "medtech")),
    auth.db.select({ subject: examQuestions.subject, sourceUrl: examQuestions.sourceUrl }).from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.examType, "mcq"), eq(examQuestions.status, "published"))),
    auth.db.select({ action: medtechPointLedger.action, description: medtechPointLedger.description, sourceDetail: medtechPointLedger.sourceDetail, availableUntil: medtechPointLedger.availableUntil, createdAt: medtechPointLedger.createdAt }).from(medtechPointLedger).where(eq(medtechPointLedger.userKey, auth.userKey)),
    auth.db.select({ packageName: medtechPracticeSessions.packageName, packNumber: medtechPracticeSessions.packNumber, completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions }).from(medtechPracticeSessions).where(eq(medtechPracticeSessions.userKey, auth.userKey)),
  ]);
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const sourceByAlias = new Map(sourceRows.flatMap((row) => [[`document:${row.id}`, row], [row.storageKey, row], [row.fileName, row]] as const));
  const freePackageUsed = ledgerRows.some((row) => row.action === "question_pack_gift" && String(row.sourceDetail ?? "").includes("首次體驗贈送"));
  const questionCount = questionRows.filter((row) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceByAlias.get(row.sourceUrl) ?? sourceById.get(sourceId);
    return chapterNames.has(topicOf(source?.fileName ?? "", source?.subject ?? row.subject));
  }).length;
  const packageCount = Math.max(1, Math.ceil(questionCount / PACKAGE_SIZE));
  const now = Date.now();
  const packs = Array.from({ length: packageCount }, (_, offset) => {
    const packNumber = offset + 1;
    const questionTotal = Math.min(PACKAGE_SIZE, Math.max(0, questionCount - offset * PACKAGE_SIZE));
    const isBonus = questionTotal < PACKAGE_SIZE;
    const matches = ledgerRows.filter((row) => (row.action === "question_pack" || row.action === "question_pack_gift") && descriptions(packNumber).includes(row.description));
    const hasDiscountChoice = ledgerRows.some((row) => (row.action === "question_pack_spin" || row.action === "question_pack_spin_abandoned") && row.description === `題目包轉轉樂：隨機模考第 ${packNumber} 包`);
    const latest = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    const availableUntil = latest ? latest.availableUntil ?? new Date(latest.createdAt.getTime() + PACKAGE_HOURS * 60 * 60 * 1000) : null;
    const active = Boolean(availableUntil && availableUntil.getTime() > now);
    const isCompleted = (row: { completedAt: Date | null; status: string }) => Boolean(row.completedAt || row.status === "completed");
    const completed = sessionRows.some((row) => row.packageName === "隨機模考" && row.packNumber === packNumber && isCompleted(row));
    const previousCompleted = packNumber === 1 || sessionRows.some((row) => row.packageName === "隨機模考" && row.packNumber === packNumber - 1 && isCompleted(row));
    const hasHistory = sessionRows.some((row) => row.packageName === "隨機模考" && row.packNumber === packNumber && (isCompleted(row) || row.answeredQuestions > 0));
    const needsUnlock = !active && (freePackageUsed || packNumber > 1 || hasHistory);
    const label = active ? (completed ? "已完成 · 可重做" : "進行中") : !previousCompleted ? "完成上一關後開放" : !freePackageUsed ? "任選一包免費" : !hasDiscountChoice ? "可抽一次折扣" : "30 點解鎖";
    const action = active ? (completed ? "再次挑戰" : "繼續闖關") : !previousCompleted ? "尚未開放" : !freePackageUsed ? "免費開始" : !hasDiscountChoice ? "🎡 抽轉轉樂" : hasHistory ? "30 點重新解鎖" : "30 點解鎖";
    return { packNumber, questionTotal, isBonus, active, completed, hasHistory, hasDiscountChoice, previousCompleted, needsUnlock, label, action, availableUntil };
  });

  return <main className="medtech-practice"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>隨機模考</small></div></a><MedtechHeaderActions /></header><MedtechTabs active="random"/><section className="medtech-chapter-page"><span>RANDOM MOCK</span><h1>跨章節隨機模考</h1><p>從臨床病毒學總論、DNA 病毒與 RNA 病毒題庫跨章節抽題。每 30 題是一關，任選一包首次免費；使用一次後其他題目包皆需 30 點解鎖。</p><div className="medtech-pack-rule"><b>解題闖關 × 限時轉轉樂</b><span>共 {questionCount} 題 · {packageCount} 關；每關開通後 7 天內不限次數重做。完成前一關後，可挑戰上一關隨機 10 題，每題 5 秒，每包最多 2 次，答對率與平均速度越好，折扣越優惠，兩次取最佳結果；另有一次限時轉轉樂，最高五折。轉轉樂抽到原價可於 24 小時後再抽一次，其他結果或放棄後再用點數解鎖。</span></div><div className="medtech-random-pack-grid">{packs.map((pack) => { const practiceHref = `/medtech/practice?pack=${pack.packNumber}`; const spinAvailable = !pack.active && pack.previousCompleted && (pack.packNumber > 1 || pack.hasHistory); return <div className={`medtech-pack-item${pack.hasHistory ? " has-history" : ""}`} key={pack.packNumber}>{pack.active && pack.completed ? <MedtechRetakeOptions href={practiceHref} packNumber={pack.packNumber} questionTotal={pack.questionTotal} label={pack.label} remaining={pack.availableUntil ? remainingText(pack.availableUntil, now) : ""} /> : spinAvailable ? <MedtechPackDiscount packageName="隨機模考" packNumber={pack.packNumber} questionTotal={pack.questionTotal} label={pack.label} href={practiceHref} /> : <a className={`${pack.active ? "active " : ""}${!pack.previousCompleted || pack.needsUnlock ? "locked " : ""}${pack.isBonus ? "bonus" : ""}`} href={pack.previousCompleted ? practiceHref : "#"} aria-disabled={!pack.previousCompleted}><span>第 {pack.packNumber} 關</span>{(!pack.previousCompleted || pack.needsUnlock) && <i className="medtech-pack-lock" aria-label="尚未解鎖">🔒</i>}<b>{pack.questionTotal} 題</b><small>{pack.label}{pack.active && pack.availableUntil ? ` · ${remainingText(pack.availableUntil, now)}` : ""}</small><strong>{pack.action} {pack.previousCompleted ? "→" : ""}</strong></a>}{pack.hasHistory && <a className="medtech-pack-history-link" href={`/medtech/practice/history?topic=${encodeURIComponent("隨機模考")}&pack=${pack.packNumber}`}>學習紀錄</a>}</div>; })}</div></section></main>;
}
