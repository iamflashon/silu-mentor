import { headers } from "next/headers";
import { and, desc, eq, inArray } from "drizzle-orm";
import MedtechTabs from "../../MedtechTabs";
import MedtechHeaderActions from "../../MedtechHeaderActions";
import { chatGPTSignInPath } from "../../../chatgpt-auth";
import { examQuestions, medtechPracticeSessions } from "../../../../db/schema";
import { requireMedtechMember } from "../../../../lib/member-auth";
import HistoryBulkActions from "./HistoryBulkActions";

export const dynamic = "force-dynamic";

type SearchParams = { topic?: string | string[]; pack?: string | string[] };
type HistoryDetail = { questionId: number; order: number; answer: string | null; durationSeconds: number; answeredAt: string | null; correct?: boolean | null };

function parseDetails(value: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item, index): HistoryDetail | null => {
      const questionId = Number(item.questionId);
      if (!Number.isInteger(questionId) || questionId < 1) return null;
      const answer = typeof item.answer === "string" && /^[A-D]$/.test(item.answer) ? item.answer : null;
      return {
        questionId,
        order: Math.max(0, Math.floor(Number(item.order) || index)),
        answer,
        durationSeconds: Math.max(0, Math.floor(Number(item.durationSeconds) || 0)),
        answeredAt: typeof item.answeredAt === "string" ? item.answeredAt : null,
        correct: typeof item.correct === "boolean" ? item.correct : null,
      };
    }).filter((item): item is HistoryDetail => Boolean(item)).sort((left, right) => left.order - right.order);
  } catch {
    return [];
  }
}

function parseList(value: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0) : [];
  } catch {
    return [];
  }
}

function parseWeaknesses(value: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { label: string; count: number } => Boolean(item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string" && typeof (item as { count?: unknown }).count === "number")) : [];
  } catch {
    return [];
  }
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours ? `${hours} 小時 ${String(minutes).padStart(2, "0")} 分` : `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`;
}

function formatDate(value: Date | null) {
  return value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value) : "—";
}

function statusLabel(status: string, completedAt: Date | null) {
  if (completedAt || status === "completed") return "已完成";
  if (status === "paused") return "中途離開 · 已保存";
  if (status === "awaiting_submit") return "已作答 · 尚未交卷";
  if (status === "expired") return "已逾期";
  return "進行中";
}

function answerText(optionsJson: string, answer: string | null) {
  if (!answer) return "未作答";
  try {
    const options = JSON.parse(optionsJson || "{}") as Record<string, string>;
    return `${answer}｜${options[answer] || ""}`;
  } catch {
    return answer;
  }
}

