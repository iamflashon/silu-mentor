import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { getOpenAIKey } from "../../../lib/openai";
import { documents, examQuestions } from "../../../db/schema";
import { removeAccountingPageFurniture } from "../../../lib/accounting-question";
import { ACCOUNTING_WORD_BANK_SOURCE, importAccountingWordBank } from "../../../lib/accounting-word-bank";

const allowedAnswerHosts = new Set(["lawyer.get.com.tw", "fd.get.com.tw"]);

function assertAnswerSource(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !allowedAnswerHosts.has(url.hostname)) throw new Error("目前只允許從核准的高點真題來源抓取擬答");
  return url;
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "") : []).join("").trim();
}

function normalizeQuestionNumber(value: string) {
  return value.replace(/[\s　]/g, "").replace(/第/g, "").replace(/題/g, "").replace(/[一二三四五六七八九十百]+/g, (part) => {
    const digits: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10", 百: "100" };
    if (part === "十") return "10";
    if (part.length === 2 && part.startsWith("十")) return String(10 + Number(digits[part[1]]));
    if (part.length === 2 && part.endsWith("十")) return String(Number(digits[part[0]]) * 10);
    return digits[part] ?? part;
  }).replace(/[^0-9a-zA-Z]/g, "");
}

async function extractTeacherAnswers(sourceUrl: string, year: string) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  const download = await fetch(assertAnswerSource(sourceUrl), { redirect: "follow", headers: { "user-agent": "SiluMentor/1.0" } });
  if (!download.ok) throw new Error(`擬答 PDF 下載失敗（HTTP ${download.status}）`);
  assertAnswerSource(download.url);
  const bytes = await download.arrayBuffer();
  if (bytes.byteLength < 1000 || bytes.byteLength > 55 * 1024 * 1024) throw new Error("擬答 PDF 大小不符合處理限制");
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new File([bytes], `${year || "essay"}-teacher-answer.pdf`, { type: "application/pdf" }));
  const uploaded = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
  const uploadPayload = await uploaded.json() as { id?: string; error?: { message?: string } };
  if (!uploaded.ok || !uploadPayload.id) throw new Error(uploadPayload.error?.message ?? "擬答 PDF 無法送入分析服務");
  try {
    const model = process.env.OPENAI_EXTRACTION_MODEL || "gpt-5.6-terra";
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({
      model,
      instructions: "你是台灣司律二試資料核對員。只擷取 PDF 明確存在的高點名師參考擬答，不得自行補寫法律見解。依題號回傳完整老師擬答；同一份 PDF 常含試題評析、考點命中與【擬答】，請分別保存。擬答來源只能標示為高點名師參考擬答，不得寫成官方擬答。rubric 只整理 PDF 明確可辨識的評分重點；若沒有明確擬答，teacher_answer 必須是空字串。",
      input: [{ role: "user", content: [{ type: "input_file", file_id: uploadPayload.id }, { type: "input_text", text: `請核對 ${year || "未標示"} 年這份高點二試 PDF，逐題擷取題號、完整題目對應的老師參考擬答、試題評析與可辨識評分重點，輸出 JSON。` }] }],
      text: { format: { type: "json_schema", name: "teacher_answers", strict: true, schema: { type: "object", additionalProperties: false, properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, properties: { question_number: { type: "string" }, teacher_answer: { type: "string" }, teacher_notes: { type: "string" }, rubric: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterion: { type: "string" }, points: { type: "string" }, must_include: { type: "string" } }, required: ["criterion", "points", "must_include"] } } }, required: ["question_number", "teacher_answer", "teacher_notes", "rubric"] } } }, required: ["answers"] } } },
      max_output_tokens: 24000,
    }) });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "老師擬答分析失敗");
    const parsed = JSON.parse(responseText(payload)) as { answers?: Array<{ question_number: string; teacher_answer: string; teacher_notes: string; rubric: Array<{ criterion: string; points: string; must_include: string }> }> };
    return parsed.answers ?? [];
  } finally {
    await fetch(`https://api.openai.com/v1/files/${uploadPayload.id}`, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const status = url.searchParams.get("status") || "draft";
  const examType = url.searchParams.get("examType") || "all";
  const year = url.searchParams.get("year") || "all";
  const subject = url.searchParams.get("subject") || "all";
  const sourceBook = url.searchParams.get("sourceBook") || "all";
  const sourceDocumentTitle = url.searchParams.get("sourceDocumentTitle") || "";
  const chapter = url.searchParams.get("chapter") || "all";
  const paper = url.searchParams.get("paper") || "all";
  const examCategory = url.searchParams.get("examCategory") || "all";
  const db = await getDb();
  if (examCategory === "accounting") await importAccountingWordBank(db);
  const filters = [];
  if (status !== "all") filters.push(eq(examQuestions.status, status));
  if (examType !== "all") filters.push(eq(examQuestions.examType, examType));
  if (year !== "all") filters.push(eq(examQuestions.year, year));
  if (subject !== "all") filters.push(eq(examQuestions.subject, subject));
  if (sourceBook !== "all") filters.push(eq(examQuestions.examName, sourceBook));
  if (sourceDocumentTitle) {
    const matchedDocuments = await db.select({ id: documents.id }).from(documents).where(like(documents.bookTitle, `%${sourceDocumentTitle}%`));
    const sourceUrls = matchedDocuments.map((row) => `document:${row.id}`);
    filters.push(sourceUrls.length ? inArray(examQuestions.sourceUrl, sourceUrls) : eq(examQuestions.id, -1));
  }
  if (chapter !== "all") filters.push(like(examQuestions.teacherNotes, `${chapter}%`));
  if (paper !== "all") {
    const paperPrefix = `accounting-word-bank:v3:${paper}.docx:`;
    const wordRows = await db.select({ id: examQuestions.id, sourceUrl: examQuestions.sourceUrl }).from(examQuestions).where(eq(examQuestions.examName, ACCOUNTING_WORD_BANK_SOURCE));
    const paperIds = wordRows.filter((row) => row.sourceUrl.startsWith(paperPrefix)).map((row) => row.id);
    filters.push(paperIds.length ? inArray(examQuestions.id, paperIds) : eq(examQuestions.id, -1));
  }
  if (examCategory !== "all") filters.push(eq(examQuestions.examCategory, examCategory));
  const where = filters.length ? and(...filters) : undefined;
  const facetFilters = [];
  if (status !== "all") facetFilters.push(eq(examQuestions.status, status));
  if (examType !== "all") facetFilters.push(eq(examQuestions.examType, examType));
  if (examCategory !== "all") facetFilters.push(eq(examQuestions.examCategory, examCategory));
  const facetWhere = facetFilters.length ? and(...facetFilters) : undefined;
  const [items, countRows, totals, typeTotals, years, subjects, sourceBooks, chapterRows, paperRows] = await Promise.all([
    db.select().from(examQuestions).where(where).orderBy(paper !== "all" ? asc(examQuestions.id) : desc(examQuestions.id)).limit(10).offset((page - 1) * 10),
    db.select({ count: sql<number>`count(*)` }).from(examQuestions).where(where),
    db.select({ status: examQuestions.status, count: sql<number>`count(*)` }).from(examQuestions).groupBy(examQuestions.status),
    db.select({ examType: examQuestions.examType, count: sql<number>`count(*)` }).from(examQuestions).where(facetWhere).groupBy(examQuestions.examType),
    db.selectDistinct({ year: examQuestions.year }).from(examQuestions).where(facetWhere).orderBy(asc(examQuestions.year)),
    db.selectDistinct({ subject: examQuestions.subject }).from(examQuestions).where(facetWhere).orderBy(asc(examQuestions.subject)),
    db.selectDistinct({ sourceBook: examQuestions.examName }).from(examQuestions).where(facetWhere).orderBy(asc(examQuestions.examName)),
    db.selectDistinct({ teacherNotes: examQuestions.teacherNotes }).from(examQuestions).where(facetWhere),
    db.selectDistinct({ teacherNotes: examQuestions.teacherNotes }).from(examQuestions).where(and(eq(examQuestions.examCategory,"accounting"),eq(examQuestions.examName,ACCOUNTING_WORD_BANK_SOURCE),like(examQuestions.sourceUrl,"accounting-word-bank:v3:%"))),
  ]);
  const chapters=[...new Set(chapterRows.map(row=>row.teacherNotes.split("｜")[0].trim()).filter(value=>/^第.+章/u.test(value)))].sort((a,b)=>a.localeCompare(b,"zh-Hant",{numeric:true}));
  const papers=[...new Set(paperRows.map(row=>row.teacherNotes.match(/^內部來源：(.+?)\.docx｜/u)?.[1]??"").filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant",{numeric:true}));
  const cleanedItems = items.map((item) => item.examCategory === "accounting" ? {
    ...item,
    stem: removeAccountingPageFurniture(item.stem) ?? "",
    optionsJson: (() => { try { const options = JSON.parse(item.optionsJson || "{}") as Record<string, string>; return JSON.stringify(Object.fromEntries(Object.entries(options).map(([key, value]) => [key, removeAccountingPageFurniture(value)]))); } catch { return item.optionsJson; } })(),
    explanation: removeAccountingPageFurniture(item.explanation) ?? "",
    teacherAnswer: removeAccountingPageFurniture(item.teacherAnswer) ?? "",
  } : item);
  return Response.json({ items: cleanedItems, total: Number(countRows[0]?.count ?? 0), page, totals: Object.fromEntries(totals.map((row) => [row.status, Number(row.count)])), examTypeTotals: Object.fromEntries(typeTotals.map((row) => [row.examType, Number(row.count)])), filters: { years: years.map((row) => row.year), subjects: subjects.map((row) => row.subject), sourceBooks:sourceBooks.map(row=>row.sourceBook), chapters, papers } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; ids?: number[] };
    if (body.action !== "fetch-teacher-answers") return Response.json({ error: "不支援的真題處理動作" }, { status: 400 });
    const ids = [...new Set((body.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) return Response.json({ error: "請先選擇要補抓擬答的二試題目" }, { status: 400 });
    const db = await getDb();
    const rows = await db.select().from(examQuestions).where(inArray(examQuestions.id, ids));
    const essayRows = rows.filter((row) => row.examType === "essay" && row.sourceUrl);
    const grouped = new Map<string, typeof essayRows>();
    for (const row of essayRows) grouped.set(row.sourceUrl, [...(grouped.get(row.sourceUrl) ?? []), row]);
    let updated = 0;
    const failures: string[] = [];
    for (const [sourceUrl, sourceRows] of grouped) {
      try {
        const answers = await extractTeacherAnswers(sourceUrl, sourceRows[0]?.year ?? "");
        for (const answer of answers) {
          const target = sourceRows.find((row) => normalizeQuestionNumber(row.questionNumber) === normalizeQuestionNumber(answer.question_number));
          if (!target || !answer.teacher_answer?.trim()) continue;
          await db.update(examQuestions).set({ teacherAnswer: answer.teacher_answer.trim(), teacherNotes: answer.teacher_notes?.trim() || "", rubricJson: JSON.stringify(answer.rubric ?? []), answerSource: "高點名師參考擬答", answerStatus: "source_matched" }).where(eq(examQuestions.id, target.id));
          updated += 1;
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "擬答抓取失敗");
      }
    }
    return Response.json({ updated, requested: essayRows.length, failures });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "老師擬答抓取失敗" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json() as {
    action?: "update";
    id?: number;
    ids?: number[];
    status?: string;
    publishAllDrafts?: boolean;
    year?: string;
    examName?: string;
    subject?: string;
    questionNumber?: string;
    stem?: string;
    teacherAnswer?: string;
    teacherNotes?: string;
    rubricJson?: string;
    examCategory?: string;
  };
  const db = await getDb();
  if (body.action === "update") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
    const [current] = await db.select().from(examQuestions).where(eq(examQuestions.id, id)).limit(1);
    if (!current) return Response.json({ error: "找不到要編輯的題目" }, { status: 404 });
    const teacherAnswer = typeof body.teacherAnswer === "string" ? body.teacherAnswer.trim() : current.teacherAnswer;
    const update = {
      year: typeof body.year === "string" && body.year.trim() ? body.year.trim() : current.year,
      examName: typeof body.examName === "string" && body.examName.trim() ? body.examName.trim() : current.examName,
      subject: typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : current.subject,
      questionNumber: typeof body.questionNumber === "string" && body.questionNumber.trim() ? body.questionNumber.trim() : current.questionNumber,
      stem: typeof body.stem === "string" && body.stem.trim() ? body.stem.trim() : current.stem,
      teacherAnswer,
      teacherNotes: typeof body.teacherNotes === "string" ? body.teacherNotes.trim() : current.teacherNotes,
      rubricJson: typeof body.rubricJson === "string" ? body.rubricJson : current.rubricJson,
      answerSource: teacherAnswer ? current.answerSource || "高點名師參考擬答" : "",
      answerStatus: teacherAnswer ? "source_matched" : "missing",
    };
    const [updated] = await db.update(examQuestions).set(update).where(eq(examQuestions.id, id)).returning();
    return Response.json({ question: updated });
  }
  if (body.publishAllDrafts) {
    const category = ["law", "accounting", "medtech"].includes(body.examCategory || "") ? body.examCategory! : "law";
    const rows = await db.update(examQuestions).set({ status: "published" }).where(and(eq(examQuestions.examCategory, category), sql`${examQuestions.status} = 'draft' AND (${examQuestions.examType} = 'mcq' OR ${examQuestions.teacherAnswer} <> '')`)).returning({ id: examQuestions.id });
    return Response.json({ updated: rows.length });
  }
  const ids = body.ids?.length ? body.ids : body.id ? [body.id] : [];
  if (!ids.length || !["draft", "published"].includes(body.status || "")) return Response.json({ error: "缺少題目或狀態" }, { status: 400 });
  if (body.status === "published") {
    const selected = await db.select({ id: examQuestions.id, examType: examQuestions.examType, teacherAnswer: examQuestions.teacherAnswer }).from(examQuestions).where(inArray(examQuestions.id, ids));
    const missing = selected.filter((row) => row.examType === "essay" && !row.teacherAnswer.trim()).length;
    if (missing) return Response.json({ error: `有 ${missing} 題二試申論尚未抓到老師擬答，不能先發布。` }, { status: 409 });
  }
  const rows = await db.update(examQuestions).set({ status: body.status! }).where(inArray(examQuestions.id, ids)).returning({ id: examQuestions.id });
  return Response.json({ updated: rows.length });
}
