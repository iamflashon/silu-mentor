"use client";
import { useEffect, useRef, useState } from "react";
import AccountingPurchaseButton from "../AccountingPurchaseButton";

type Q = {
  id: number;
  year: string;
  examName: string;
  subject: string;
  questionNumber: string;
  stem: string;
  optionsJson: string | null;
  correctAnswer: string | null;
  explanation: string;
  teacherNotes: string;
};
const BOOK_TITLE = "會研所中級會計學題庫制霸";
type PracticeMode = "ordered" | "random" | "options";
const PRACTICE_MODES: Array<{
  key: PracticeMode;
  title: string;
  description: string;
}> = [
  {
    key: "ordered",
    title: "1. 照順序練習",
    description: "依本章原始題號逐題練習。",
  },
  {
    key: "random",
    title: "2. 隨機出題",
    description: "題目順序重新打亂，選項維持 A～D。",
  },
  {
    key: "options",
    title: "3. 隨機選項",
    description: "題目照原順序，A～D 選項重新排列。",
  },
];
const CHAPTERS = [
  "第一章 財務報導之觀念架構",
  "第二章 財務報表的表達",
  "第三章 複利及年金",
  "第四章 收入認列與衡量",
  "第五章 現金及應收帳款",
  "第六章 存貨",
  "第七章 營業用資產",
  "第八章 無形資產、投資性不動產、生物資產",
  "第九章 金融資產 IFRS 9",
  "第十章 負債",
  "第十一章 股東權益與每股盈餘",
  "第十二章 租賃",
  "第十三章 員工福利",
  "第十四章 所得稅",
  "第十五章 現金流量表",
  "第十六章 會計變動及錯誤更正",
  "第十七章 財務報表分析",
  "第十八章 中會其他歷屆試題",
];

