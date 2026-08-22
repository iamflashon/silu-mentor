import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import MedtechTabs from "../MedtechTabs";
import MedtechHeaderActions from "../MedtechHeaderActions";
import MedtechRetakeOptions from "../MedtechRetakeOptions";
import { memberLoginPath } from "../../../lib/member-login-path";
import {
  documents,
  examQuestions,
  medtechPointLedger,
  medtechPaymentOrders,
  medtechPracticeSessions,
} from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";
import {

  MEDTECH_ALL_ACCESS_NAME,
} from "../../../lib/medtech-usage";
import { taipeiDate } from "../../../lib/taipei-time";
import { getMedtechProductSettings } from "../../../lib/medtech-product-settings";

// This route is member-specific and reads live D1 state. It must never be
// prerendered or reused through ISR, otherwise Vinext can hydrate one member's
// cached RSC payload against another request and fall through to global-error.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source))
    return "臨床病毒學總論";
  return "";
}

function packageDescriptions(name: string, packNumber: number) {
  const current = `${name}第 ${packNumber} 包（7 天內可隨意刷）`;
  return packNumber === 1
    ? [current, `${name}題目包（7 天內可隨意刷）`]
    : [current];
}

function remainingText(until: Date | null, now: number) {
  if (!until) return "";
  const minutes = Math.max(0, Math.floor((until.getTime() - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0
    ? `剩餘 ${days} 天 ${hours} 小時`
    : `剩餘 ${hours} 小時 ${minutes % 60} 分`;
}

export default async function MedtechChapters({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string }>;
}) {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(
    new Request("https://medtech.local/medtech/chapters", {
      headers: requestHeaders,
    }),
  );
  if ("error" in auth) {
    return (
      <main className="medtech-member-page">
        <section className="medtech-member-card login">
          <span>醫檢師章節刷題</span>
          <h1>登入後開始闖關</h1>
          <p>登入後可以保存每一關的作答紀錄、完成時間與錯題分析。</p>
          <a className="primary" href={memberLoginPath("/medtech/chapters")}>
            登入會員帳號
          </a>
        </section>
      </main>
    );
  }

  const product = await getMedtechProductSettings(auth.db);

  const [sourceRows, questionRows, ledgerRows, sessionRows, paymentRows] =
    await Promise.all([
      auth.db
        .select({
          id: documents.id,
          storageKey: documents.storageKey,
          fileName: documents.fileName,
          subject: documents.subject,
        })
        .from(documents)
        .where(eq(documents.examCategory, "medtech")),
      auth.db
        .select({
          id: examQuestions.id,
          subject: examQuestions.subject,
          sourceUrl: examQuestions.sourceUrl,
        })
        .from(examQuestions)
        .where(
          and(
            eq(examQuestions.examCategory, "medtech"),
            eq(examQuestions.examType, "mcq"),
            eq(examQuestions.status, "published"),
          ),
        ),
      auth.db
        .select({
          action: medtechPointLedger.action,
          description: medtechPointLedger.description,
          sourceDetail: medtechPointLedger.sourceDetail,
          availableUntil: medtechPointLedger.availableUntil,
          createdAt: medtechPointLedger.createdAt,
        })
        .from(medtechPointLedger)
        .where(eq(medtechPointLedger.userKey, auth.userKey)),
      auth.db
        .select({
          packageName: medtechPracticeSessions.packageName,
          packNumber: medtechPracticeSessions.packNumber,
          packageType: medtechPracticeSessions.packageType,
          startedAt: medtechPracticeSessions.startedAt,
          completedAt: medtechPracticeSessions.completedAt,
          status: medtechPracticeSessions.status,
          answeredQuestions: medtechPracticeSessions.answeredQuestions,
          totalQuestions: medtechPracticeSessions.totalQuestions,
        })
        .from(medtechPracticeSessions)
        .where(eq(medtechPracticeSessions.userKey, auth.userKey)),
      auth.db
        .select({
          packageName: medtechPaymentOrders.packageName,
          packNumber: medtechPaymentOrders.packNumber,
          status: medtechPaymentOrders.status,
          paidAt: medtechPaymentOrders.paidAt,
        })
        .from(medtechPaymentOrders)
        .where(eq(medtechPaymentOrders.userKey, auth.userKey)),
    ]);
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const allAccessOrder = paymentRows
    .filter(
      (row) =>
        row.packageName === MEDTECH_ALL_ACCESS_NAME &&
        row.status === "paid" &&
        row.paidAt,
    )
    .sort(
      (left, right) =>
        (right.paidAt?.getTime() ?? 0) - (left.paidAt?.getTime() ?? 0),
    )[0];
  const allAccessUntil = allAccessOrder?.paidAt
    ? new Date(
        allAccessOrder.paidAt.getTime() +
          product.accessDays * 24 * 60 * 60 * 1000,
      )
    : null;
  const allAccess =
    allAccessUntil && allAccessUntil.getTime() > Date.now()
      ? { availableUntil: allAccessUntil }
      : null;
  const sourceByAlias = new Map(
    sourceRows.flatMap(
      (row) =>
        [
          [`document:${row.id}`, row],
          [row.storageKey, row],
          [row.fileName, row],
        ] as const,
    ),
  );
  const freePackageUsed = ledgerRows.some(
    (row) =>
      row.action === "question_pack_gift" &&
      String(row.sourceDetail ?? "").includes("首次體驗贈送"),
  );
  const counts = new Map<string, number>(topics.map(([name]) => [name, 0]));
  for (const row of questionRows) {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceByAlias.get(row.sourceUrl) ?? sourceById.get(sourceId);
    const name = topicOf(
      source?.fileName ?? "",
      source?.subject ?? row.subject,
    );
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const now = Date.now();
  const cards = topics.map(([name, description], index) => {
    const questionCount = counts.get(name) ?? 0;
    const packageCount = Math.max(1, Math.ceil(questionCount / PACKAGE_SIZE));
    const packs = Array.from({ length: packageCount }, (_, offset) => {
      const packNumber = offset + 1;
      const questionTotal = Math.min(
        PACKAGE_SIZE,
        Math.max(0, questionCount - offset * PACKAGE_SIZE),
      );
      const isBonus = questionTotal < PACKAGE_SIZE;
      const matches = ledgerRows
        .filter(
          (row) =>
            row.action === "question_pack" ||
            row.action === "question_pack_gift",
        )
        .filter((row) =>
          packageDescriptions(name, packNumber).includes(row.description),
        );
      const hasDiscountChoice = ledgerRows.some(
        (row) =>
          (row.action === "question_pack_spin" ||
            row.action === "question_pack_spin_abandoned") &&
          row.description === `題目包轉轉樂：${name}第 ${packNumber} 包`,
      );
      const ultimateDiscount = false;
      const latest = [...matches].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];
      const availableUntil = latest
        ? (latest.availableUntil ??
          new Date(latest.createdAt.getTime() + PACKAGE_HOURS * 60 * 60 * 1000))
        : null;
      const effectiveUntil = allAccess?.availableUntil ?? availableUntil;
      const active = Boolean(allAccess || (availableUntil && availableUntil.getTime() > now));
      const isCompleted = (row: {
        completedAt: Date | null;
        status: string;
        answeredQuestions: number;
        totalQuestions: number;
      }) =>
        Boolean(
          row.completedAt ||
            row.status === "completed" ||
            ((row.status === "awaiting_submit" ||
              row.status === "in_progress") &&
              row.totalQuestions > 0 &&
              row.answeredQuestions >= row.totalQuestions),
        );
      const completed = sessionRows.some(
        (row) =>
          row.packageName === name &&
          row.packNumber === packNumber &&
          isCompleted(row),
      );
      const previousCompleted =
        packNumber === 1 ||
        sessionRows.some(
          (row) =>
            row.packageName === name &&
            row.packNumber === packNumber - 1 &&
            isCompleted(row),
        );
      const hasHistory = sessionRows.some(
        (row) =>
          row.packageName === name &&
          row.packNumber === packNumber &&
          (isCompleted(row) || row.answeredQuestions > 0),
      );
      const purchased = paymentRows.some(
        (row) =>
          row.packageName === name &&
          row.packNumber === packNumber &&
          row.status === "paid",
      );
      // A confirmed LINE Pay order grants immediate access. Paid packs do not
      // depend on the sequential chapter gate.
      const canStart = Boolean(allAccess || previousCompleted || purchased || !freePackageUsed);
      const needsUnlock =
        !active && !purchased && freePackageUsed;
      const label = active
        ? completed
          ? "已完成 · 可重做"
          : "進行中"
        : !canStart
          ? "可提前購買・完成上一關後開放"
          : purchased
            ? "LINE Pay 已付款・可開始"
            : !freePackageUsed
              ? "首次免費體驗"
              : "需開通全庫通行證";
      const action = active
        ? completed
          ? "再次挑戰"
          : "繼續闖關"
        : !canStart
          ? "尚未開放"
          : purchased
            ? "啟用並開始"
            : !freePackageUsed
              ? "免費開始"
              : "查看全庫方案";
      return {
        packNumber,
        questionTotal,
        isBonus,
        active,
        completed,
        hasHistory,
        hasDiscountChoice,
        purchased,
        ultimateDiscount,
        canStart,
        needsUnlock,
        label,
        action,
        availableUntil: effectiveUntil,
      };
    });
    return { name, description, index, questionCount, packs };
  });
  const ultimateTargets = cards
    .flatMap((card) =>
      card.packs.map((pack) => ({ ...pack, packageName: card.name })),
    )
    .filter((pack) => !pack.active && !pack.purchased && !pack.ultimateDiscount)
    .map((pack) => ({ packageName: pack.packageName, packNumber: pack.packNumber, questionTotal: pack.questionTotal }));
  const todayStart = new Date(`${taipeiDate()}T00:00:00+08:00`);
  const dailyUltimate = sessionRows.find(
    (row) =>
      row.packageType === "ultimate_challenge" && row.startedAt >= todayStart,
  );
  const dailyUltimateStatus = dailyUltimate
    ? dailyUltimate.status === "in_progress"
      ? "in_progress"
      : "finished"
    : "available";
  const latestUltimate = [...sessionRows]
    .filter((row) => row.packageType === "ultimate_challenge")
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
  const latestRescueAfterUltimate = latestUltimate
    ? [...sessionRows]
        .filter((row) => row.packageType === "ultimate_rescue" && row.startedAt > latestUltimate.startedAt)
        .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0]
    : undefined;
  const rescueDue = Boolean(
    latestUltimate?.status === "failed" &&
    latestRescueAfterUltimate?.status !== "completed" &&
    (
      !latestRescueAfterUltimate ||
      latestRescueAfterUltimate.status === "in_progress" ||
      (
        latestRescueAfterUltimate.status === "failed" &&
        latestRescueAfterUltimate.answeredQuestions <
          (latestRescueAfterUltimate.totalQuestions || 10)
      ) ||
      (
        latestRescueAfterUltimate.status === "failed" &&
        latestRescueAfterUltimate.startedAt < todayStart
      )
    ),
  );
  const payment = (await searchParams)?.payment;

  return (
    <main className="medtech-practice">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>章節刷題</small>
          </div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs active="chapters" />
      <section className="medtech-chapter-page">
        <span>CHAPTER PRACTICE</span>
        <h1>選擇本次練習章節</h1>
        {payment === "success" && (
          <div className="medtech-line-pay-notice success">
            LINE Pay 付款成功；全庫通行證已開通，可使用 {product.accessDays} 天。
          </div>
        )}
        {payment === "cancelled" && (
          <div className="medtech-line-pay-notice">
            您已取消 LINE Pay 付款，全庫通行證尚未開通。
          </div>
        )}
        {payment && !["success", "cancelled"].includes(payment) && (
          <div className="medtech-line-pay-notice failed">
            LINE Pay 付款尚未完成，請稍後再試。
          </div>
        )}
        <p>
          每 30 題是一個練習單元，方便掌握進度，不是計價單位。首次可任選一個
          {product.trialQuestions} 題單元免費體驗；NT${product.effectivePrice} 一次開通全庫，{product.accessDays} 天不限次練習。
        </p>
        <div className="medtech-pack-rule">
          <b>全庫通行證 × 清楚學習進度</b>
          <span>
            章節刷題不跨章節；開通後所有單元立即解鎖，不必等待上一關。
            系統保存每個單元的作答時間、答對率、錯題與需加強觀念，並提供判斷提示、
            四個選項比較、完整解析與康情老師語音。
          </span>
        </div>
        <div className="medtech-chapter-list">
          {cards.map((card) => (
            <section className="medtech-chapter-card" key={card.name}>
              <header>
                <div>
                  <small>0{card.index + 1}</small>
                  <h2>{card.name}</h2>
                  <p>
                    {card.description} · 共 {card.questionCount} 題
                  </p>
                </div>
                <strong>{card.packs.length} 關</strong>
              </header>
              <div className="medtech-pack-grid">
                {card.packs.map((pack) => {
                  const practiceHref = `/medtech/practice?topic=${encodeURIComponent(card.name)}&pack=${pack.packNumber}`;
                  const spinAvailable = false;
                  return (
                    <div
                      className={`medtech-pack-item${pack.hasHistory ? " has-history" : ""}`}
                      key={pack.packNumber}
                    >
                      {pack.active && pack.completed ? (
                        <MedtechRetakeOptions
                          href={practiceHref}
                          packNumber={pack.packNumber}
                          questionTotal={pack.questionTotal}
                          label={pack.label}
                          remaining={
                            pack.availableUntil
                              ? remainingText(pack.availableUntil, now)
                              : ""
                          }
                        />
                      ) : !pack.active && pack.needsUnlock ? (
                        <div
                          className={`medtech-pack-purchase-card locked${pack.isBonus ? " bonus" : ""}`}
                        >
                          <span>第 {pack.packNumber} 關</span>
                          <b>{pack.questionTotal} 題</b>
                          <i className="medtech-pack-lock-only" aria-label="尚未解鎖">🔒</i>
                        </div>
                      ) : (
                        <a
                          className={`${pack.active ? "active " : ""}${!pack.canStart || pack.needsUnlock ? "locked " : ""}${pack.isBonus ? "bonus" : ""}`}
                          href={pack.canStart && !pack.needsUnlock ? practiceHref : "/medtech/pricing"}
                          aria-disabled={!pack.canStart}
                        >
                          <span>第 {pack.packNumber} 關</span>
                          <b>{pack.questionTotal} 題</b>
                          <small>
                            {pack.label}
                            {pack.active && pack.availableUntil
                              ? ` · ${remainingText(pack.availableUntil, now)}`
                              : ""}
                            {(!pack.canStart || pack.needsUnlock) && (
                              <> <i className="medtech-pack-lock" aria-label="尚未解鎖">🔒</i></>
                            )}
                          </small>
                          <strong>
                            {pack.action} {pack.canStart ? "→" : ""}
                          </strong>
                        </a>
                      )}
                      {pack.hasHistory && (
                        <a
                          className="medtech-pack-history-link"
                          href={`/medtech/practice/history?topic=${encodeURIComponent(card.name)}&pack=${pack.packNumber}`}
                        >
                          學習紀錄
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
