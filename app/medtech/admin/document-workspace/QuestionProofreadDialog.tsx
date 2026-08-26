"use client";

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

function content(value: unknown) {
  return String(value ?? "").trim();
}

function qualityHighlightedHtml(value: unknown) {
  const original = content(value);
  if (!original) return original;
  const hasSpacing = /(?:[\u4e00-\u9fff]\s+){3,}[\u4e00-\u9fff]/u.test(original.replace(/<[^>]+>/g, " "));
  let html = original.replace(/([\u4e00-\u9fff])(\s*<br\s*\/?\s*>\s*)(?=[\u4e00-\u9fff])/giu, '$1<mark class="quality-text-warning linebreak" title="疑似強制斷行">↵</mark>$2');
  html = html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<")) return part;
    let text = part.replace(/[\uE000-\uF8FF�]/gu, (char) => {
      const code = `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
      return `<mark class="quality-text-warning garbled" title="亂碼或無法辨識字元：${code}">⚠ ${code}</mark>`;
    });
    text = text.replace(/([\u4e00-\u9fff])\r?\n\s*(?=[\u4e00-\u9fff])/gu, '$1<mark class="quality-text-warning linebreak" title="疑似強制斷行">↵</mark>');
    if (hasSpacing) text = text.replace(/([\u4e00-\u9fff])([ \t]+)(?=[\u4e00-\u9fff])/gu, (_match, left, spaces) => `${left}<mark class="quality-text-warning spacing" title="中文字間異常空格">${"␠".repeat(Math.max(1, spaces.length))}</mark>`);
    return text;
  }).join("");
  return html;
}

function RichContent({ value, empty = "尚未提供" }: { value?: unknown; empty?: string }) {
  const html = qualityHighlightedHtml(value);
  return html
    ? <div className="question-proofread-rich" dangerouslySetInnerHTML={{ __html: html }} />
    : <div className="question-proofread-empty">{empty}</div>;
}

function ExplanationCard({ title, value, tone = "plain", empty }: { title: string; value?: unknown; tone?: "plain" | "ai" | "teacher"; empty?: string }) {
  return <section className={`question-proofread-card question-proofread-explanation ${tone}`}>
    <h3>{title}</h3>
    <RichContent value={value} empty={empty} />
  </section>;
}

export function QuestionProofreadDialog({ question, onClose, accounting = false }: { question: ProofreadQuestion; onClose: () => void; accounting?: boolean }) {
  const teacherAnswer = content(question.teacherAnswer || question.correctAnswer).toUpperCase();
  const aiAnswer = content(question.simulatedAnswer).toUpperCase();
  const aiComplete = content(question.aiCompleteExplanation || question.simulatedCompleteExplanation);
  const teacherComplete = content(question.teacherCompleteExplanation || question.completeExplanation);
  const options = question.options ?? {};
  const teacherAnswerIsLong = teacherAnswer.length > 8;

  return <section className="question-proofread-inline" role="region" aria-label={`第 ${question.questionNumber || ""} 題單題校對`}>
    <div className="question-proofread-dialog question-proofread-inline-dialog">
      <header className="question-proofread-header">
        <div>
          <span>{accounting ? "PLAIN VIEW" : "PROOFREAD VIEW"}</span>
          <h2>第 {question.questionNumber || "未標示"} 題｜{accounting ? "純文字檢視" : "單題校對檢視"}</h2>
          <p>{question.year || "未標示年份"} · {question.subject || "未分類科目"}</p>
        </div>
        <button type="button" className="question-proofread-close" onClick={onClose}>開啟富文編輯</button>
      </header>

      <div className="question-proofread-body">
        <section className="question-proofread-card question-proofread-stem">
          <h3>題幹</h3>
          <RichContent value={question.stem} empty="題幹尚未完成" />
        </section>

        <section className="question-proofread-card question-proofread-options">
          <h3>A～D 選項</h3>
          <div className="question-proofread-option-list">
            {["A", "B", "C", "D"].map((letter) => <article key={letter}>
              <b>{letter}</b>
              <RichContent value={options[letter]} empty={`選項 ${letter} 尚未完成`} />
            </article>)}
          </div>
        </section>

        {(!accounting || !teacherAnswerIsLong) && <section className={`question-proofread-answer-grid ${accounting ? "single" : ""}`}>
          {!accounting && <div className="question-proofread-answer ai"><span>AI 擬答（AI 版）</span><strong>{aiAnswer || "尚未產生"}</strong><small>AI 獨立判斷；僅供與老師答案比對</small></div>}
          <div className={`question-proofread-answer teacher ${teacherAnswerIsLong ? "long-answer" : ""}`}><span>老師答案（老師版）</span><strong dangerouslySetInnerHTML={{ __html: qualityHighlightedHtml(teacherAnswer || "尚未確認") }} /><small>{question.answerSource || "原稿／題庫來源尚未標示"}</small></div>
        </section>}

        <ExplanationCard title="題目原有簡要解析" value={question.explanation || (accounting && teacherAnswerIsLong ? question.teacherAnswer : "")} empty="原題沒有附簡要解析。" />
        {!accounting && <><ExplanationCard title="AI 簡要解析" value={question.simulatedExplanation} tone="ai" empty="AI 簡要解析尚未產生。" /><ExplanationCard title="AI 完整解析（待老師核對）" value={aiComplete} tone="ai" empty="AI 完整解析尚未產生。" /><ExplanationCard title="老師完整解析（老師版）" value={teacherComplete} tone="teacher" empty="老師完整解析尚未補充。" /></>}

        <div className={`question-proofread-status ${question.reviewStatus === "confirmed" ? "confirmed" : "pending"}`}>
          {accounting ? "目前已關閉富文工具列" : question.reviewStatus === "confirmed" ? "本題已確認校對" : "本題尚未確認校對"}
          <span>目前為對照檢視；按右上方「開啟富文編輯」後，才會顯示題幹與選項的編輯工具。</span>
        </div>
      </div>
    </div>
  </section>;
}