export default function AccountingPracticeClient() {
  const [items, setItems] = useState<Q[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [chapter, setChapter] = useState(CHAPTERS[0]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [bookTotal, setBookTotal] = useState(0);
  const [chapterTotal, setChapterTotal] = useState(0);
  const [paidAccess, setPaidAccess] = useState(false);
  const [hasWholeBook, setHasWholeBook] = useState(false);
  const [trialAccess, setTrialAccess] = useState(true);
  const [trialLimit, setTrialLimit] = useState(10);
  const [notice, setNotice] = useState("正在載入本書已發布題目…");
  const [mode, setMode] = useState<PracticeMode | null>(null);
  const [started, setStarted] = useState(false);
  const [wrongReview, setWrongReview] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());
  const [seed, setSeed] = useState(() => Date.now() % 2147483647);
  async function refreshWrongCount(selectedChapter = chapter) {
    const chapterNumber = CHAPTERS.indexOf(selectedChapter) + 1;
    const response = await fetch(
      `/api/accounting/practice-attempts?chapterNumber=${chapterNumber}`,
      { cache: "no-store" },
    );
    if (response.ok)
      setWrongCount(Number((await response.json()).wrongCount || 0));
  }
  async function load(
    target = 1,
    selectedChapter = chapter,
    selectedMode = mode,
    selectedSeed = seed,
    preview = false,
    reviewWrong = wrongReview,
  ) {
    const chapterNumber = CHAPTERS.indexOf(selectedChapter) + 1;
    const response = await fetch(
      `/api/accounting/book-practice?page=${target}&chapterNumber=${chapterNumber}&chapter=${encodeURIComponent(selectedChapter)}&questionOrder=${selectedMode === "random" ? "random" : "ordered"}&seed=${selectedSeed}${preview ? "&preview=1" : ""}${reviewWrong ? "&review=wrong" : ""}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as {
      items?: Q[];
      total?: number;
      bookTotal?: number;
      chapterTotal?: number;
      trialLimit?: number;
      paidAccess?: boolean;
      trialAccess?: boolean;
      hasWholeBook?: boolean;
    };
    const rows = data.items ?? [];
    setItems(rows);
    setTotal(data.total ?? 0);
    setBookTotal(data.bookTotal ?? 0);
    setChapterTotal(data.chapterTotal ?? 0);
    setTrialLimit(data.trialLimit ?? 10);
    setPaidAccess(Boolean(data.paidAccess));
    setTrialAccess(Boolean(data.trialAccess));
    setHasWholeBook(Boolean(data.hasWholeBook));
    setIndex(0);
    setSelected("");
    setPage(target);
    setNotice(
      preview && data.paidAccess
        ? `${selectedChapter}共 ${(data.chapterTotal ?? 0).toLocaleString()} 題；請先選擇練題方式。`
        : preview && data.trialAccess
          ? `可免費體驗第一章前 ${data.trialLimit ?? 10} 題；請先選擇練題方式。`
          : rows.length
            ? data.paidAccess
              ? `${selectedChapter}共 ${(data.chapterTotal ?? 0).toLocaleString()} 題；全書 ${(data.bookTotal ?? 0).toLocaleString()} 題。`
              : `免費體驗第一章前 ${data.trialLimit ?? 10} 題；可單買任一章或解鎖整本。`
            : (data.chapterTotal ?? 0) > 0
              ? `${selectedChapter}尚未解鎖，可單買本章或購買整本。`
              : "本章目前尚未完成題目分類。",
    );
  }
  useEffect(() => {
    void load(1, chapter, null, seed, true, false);
    void refreshWrongCount(chapter);
  }, []);
  const question = items[index];
  let options: Record<string, string> = {};
  try {
    options = JSON.parse(question?.optionsJson || "{}") as Record<
      string,
      string
    >;
  } catch {}
  const displayOptions = Object.entries(options)
    .filter(([key]) => ["A", "B", "C", "D"].includes(key))
    .map(([originalKey, value]) => ({ originalKey, value }));
  if (mode === "options" && question) {
    const optionRank = (key: string) =>
      Math.imul(
        (question.id * 31 + key.charCodeAt(0) + seed) >>> 0,
        2654435761,
      ) >>> 0;
    displayOptions.sort(
      (a, b) => optionRank(a.originalKey) - optionRank(b.originalKey),
    );
  }
  const displayedOptions = displayOptions.map((item, optionIndex) => ({
    ...item,
    key: String.fromCharCode(65 + optionIndex),
  }));
  const displayedCorrectAnswer =
    displayedOptions.find(
      (item) => item.originalKey === question?.correctAnswer,
    )?.key ??
    question?.correctAnswer ??
    "";
  const answered = Boolean(selected);
  useEffect(() => {
    if (!question || answered) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [question?.id, answered]);
  async function answer(key: string) {
    if (!question || answered) return;
    setSelected(key);
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt.current) / 1000),
    );
    setElapsed(seconds);
    await fetch("/api/accounting/practice-attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: question.id,
        chapterNumber: CHAPTERS.indexOf(chapter) + 1,
        selectedAnswer: key,
        correctAnswer: displayedCorrectAnswer,
        elapsedSeconds: seconds,
        practiceMode: wrongReview ? "review" : mode,
      }),
    });
    await refreshWrongCount(chapter);
  }
  return (
    <section className="accounting-practice-shell">
      <header className="accounting-practice-heading">
        <img
          className="accounting-practice-cover"
          src="/api/accounting/product/cover"
          alt={`${BOOK_TITLE}書封`}
        />
        <div>
          <span>會研所中級會計・18 章題庫</span>
          <h1>{BOOK_TITLE}</h1>
          <p>{notice}</p>
        </div>
      </header>
      <div className="accounting-bank-filters">
        <label>
          自選練習章節
          <select
            value={chapter}
            onChange={(event) => {
              const value = event.target.value;
              setChapter(value);
              setStarted(false);
              setMode(null);
              setWrongReview(false);
              const nextSeed = Date.now() % 2147483647;
              setSeed(nextSeed);
              void load(1, value, null, nextSeed, true, false);
              void refreshWrongCount(value);
            }}
          >
            {CHAPTERS.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <span>
          {hasWholeBook
            ? "已解鎖整本 18 章"
            : paidAccess
              ? "本章已解鎖"
              : trialAccess
                ? `免費體驗前 ${trialLimit} 題`
                : "本章尚未解鎖"}
        </span>
      </div>
      <div className="accounting-practice-modes" aria-label="選擇練題方式">
        {PRACTICE_MODES.map((item) => (
          <button
            type="button"
            className={
              started && !wrongReview && mode === item.key ? "active" : ""
            }
            aria-pressed={mode === item.key}
            key={item.key}
            onClick={() => {
              const nextSeed = Date.now() % 2147483647;
              setMode(item.key);
              setStarted(true);
              setWrongReview(false);
              setSeed(nextSeed);
              void load(1, chapter, item.key, nextSeed);
            }}
          >
            <b>{item.title}</b>
            <small>{item.description}</small>
          </button>
        ))}
        <button
          type="button"
          className={started && wrongReview ? "active review" : "review"}
          onClick={() => {
            const nextSeed = Date.now() % 2147483647;
            setMode("ordered");
            setStarted(true);
            setWrongReview(true);
            setSeed(nextSeed);
            void load(1, chapter, "ordered", nextSeed, false, true);
          }}
        >
          <b>錯題複習</b>
          <small>目前 {wrongCount} 題；答對後移出錯題。</small>
        </button>
      </div>
      {started && question ? (
        <article className="accounting-practice-card">
          <small>
            {chapter}・第 {question.questionNumber} 題　·　第{" "}
            {(page - 1) * 10 + index + 1}/
            {paidAccess ? chapterTotal : trialLimit} 題
            <span className="accounting-question-timer">
              ⏱ {Math.floor(elapsed / 60)}:
              {String(elapsed % 60).padStart(2, "0")}
            </span>
          </small>
          <h2>{question.stem}</h2>
          <div className="accounting-options">
            {displayedOptions.map((item) => (
              <button
                className={
                  answered
                    ? item.key === displayedCorrectAnswer
                      ? "correct"
                      : item.key === selected
                        ? "wrong"
                        : ""
                    : selected === item.key
                      ? "selected"
                      : ""
                }
                disabled={answered}
                onClick={() => void answer(item.key)}
                key={`${question.id}-${item.key}`}
              >
                <b>{item.key}</b>
                <span>{item.value}</span>
              </button>
            ))}
          </div>
          {answered && (
            <section className="accounting-practice-explanation">
              <b>
                {selected === displayedCorrectAnswer
                  ? "答對了"
                  : `這題答案是 ${displayedCorrectAnswer || "尚待核對"}`}
              </b>
              {question.explanation ? (
                <div
                  className="accounting-rich-explanation"
                  dangerouslySetInnerHTML={{ __html: question.explanation }}
                />
              ) : (
                <p>老師原檔目前沒有獨立解析，可交給課業答疑協助說明。</p>
              )}
              <small>題庫來源：{BOOK_TITLE}</small>
              <a href="/accounting/qa">針對本題進入課業答疑</a>
            </section>
          )}
          <footer>
            <button
              disabled={page === 1 && index === 0}
              onClick={() => {
                if (index > 0) {
                  setIndex((value) => value - 1);
                  setSelected("");
                } else void load(page - 1);
              }}
            >
              上一題
            </button>
            {!paidAccess && index === items.length - 1 ? (
              <a className="accounting-unlock" href="#chapter-purchase">
                選擇購買方案
              </a>
            ) : (
              <button
                disabled={!selected}
                onClick={() => {
                  if (index < items.length - 1) {
                    setIndex((value) => value + 1);
                    setSelected("");
                  } else if (page * 10 < total) void load(page + 1);
                }}
              >
                {index < items.length - 1 || page * 10 < total
                  ? "下一題"
                  : "完成本章練習"}
              </button>
            )}
          </footer>
        </article>
      ) : !started ? (
        <div className="accounting-practice-empty choose-mode">
          <b>請先選擇練題方式</b>
          <p>選好順序、隨機出題或隨機選項後，才會顯示第一題並開始計時。</p>
        </div>
      ) : (
        <div className="accounting-practice-empty">
          <b>
            {wrongReview
              ? "本章目前沒有待複習錯題"
              : chapterTotal > 0
                ? "本章尚未解鎖"
                : "本章尚未完成題目分類"}
          </b>
          <p>
            {wrongReview
              ? "答錯的題目會自動收進這裡；重新答對後即完成複習。"
              : chapterTotal > 0
                ? "可購買本章 30 天，或直接解鎖整本 18 章。"
                : "請回教材發布管理補上本章分類。"}
          </p>
        </div>
      )}
      {!hasWholeBook && (
        <section id="chapter-purchase" className="accounting-chapter-purchase">
          <div>
            <span>單章方案</span>
            <h2>{chapter}</h2>
            <b>NT$39・30 天・本章全部 {chapterTotal.toLocaleString()} 題</b>
            <AccountingPurchaseButton
              active={chapterTotal > 0}
              plan="chapter"
              chapterNumber={CHAPTERS.indexOf(chapter) + 1}
              label={
                chapterTotal > 0 ? "LINE Pay 購買本章 NT$39" : "本章整理中"
              }
            />
          </div>
          <div>
            <span>整本方案</span>
            <h2>全部 18 章</h2>
            <b>NT$249・90 天・全書 {bookTotal.toLocaleString()} 題</b>
            <AccountingPurchaseButton
              active={bookTotal > 0}
              plan="book"
              label={
                bookTotal > 0 ? "LINE Pay 解鎖整本 NT$249" : "整本題庫整理中"
              }
            />
          </div>
        </section>
      )}
    </section>
  );
}
