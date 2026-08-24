"use client";

import { scanMedtechQuestion } from "../../../../lib/medtech-content-quality";

type ProofreadQuestion = {
  year?: string;
  subject?: string;
  questionNumber?: string;
  stem?: string;
  options?: Record<string, string>;
  teacherAnswer?: string;
  correctAnswer?: string | null;
  simulatedAnswer?: string;
  explanation?: string;
  simulatedExplanation?: string;
  aiCompleteExplanation?: string;
  simulatedCompleteExplanation?: string;
  teacherCompleteExplanation?: string;
  completeExplanation?: string;
  answerSource?: string;
  reviewStatus?: "pending" | "confirmed";
};

function content(value: unknown) { return String(value ?? "").trim(); }

function RichContent({ value, empty = "尚未提供" }: { value?: unknown; empty?: string }) {
  const html = content(value);
  return html ? <div className="question-proofread-rich" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="question-proofread-empty">{empty}</div>;
}

function ExplanationCard({ title, value, tone = "plain", empty }: { title: string; value?: unknown; tone?: "plain" | "ai" | "teacher"; empty?: string }) {
  return <section className={`question-proofread-card question-proofread-explanation ${tone}`}><h3>{title}</h3><RichContent value={value} empty={empty} /></section>;
}

export function QuestionProofreadDialog({ question, onClose, accounting = false }: { question: ProofreadQuestion; onClose: () => void; accounting?: boolean }) {
  const teacherAnswer = content(question.teacherAnswer || question.correctAnswer).toUpperCase();
  const aiAnswer = content(question.simulatedAnswer).toUpperCase();
  const aiComplete = content(question.aiCompleteExplanation || question.simulatedCompleteExplanation);
  const teacherComplete = content(question.teacherCompleteExplanation || question.completeExplanation);
  const options = question.options ?? {};
  const qualityIssues = accounting ? [] : scanMedtechQuestion(question as unknown as Record<string, unknown>);
  const p0 = qualityIssues.filter(item => item.severity === "P0").length;
  const p1 = qualityIssues.filter(item => item.severity === "P1").length;

  return <section className="question-proofread-inline" role="region" aria-label={`第 ${question.questionNumber || ""} 題單題校對`}>
    <div className="question-proofread-dialog question-proofread-inline-dialog">
      <header className="question-proofread-header">
        <div><span>{accounting ? "PLAIN VIEW" : "PROOFREAD VIEW"}</span><h2>第 {question.questionNumber || "未標示"} 題｜{accounting ? "純文字檢視" : "單題校對檢視"}</h2><p>{question.year || "未標示年份"} · {question.subject || "未分類科目"}</p></div>
        <button type="button" className="question-proofread-close" onClick={onClose}>開啟富文編輯</button>
      </header>

      <div className="question-proofread-body">
        {!accounting && <section className="question-proofread-card" style={{border:p0?"2px solid #b42318":p1?"2px solid #b54708":"1px solid #a6f4c5",background:p0?"#fff5f3":p1?"#fffaeb":"#f6fef9"}}>
          <h3>原稿品質檢查</h3>
          {qualityIssues.length === 0 ? <div>未偵測到特殊字元、替代方框、章節串題或已知公式結構異常。</div> : <>
            <div style={{marginBottom:10}}><strong>P0 內容風險 {p0} 筆</strong> · P1 結構風險 {p1} 筆 · 共 {qualityIssues.length} 筆</div>
            <div style={{display:"grid",gap:8}}>{qualityIssues.map((issue,index)=><article key={`${issue.field}-${index}`} style={{padding:"10px 12px",background:"white",border:"1px solid #e4e7ec",borderRadius:8}}>
              <div><strong>{issue.severity}｜{issue.field}</strong>　{issue.message}</div>
              <code style={{display:"block",whiteSpace:"pre-wrap",marginTop:6}}>{issue.excerpt}</code>
              <small>{issue.autoFixable ? "可套用高信心字元規則；仍應保留原稿覆核紀錄。" : "不可直接猜測，需回 PDF 原稿確認。"}</small>
            </article>)}</div>
          </>}
        </section>}

        <section className="question-proofread-card question-proofread-stem"><h3>題幹</h3><RichContent value={question.stem} empty="題幹尚未完成" /></section>
        <section className="question-proofread-card question-proofread-options"><h3>A～D 選項</h3><div className="question-proofread-option-list">{["A","B","C","D"].map(letter=><article key={letter}><b>{letter}</b><RichContent value={options[letter]} empty={`選項 ${letter} 尚未完成`} /></article>)}</div></section>
        <section className={`question-proofread-answer-grid ${accounting ? "single" : ""}`}>
          {!accounting && <div className="question-proofread-answer ai"><span>AI 擬答（AI 版）</span><strong>{aiAnswer || "尚未產生"}</strong><small>AI 獨立判斷；僅供與老師答案比對</small></div>}
          <div className="question-proofread-answer teacher"><span>老師答案（老師版）</span><strong>{teacherAnswer || "尚未確認"}</strong><small>{question.answerSource || "原稿／題庫來源尚未標示"}</small></div>
        </section>
        <ExplanationCard title="題目原有簡要解析" value={question.explanation} empty="原題沒有附簡要解析。" />
        {!accounting && <><ExplanationCard title="AI 簡要解析" value={question.simulatedExplanation} tone="ai" empty="AI 簡要解析尚未產生。" /><ExplanationCard title="AI 完整解析（待老師核對）" value={aiComplete} tone="ai" empty="AI 完整解析尚未產生。" /><ExplanationCard title="老師完整解析（老師版）" value={teacherComplete} tone="teacher" empty="老師完整解析尚未補充。" /></>}
        <div className={`question-proofread-status ${question.reviewStatus === "confirmed" ? "confirmed" : "pending"}`}>
          {accounting ? "目前已關閉富文工具列" : question.reviewStatus === "confirmed" ? "本題已確認校對" : "本題尚未確認校對"}
          <span>目前為對照檢視；按右上方「開啟富文編輯」後，才會顯示題幹與選項的編輯工具。</span>
        </div>
      </div>
    </div>
  </section>;
}
