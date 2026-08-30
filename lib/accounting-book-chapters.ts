export const ACCOUNTING_QUESTION_BANK_CHAPTERS = [
  { number: 1, title: "財務報導之觀念架構", pageStart: 3, pageEnd: 18 },
  { number: 2, title: "財務報表的表達", pageStart: 19, pageEnd: 36 },
  { number: 3, title: "複利及年金", pageStart: 37, pageEnd: 48 },
  { number: 4, title: "收入認列與衡量", pageStart: 49, pageEnd: 100 },
  { number: 5, title: "現金及應收帳款", pageStart: 101, pageEnd: 122 },
  { number: 6, title: "存貨", pageStart: 123, pageEnd: 142 },
  { number: 7, title: "營業用資產", pageStart: 143, pageEnd: 208 },
  { number: 8, title: "無形資產、投資性不動產、生物資產", pageStart: 209, pageEnd: 226 },
  { number: 9, title: "金融資產 IFRS 9", pageStart: 227, pageEnd: 280 },
  { number: 10, title: "負債", pageStart: 281, pageEnd: 324 },
  { number: 11, title: "股東權益與每股盈餘", pageStart: 325, pageEnd: 368 },
  { number: 12, title: "租賃", pageStart: 369, pageEnd: 408 },
  { number: 13, title: "員工福利", pageStart: 409, pageEnd: 428 },
  { number: 14, title: "所得稅", pageStart: 429, pageEnd: 464 },
  { number: 15, title: "現金流量表", pageStart: 465, pageEnd: 508 },
  { number: 16, title: "會計變動及錯誤更正", pageStart: 509, pageEnd: 538 },
  { number: 17, title: "財務報表分析", pageStart: 539, pageEnd: 546 },
  { number: 18, title: "中會其他歷屆試題", pageStart: 547, pageEnd: 549 },
] as const;

export function accountingSourcePage(notes: string | null | undefined) {
  const match = String(notes || "").match(/原稿第\s*(\d+)\s*頁/u);
  return match ? Number(match[1]) : null;
}

export function accountingChapterForNotes(notes: string | null | undefined) {
  const page = accountingSourcePage(notes);
  if (page) return ACCOUNTING_QUESTION_BANK_CHAPTERS.find((chapter) => page >= chapter.pageStart && page <= chapter.pageEnd) ?? null;
  const text = String(notes || "");
  return ACCOUNTING_QUESTION_BANK_CHAPTERS.find((chapter) => text.includes(`第${chapter.number}章`) || text.includes(chapter.title)) ?? null;
}
