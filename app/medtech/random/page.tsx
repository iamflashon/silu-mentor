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

// This route is member-specific and reads live D1 state. Keep it out of ISR so
// the server HTML and client RSC payload always describe the same member data.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PACKAGE_SIZE = 30;
const PACKAGE_HOURS = 7 * 24;
const chapterNames = new Set(["臨床病毒學總論", "DNA 病毒", "RNA 病毒"]);

function topicOf(sourceName = "", subject = "") {
  const source = `${sourceName} ${subject}`;
  if (/DNA\s*病毒/i.test(source)) return "DNA 病毒";
  if (/RNA\s*病毒/i.test(source)) return "RNA 病毒";
  if (/臨床病毒學.*總論|總論.*臨床病毒學/i.test(source))
    return "臨床病毒學總論";
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
  return days > 0
    ? `剩餘 ${days} 天 ${hours} 小時`
    : `剩餘 ${hours} 小時 ${minutes % 60} 分`;
}

export default async function MedtechRandomPackages({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string }>;
}) {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(
    new Request("https://medtech.local/medtech/random", {
      headers: requestHeaders,
    }),
  );
  if ("error" in auth)
    return (
      <main className="medtech-member-page">
        <section className="medtech-member-card login">
          <span>醫檢師隨機模考</span>
          <h1>登入後開始闖關</h1>
          <p>登入後可以保存每一關的作答紀錄、完成時間與錯題分析。</p>
          <a className="primary" href={memberLoginPath("/medtech/random")}>
            登入會員帳號
          </a>
        </section>
      </main>
    );

  const product = await getMedtechProductSettings(auth.db);

  const [sourceRows, questionRows, ledgerRows, sessionRows, paymentRows] = await Promise.all(
    [
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
    ],
  );
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
  const questionCount = questionRows.filter((row) => {
    const sourceId = Number(row.sourceUrl.replace(/^document:/, ""));
    const source = sourceByAlias.get(row.sourceUrl) ?? sourceById.get(sourceId);
    return chapterNames.has(
      topicOf(source?.fileName ?? "", source?.subject ?? row.subject),
    );
  }).length;
  const packageCount = Math.max(1, Math.ceil(questionCount / PACKAGE_SIZE));
  const now = Date.now();
  const packs = Array.from({ length: packageCount }, (_, offset) => {
    const packNumber = offset + 1;
    const questionTotal = Math.min(
      PACKAGE_SIZE,
      Math.max(0, questionCount - offset * PACKAGE_SIZE),
    );
    const isBonus = questionTotal < PACKAGE_SIZE;
    const matches = ledgerRows.filter(
      (row) =>
        (row.action === "question_pack" ||
          row.action === "question_pack_gift") &&
        descriptions(packNumber).includes(row.description),
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
    const isCompleted = (row: { completedAt: Date | null; status: string; answeredQuestions: number; totalQuestions: number }) =>
      Boolean(
        row.completedAt ||
          row.status === "completed" ||
          ((row.status === "awaiting_submit" || row.status === "in_progress") &&
            row.totalQuestions > 0 &&
            row.answeredQuestions >= row.totalQuestions),
      );
    const completed = sessionRows.some(
      (row) =>
        row.packageName === "隨機模考" &&
        row.packNumber === packNumber &&
        isCompleted(row),
    );
    const hasHistory = sessionRows.some(
      (row) =>
        row.packageName === "隨機模考" &&
        row.packNumber === packNumber &&
        (isCompleted(row) || row.answeredQuestions > 0),
    );
    const purchased = paymentRows.some(
      (row) =>
        row.packageName === "隨機模考" &&
        row.packNumber === packNumber &&
        row.status === "paid",
    );
    const canStart = active || purchased || !freePackageUsed;
    const needsUnlock = !active && !purchased && freePackageUsed;
    const label = active
      ? completed
        ? "已完成 · 可重做"
        : "進行中"
      : purchased
        ? "LINE Pay 已付款・可開始"
        : !freePackageUsed
          ? "任選一包免費"
          : "需開通全庫通行證";
    const action = active
      ? completed
        ? "再次挑戰"
        : "繼續闖關"
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
      purchased,
      ultimateDiscount,
      canStart,
      needsUnlock,
      label,
      action,
      availableUntil: effectiveUntil,
    };
  });
  const ultimateTargets = packs
    .filter((pack) => !pack.active && !pack.purchased && !pack.ultimateDiscount)
    .map((pack) => ({ packageName: "隨機模考", packNumber: pack.packNumber, questionTotal: pack.questionTotal }));
  const todayStart = new Date(`${taipeiDate()}T00:00:00+08:00`);
  const dailyUltimate = sessionRows.find(
    (row) => row.packageType === "ultimate_challenge" && row.startedAt >= todayStart,
  );
  const dailyUltimateStatus = dailyUltimate
    ? dailyUltimate.status === "in_progress" ? "in_progress" : "finished"
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
    (!latestRescueAfterUltimate ||
      latestRescueAfterUltimate.status === "in_progress" ||
      (latestRescueAfterUltimate.status === "failed" &&
        latestRescueAfterUltimate.answeredQuestions < (latestRescueAfterUltimate.totalQuestions || 10)) ||
      (latestRescueAfterUltimate.status === "failed" && latestRescueAfterUltimate.startedAt < todayStart)),
  );
  const payment = (await searchParams)?.payment;

  return (
    <main className="medtech-practice">
      <header className="medtech-top" data-no-navigation-feedback>
        <a href="/medtech" className="medtech-brand">
          <span>醫</span>
          <div>
            <b>醫檢師備考</b>
            <small>隨機模考</small>
          </div>
        </a>
        <MedtechHeaderActions />
      </header>
      <MedtechTabs active="random" />
      <section className="medtech-chapter-page">
        <span>RANDOM MOCK</span>
        <h1>跨章節隨機模考</h1>
        {payment === "success" && (
          <div className="medtech-line-pay-notice success">LINE Pay 付款成功；全庫通行證已開通，可使用 {product.accessDays} 天。</div>
        )}
        {payment === "cancelled" && (
          <div className="medtech-line-pay-notice">您已取消 LINE Pay 付款，題目包未購買。</div>
        )}
        {payment && !["success", "cancelled"].includes(payment) && (
          <div className="medtech-line-pay-notice failed">LINE Pay 付款尚未完成，請稍後再試。</div>
        )}
        <p>
          從臨床病毒學總論、DNA 病毒與 RNA 病毒題庫跨章節抽題。每 30
          題是一個練習單元。首次任選一個單元免費；NT${product.effectivePrice} 開通後全庫 {product.accessDays} 天不限次練習。
        </p>
        <div className="medtech-pack-rule">
          <b>跨章節模考 × 全庫通行證</b>
          <span>
            共 {questionCount} 題 · {packageCount} 個練習單元；通行證有效期間內可不限次重做，
            所有單元立即開放，並保存成績、錯題與練習進度。
          </span>
        </div>
        <div className="medtech-random-pack-grid">
          {packs.map((pack) => {
            const practiceHref = `/medtech/practice?pack=${pack.packNumber}`;
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
                  <div className={`medtech-pack-purchase-card locked${pack.isBonus ? " bonus" : ""}`}>
                    <span>第 {pack.packNumber} 關</span>
                    <b>{pack.questionTotal} 題</b>
                    <i className="medtech-pack-lock-only" aria-label="尚未解鎖">🔒</i>
                  </div>
                ) : (
                  <a
                    className={`${pack.active ? "active " : ""}${!pack.canStart ? "locked " : ""}${pack.isBonus ? "bonus" : ""}`}
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
                      {!pack.canStart && <> <i className="medtech-pack-lock" aria-label="尚未解鎖">🔒</i></>}
                    </small>
                    <strong>
                      {pack.action} {pack.canStart ? "→" : ""}
                    </strong>
                  </a>
                )}
                {pack.hasHistory && (
                  <a
                    className="medtech-pack-history-link"
                    href={`/medtech/practice/history?topic=${encodeURIComponent("隨機模考")}&pack=${pack.packNumber}`}
                  >
                    學習紀錄
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