export default async function MedtechPracticeHistory({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const requestHeaders = await headers();
  const auth = await requireMedtechMember(new Request("https://medtech.local/medtech/practice/history", { headers: requestHeaders }));
  if ("error" in auth) {
    return <main className="medtech-member-page"><section className="medtech-member-card login"><span>醫檢師學習紀錄</span><h1>登入後查看刷題紀錄</h1><p>登入後可以查看每回練習的日期、完成狀態、作答時間、錯題與逐題解析。</p><a className="primary" href={chatGPTSignInPath("/medtech/practice/history")}>登入醫檢師備考</a></section></main>;
  }

  const params = (await searchParams) ?? {};
  const topicValue = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const packValue = Array.isArray(params.pack) ? params.pack[0] : params.pack;
  const packNumber = packValue ? Math.max(1, Number(packValue) || 1) : null;
  const filters = [eq(medtechPracticeSessions.userKey, auth.userKey)];
  if (topicValue) filters.push(eq(medtechPracticeSessions.packageName, topicValue));
  if (packNumber) filters.push(eq(medtechPracticeSessions.packNumber, packNumber));
  const sessions = await auth.db.select().from(medtechPracticeSessions).where(and(...filters)).orderBy(desc(medtechPracticeSessions.startedAt)).limit(30);
  const detailsBySession = new Map<number, HistoryDetail[]>();
  const questionIds = new Set<number>();
  for (const session of sessions) {
    const details = parseDetails(session.answerDetailsJson);
    detailsBySession.set(session.id, details);
    for (const detail of details) questionIds.add(detail.questionId);
  }
  const questionRows = questionIds.size ? await auth.db.select({
    id: examQuestions.id,
    year: examQuestions.year,
    questionNumber: examQuestions.questionNumber,
    stem: examQuestions.stem,
    optionsJson: examQuestions.optionsJson,
    correctAnswer: examQuestions.correctAnswer,
    teacherAnswer: examQuestions.teacherAnswer,
    simulatedAnswer: examQuestions.simulatedAnswer,
    explanation: examQuestions.explanation,
    completeExplanation: examQuestions.completeExplanation,
    teacherCompleteExplanation: examQuestions.teacherCompleteExplanation,
    aiCompleteExplanation: examQuestions.aiCompleteExplanation,
    simulatedCompleteExplanation: examQuestions.simulatedCompleteExplanation,
  }).from(examQuestions).where(inArray(examQuestions.id, [...questionIds].slice(0, 900))) : [];
  const questionById = new Map(questionRows.map((row) => [row.id, row]));
  const dateLabel = topicValue ? `${topicValue}${packNumber ? ` · 第 ${packNumber} 關` : ""}` : "全部題目包";

  return <main className="medtech-practice medtech-history-page">
    <header className="medtech-top" data-no-navigation-feedback><a href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>學習紀錄</small></div></a><MedtechHeaderActions /></header>
    <MedtechTabs active={topicValue === "隨機模考" ? "random" : topicValue ? "chapters" : "random"}/>
    <section className="medtech-history-shell">
      <header className="medtech-history-heading"><div><span>STUDY HISTORY</span><h1>學習紀錄</h1><p>{dateLabel} · 每回練習的時間、狀態、錯題與逐題解析都集中在這裡。</p></div><div className="medtech-history-heading-actions"><a href="/medtech/chapters">章節題包</a></div></header>
      {!sessions.length ? <section className="medtech-history-empty"><b>目前還沒有這個題目包的作答紀錄。</b><span>完成一回練習後，這裡會留下開始時間、完成狀態與逐題檢討。</span></section> : <HistoryBulkActions sessionIds={sessions.map((session) => session.id)}><div className="medtech-history-list">
        {sessions.map((session) => {
          const details = detailsBySession.get(session.id) ?? [];
          const correctCount = session.correctQuestions || details.filter((detail) => detail.correct === true).length;
          const answeredCount = session.answeredQuestions || details.filter((detail) => Boolean(detail.answer)).length;
          const longest = details.reduce<HistoryDetail | null>((best, detail) => !best || detail.durationSeconds > best.durationSeconds ? detail : best, null);
          const longestWrong = longest && longest.correct === false;
          const repeatedWrong = parseList(session.repeatedWrongQuestionIdsJson);
          const weaknesses = parseWeaknesses(session.weaknessesJson);
          return <article className={`medtech-history-card ${session.completedAt ? "completed" : "unfinished"}`} key={session.id}>
            <header><div><label className="medtech-history-select"><input type="checkbox" data-history-session={session.id} /><span>選取這筆</span></label><span>{session.packageName} · 第 {session.packNumber} 關</span><h2>{statusLabel(session.status, session.completedAt)}</h2><small>開始：{formatDate(session.startedAt)} · 最後活動：{formatDate(session.lastActiveAt)}</small></div><div className="medtech-history-card-actions">{!session.completedAt && session.status !== "expired" && <a className="primary" href={`/medtech/practice?${session.packageName === "隨機模考" ? `pack=${session.packNumber}` : `topic=${encodeURIComponent(session.packageName)}&pack=${session.packNumber}`}`}>繼續作答</a>}<a href={`/medtech/practice/history?${session.packageName === "隨機模考" ? `topic=${encodeURIComponent("隨機模考")}&pack=${session.packNumber}` : `topic=${encodeURIComponent(session.packageName)}&pack=${session.packNumber}`}`}>重新整理</a></div></header>
            <div className="medtech-history-stat-grid"><div><small>作答進度</small><b>{answeredCount}／{session.totalQuestions} 題</b></div><div><small>本回總時間</small><b>{formatDuration(session.durationSeconds)}</b></div><div><small>答對／答對率</small><b>{correctCount} 題／{answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0}%</b></div><div><small>完成時間</small><b>{formatDate(session.completedAt)}</b></div></div>
            {!session.completedAt && <p className="medtech-history-warning">這回尚未完成；離開不會直接作廢，進度已保存。請回到題包補完所有題目後按「交卷」，才會完成本回紀錄並更新錯題分析。</p>}
            {session.completedAt && <div className="medtech-history-insights"><span className={longestWrong ? "critical" : ""}>最久思考：{longest ? `第 ${longest.order + 1} 題 · ${formatDuration(longest.durationSeconds)}` : "尚無逐題時間"}{longestWrong ? " · 思考最久且答錯，請特別複習" : ""}</span><span className={repeatedWrong.length ? "critical" : ""}>重複答錯：{repeatedWrong.length ? `${repeatedWrong.length} 題` : "無"}</span>{weaknesses.slice(0, 3).map((item) => <span key={item.label}>需加強：{item.label}（{item.count} 題）</span>)}</div>}
            <details className="medtech-history-details"><summary>展開逐題紀錄與解析（{details.length || session.totalQuestions} 題）</summary><div className="medtech-history-question-list">{details.length ? details.map((detail) => { const question = questionById.get(detail.questionId); const answer = question ? question.teacherAnswer || question.correctAnswer || question.simulatedAnswer : null; const correct = detail.correct ?? (answer ? detail.answer === answer : null); const explanation = question?.teacherCompleteExplanation || question?.completeExplanation || question?.aiCompleteExplanation || question?.simulatedCompleteExplanation || question?.explanation || "目前沒有可顯示的解析。"; return <details className={`medtech-history-question ${correct === true ? "right" : correct === false ? "wrong" : "unanswered"}`} key={`${session.id}-${detail.questionId}`}><summary><b>第 {detail.order + 1} 題</b><span>{correct === true ? "答對" : correct === false ? "答錯" : "未作答"}</span><span>作答 {formatDuration(detail.durationSeconds)}</span></summary>{question ? <div className="medtech-history-question-body"><h3>{question.stem}</h3><div className="medtech-history-answer-grid"><p>作答：<b>{answerText(question.optionsJson, detail.answer)}</b></p><p>正確答案：<b>{answerText(question.optionsJson, answer)}</b></p></div><div className="medtech-history-options">{Object.entries(JSON.parse(question.optionsJson || "{}") as Record<string, string>).map(([letter, text]) => <span className={letter === answer ? "correct" : letter === detail.answer ? "picked" : ""} key={letter}><b>{letter}</b>{text}</span>)}</div><div className="medtech-history-explanation"><b>個別解析</b><p>{explanation}</p></div></div> : <p className="medtech-history-missing">題目內容已不在目前公開題庫中，但作答時間仍已保存。</p>}</details>; }) : <p className="medtech-history-missing">這筆紀錄建立於逐題計時功能上線前，只有整包統計，沒有逐題明細。</p>}</div></details>
          </article>;
        })}
      </div></HistoryBulkActions>}
    </section>
  </main>;
}
