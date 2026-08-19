import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import MedtechRetakeOptions from "../MedtechRetakeOptions";
import MedtechPackDiscount from "../MedtechPackDiscount";
import MedtechUltimateChallenge from "../MedtechUltimateChallenge";
import { chatGPTSignInPath } from "../../chatgpt-auth";
import { documents, examQuestions, medtechPointLedger, medtechPracticeSessions } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";
import { taipeiDate } from "../../../lib/taipei-time";

const topics = [
  ["臨床病毒學總論", "病毒結構、分類、複製與基礎培養"],
  ["DNA 病毒", "依 DNA 病毒教材整理的歷屆題目"],
  ["RNA 病毒", "依 RNA 病毒教材整理的歷屆題目"],
  ["全真模擬試題", "完整模擬試題文件的正式題組"],
] as const;
const PACKAGE_SIZE = 30;
const PACKAGE_HOURS = 7 * 24;

function topicOf(sourceName = "", subject = "") {
  const source = `${sourceName} ${subject}`;
  if (/全真模擬|模擬試題/i.test(source)) return "全真模擬試題";
  if (/DNA\s*病毒/i.test(source)) return "DNA 病毒";
  if (/RNA\s*病毒/i.test(source)) return "RNA 病毒";
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source)) return "臨床病毒學總論";
  return "";
}

function packageDescriptions(name: string, packNumber: number) {
  const current = `${name}第 ${packNumber} 包（7 天內可隨意刷）`;
  return packNumber === 1 ? [current, `${name}題目包（7 天內可隨意刷）`] : [current];
}

function remainingText(until: Date | null, now: number) {
  if (!until) return "";
  const minutes = Math.max(0, Math.floor((until.getTime() - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `剩餘 ${days} 天 ${hours} 小時` : `剩餘 ${hours} 小時 ${minutes % 60} 分`;
}

export default async function MedtechChapters() {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech/chapters", { headers: requestHeaders }));
  if ("error" in auth) {
    return <main className="medtech-member-page"><section className="medtech-member-card login"><span>醫檢師章節刷題</span><h1>登入後開始闖關</h1><p>登入後可以保存每一關的作答紀錄、完成時間與錯題分析。</p><a className="primary" href={chatGPTSignInPath("/medtech/chapters")}>登入醫檢師備考</a></section></main>;
  }

  const [sourceRows, questionRows, ledgerRows, sessionRows] = await Promise.all([
    auth.db.select({ id: documents.id, storageKey: documents.storageKey, fileName: documents.fileName, subject: documents.subject }).from(documents).where(eq(documents.examCategory, "medtech")),
    auth.db.select({ id: examQuestions.id, subject: examQuestions.subject, sourceUrl: examQuestions.sourceUrl }).from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.examType, "mcq"), eq(examQuestions.status, "published"))),
    auth.db.select({ action: medtechPointLedger.action, description: medtechPointLedger.description, sourceDetail: medtechPointLedger.sourceDetail, availableUntil: medtechPointLedger.availableUntil, createdAt: medtechPointLedger.createdAt }).from(medtechPointLedger).where(eq(medtechPointLedger.userKey, auth.userKey)),
    auth.db.select({ packageName: medtechPracticeSessions.packageName, packNumber: medtechPracticeSessions.packNumber, packageType: medtechPracticeSessions.packageType, startedAt: medtechPracticeSessions.startedAt, completedAt: medtechPracticeSessions.completedAt, status: medtechPracticeSessions.status, answeredQuestions: medtechPracticeSessions.answeredQuestions, totalQuestions: medtechPracticeSessions.totalQuestions }).from(medtechPracticeSessions).where(eq(medtechPracticeSessions.userKey, auth.userKey)),
  ]);
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const sourceByAlias = new Map(sourceRows.flatMap((row) => [[`document:${row.id}`, row], [row.storageKey, row], [row.fileName, row]] as const));
  const freePackageUsed = ledgerRows.some((row) => row.action === "question_pack_gift" && String(row.sourceDetail ?? "").includes("首次體驗贈送"));
  const counts = new Map<string, number>(topics.map(([name]) => [name, 0]));
  for (const row of questionRows) {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceByAlias.get(row.sourceUrl) ?? sourceById.get(sourceId);
    const name = topicOf(source?.fileName ?? "", source?.subject ?? row.subject);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const now = Date.now();
  const cards = topics.map(([name, description], index) => {
    const questionCount = counts.get(name) ?? 0;
    const packageCount = Math.max(1, Math.ceil(questionCount / PACKAGE_SIZE));
    const packs = Array.from({ length: packageCount }, (_, offset) => {
      const packNumber = offset + 1;
      const questionTotal = Math.min(PACKAGE_SIZE, Math.max(0, questionCount - offset * PACKAGE_SIZE));
      const isBonus = questionTotal < PACKAGE_SIZE;
      const matches = ledgerRows.filter((row) => row.action === "question_pack" || row.action === "question_pack_gift").filter((row) => packageDescriptions(name, packNumber).includes(row.description));
      const hasDiscountChoice = ledgerRows.some((row) => (row.action === "question_pack_spin" || row.action === "question_pack_spin_abandoned") && row.description === `題目包轉轉樂：${name}第 ${packNumber} 包`);
      const latest = [...matches].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      const availableUntil = latest ? latest.availableUntil ?? new Date(latest.createdAt.getTime() + PACKAGE_HOURS * 60 * 60 * 1000) : null;
      const active = Boolean(availableUntil && availableUntil.getTime() > now);
      const isCompleted = (row: { completedAt: Date | null; status: string; answeredQuestions: number; totalQuestions: number }) => Boolean(row.completedAt || row.status === "completed" || ((row.status === "awaiting_submit" || row.status === "in_progress") && row.totalQuestions > 0 && row.answeredQuestions >= row.totalQuestions));
      const completed = sessionRows.some((row) => row.packageName === name && row.packNumber === packNumber && isCompleted(row));
      const previousCompleted = packNumber === 1 || sessionRows.some((row) => row.packageName === name && row.packNumber === packNumber - 1 && isCompleted(row));
      const hasHistory = sessionRows.some((row) => row.packageName === name && row.packNumber === packNumber && (isCompleted(row) || row.answeredQuestions > 0));
      const canStart = previousCompleted;
      const needsUnlock = !active && (freePackageUsed || packNumber > 1 || hasHistory);
      const label = active ? (completed ? "已完成 · 可重做" : "進行中") : !canStart ? "完成上一關後開放" : !freePackageUsed ? "任選一包免費" : !hasDiscountChoice ? "可抽一次折扣" : "30 點解鎖";
      const action = active ? (completed ? "再次挑戰" : "繼續闖關") : !canStart ? "尚未開放" : !freePackageUsed ? "免費開始" : !hasDiscountChoice ? "🎡 抽轉轉樂" : hasHistory ? "30 點重新解鎖" : "30 點解鎖";
      return { packNumber, questionTotal, isBonus, active, completed, hasHistory, hasDiscountChoice, canStart, needsUnlock, label, action, availableUntil };
    });
    return { name, description, index, questionCount, packs };
  });
  const ultimateTarget = cards.flatMap((card) => card.packs.map((pack) => ({ ...pack, packageName: card.name }))).find((pack) => !pack.active && pack.packNumber > 1 && pack.canStart && pack.questionTotal >= PACKAGE_SIZE);
  const todayStart = new Date(`${taipeiDate()}T00:00:00+08:00`);
  const dailyUltimate = sessionRows.find((row) => row.packageType === "ultimate_challenge" && row.startedAt >= todayStart);
  const dailyUltimateStatus = dailyUltimate ? (dailyUltimate.status === "in_progress" ? "in_progress" : "finished") : "available";

  return <main className="medtech-practice"><header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>章節刷題</small></div></a><MedtechHeaderActions /></header><MedtechTabs active="chapters"/><section className="medtech-chapter-page"><span>CHAPTER PRACTICE</span><h1>選擇本次練習章節</h1><p>每包 30 題；任選一包首次免費，使用一次後其他題目包皆需 30 點解鎖。開通後 7 天內不限次數重做，最後不足 30 題的尾包也依同一規則計算。</p><div className="medtech-pack-rule"><b>解題闖關 × 限時轉轉樂</b><span>章節刷題不跨章節；完成前一關後，可挑戰上一關隨機 10 題，每題限時 5 秒，每個題目包最多 2 次答題挑戰。答對率越高、平均作答越快，折扣越優惠，兩次取最佳結果；另有一次限時轉轉樂，最高五折。另可每天挑戰一次 30 題 1 折終極挑戰，3 分鐘內全對即可用 3 點解鎖下一關。每一關完成後，系統保存作答時間、答對率、錯題與需加強觀念。</span></div>{ultimateTarget && <MedtechUltimateChallenge packageName={ultimateTarget.packageName} packNumber={ultimateTarget.packNumber} dailyStatus={dailyUltimateStatus} href={`/medtech/practice?topic=${encodeURIComponent(ultimateTarget.packageName)}&pack=${ultimateTarget.packNumber}`} />}<div className="medtech-chapter-list">{cards.map((card) => <section className="medtech-chapter-card" key={card.name}><header><div><small>0{card.index + 1}</small><h2>{card.name}</h2><p>{card.description} · 共 {card.questionCount} 題</p></div><strong>{card.packs.length} 關</strong></header><div className="medtech-pack-grid">{card.packs.map((pack) => { const practiceHref = `/medtech/practice?topic=${encodeURIComponent(card.name)}&pack=${pack.packNumber}`; const spinAvailable = !pack.active && pack.canStart && (pack.packNumber > 1 || pack.hasHistory); return <div className={`medtech-pack-item${pack.hasHistory ? " has-history" : ""}`} key={pack.packNumber}>{pack.active && pack.completed ? <MedtechRetakeOptions href={practiceHref} packNumber={pack.packNumber} questionTotal={pack.questionTotal} label={pack.label} remaining={pack.availableUntil ? remainingText(pack.availableUntil, now) : ""} /> : spinAvailable ? <MedtechPackDiscount packageName={card.name} packNumber={pack.packNumber} questionTotal={pack.questionTotal} label={pack.label} href={practiceHref} /> : <a className={`${pack.active ? "active " : ""}${!pack.canStart || pack.needsUnlock ? "locked " : ""}${pack.isBonus ? "bonus" : ""}`} href={pack.canStart ? practiceHref : "#"} aria-disabled={!pack.canStart}><span>第 {pack.packNumber} 關</span>{(!pack.canStart || pack.needsUnlock) && <i className="medtech-pack-lock" aria-label="尚未解鎖">🔒</i>}<b>{pack.questionTotal} 題</b><small>{pack.label}{pack.active && pack.availableUntil ? ` · ${remainingText(pack.availableUntil, now)}` : ""}</small><strong>{pack.action} {pack.canStart ? "→" : ""}</strong></a>}{pack.hasHistory && <a className="medtech-pack-history-link" href={`/medtech/practice/history?topic=${encodeURIComponent(card.name)}&pack=${pack.packNumber}`}>學習紀錄</a>}</div>; })}</div></section>)}</div></section></main>;
}
