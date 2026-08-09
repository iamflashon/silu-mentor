import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getOpenAIKey } from "../../../../lib/openai";
import { examQuestions, examSourceItems, examSources, usageLogs } from "../../../../db/schema";

const allowedHosts = new Set(["lawyer.get.com.tw", "fd.get.com.tw"]);

function assertAllowed(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error("目前只允許處理已核准的高點真題來源");
  return url;
}

function textOnly(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function discoverRows(html: string, pageUrl: URL, examType: string) {
  const found: Array<{ fileUrl: string; title: string; year: string; subject: string; examName: string }> = [];
  for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const link = row.match(/href=["']([^"']*Download\.ashx[^"']*)["']/i);
    if (!link) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => textOnly(match[1]));
    const examGroup = cells[1] ?? "";
    if (examType === "essay" && !/律師、司法官第二試/.test(examGroup)) continue;
    if (examType === "mcq" && /律師、司法官第二試/.test(examGroup)) continue;
    const fileUrl = new URL(link[1].replace(/&amp;/g, "&"), pageUrl).toString();
    const year = cells.find((cell) => /^\d{3}$/.test(cell)) ?? "";
    const subject = cells.find((cell) => /法|倫理|英文/.test(cell) && !/律師|司法官/.test(cell)) ?? "綜合法學";
    found.push({ fileUrl, title: subject, year, subject, examName: examGroup || "類科待辨識" });
  }
  return found;
}

async function discover(sourceUrl: string, examType: string) {
  const base = assertAllowed(sourceUrl);
  if (examType === "essay" && base.pathname.toLowerCase().endsWith("/exam/list.aspx")) {
    base.searchParams.set("sFilterType", "D");
    base.searchParams.set("sFilter", "律師、司法官第二試");
    base.searchParams.delete("iPageNo");
  }
  const pages: URL[] = [base];
  const first = await fetch(base, { headers: { "user-agent": "iBrain-SiluMentor/1.0" } });
  if (!first.ok) throw new Error(`來源頁讀取失敗（HTTP ${first.status}）`);
  const firstHtml = await first.text();
  const totalPages = Math.min(250, Math.max(1, Number(firstHtml.match(/共\s*(\d+)\s*頁/)?.[1] ?? 1)));
  for (let page = 2; page <= totalPages; page += 1) { const url = new URL(base); url.searchParams.set("iPageNo", String(page)); pages.push(url); }
  const rows = discoverRows(firstHtml, base, examType);
  for (const page of pages.slice(1)) { const response = await fetch(page, { headers: { "user-agent": "iBrain-SiluMentor/1.0" } }); if (response.ok) rows.push(...discoverRows(await response.text(), page, examType)); }
  return [...new Map(rows.map((row) => [row.fileUrl, row])).values()];
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "") : []).join("").trim();
}

async function extractPdf(item: typeof examSourceItems.$inferSelect, examType: string) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  const download = await fetch(assertAllowed(item.fileUrl), { redirect: "follow", headers: { "user-agent": "iBrain-SiluMentor/1.0" } });
  if (!download.ok) throw new Error(`PDF 下載失敗（HTTP ${download.status}）`);
  assertAllowed(download.url);
  const bytes = await download.arrayBuffer();
  if (bytes.byteLength < 1000 || bytes.byteLength > 55 * 1024 * 1024) throw new Error("PDF 大小不符合處理限制");
  const form = new FormData(); form.set("purpose", "user_data"); form.set("file", new File([bytes], `${item.year}-${item.id}.pdf`, { type: "application/pdf" }));
  const uploaded = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
  const uploadPayload = await uploaded.json() as { id?: string; error?: { message?: string } };
  if (!uploaded.ok || !uploadPayload.id) throw new Error(uploadPayload.error?.message ?? "PDF 無法送入拆題服務");
  try {
    const model = process.env.OPENAI_EXTRACTION_MODEL || "gpt-5.6-terra";
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({
      model,
      instructions: `你是台灣司律真題資料整理員。只擷取檔案中明確存在的${examType === "mcq" ? "選擇題" : "申論題"}，不可補寫或猜測。保留完整題幹。${examType === "mcq" ? "每題必須擷取 A、B、C、D 四個選項；options 使用 label 與 text 陣列；只有檔案明確列出答案時才填 correct_answer，否則為空字串；teacher_answer、teacher_notes 與 rubric 固定輸出空值。" : "申論題 options 固定為空陣列，correct_answer 固定為空字串。若 PDF 同時有『試題評析』、『考點命中』或『【擬答】／參考擬答』，必須把老師擬答完整擷取到 teacher_answer，把試題評析與考點命中擷取到 teacher_notes，並把可辨識的必寫重點整理成 rubric；沒有明確擬答時輸出空字串與空陣列，不得自行生成。"} subject 依題目所屬法科填寫；無法判斷時填綜合。question_number 使用檔案原題號。teacher_answer 的來源名稱固定寫『高點名師參考擬答』，不能寫成官方擬答。所有題目狀態由系統保存為 draft，等待人工確認。`,
      input: [{ role: "user", content: [{ type: "input_file", file_id: uploadPayload.id }, { type: "input_text", text: `擷取 ${item.year} 年「${item.title}」全部可辨識題目，輸出 JSON。` }] }],
      text: { format: { type: "json_schema", name: "exam_questions", strict: true, schema: { type: "object", additionalProperties: false, properties: { questions: { type: "array", items: { type: "object", additionalProperties: false, properties: { question_number: { type: "string" }, subject: { type: "string" }, stem: { type: "string" }, options: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, text: { type: "string" } }, required: ["label", "text"] } }, correct_answer: { type: "string" }, explanation: { type: "string" }, teacher_answer: { type: "string" }, teacher_notes: { type: "string" }, rubric: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterion: { type: "string" }, points: { type: "string" }, must_include: { type: "string" } }, required: ["criterion", "points", "must_include"] } } }, required: ["question_number", "subject", "stem", "options", "correct_answer", "explanation", "teacher_answer", "teacher_notes", "rubric"] } } }, required: ["questions"] } } },
      max_output_tokens: 24000,
    }) });
    const payload = await response.json() as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "AI 拆題失敗");
    const parsed = JSON.parse(extractResponseText(payload)) as { questions?: Array<{ question_number: string; subject: string; stem: string; options: Array<{ label: string; text: string }>; correct_answer: string; explanation: string; teacher_answer: string; teacher_notes: string; rubric: Array<{ criterion: string; points: string; must_include: string }> }> };
    const questions = (parsed.questions ?? []).filter((question) => question.stem?.trim()).slice(0, 120);
    const input = Number(payload.usage?.input_tokens ?? 0); const output = Number(payload.usage?.output_tokens ?? 0); const cached = Number(payload.usage?.input_tokens_details?.cached_tokens ?? 0);
    return { questions, usage: { model, input, output, cached, costMicros: Math.round(((Math.max(0, input - cached) * 1 + cached * .1 + output * 6) / 1_000_000) * 1_000_000) } };
  } finally {
    await fetch(`https://api.openai.com/v1/files/${uploadPayload.id}`, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const db = await getDb(); let sourceId = 0; let itemId = 0;
  try {
    const body = await request.json() as { sourceId?: number; rescan?: boolean }; sourceId = Number(body.sourceId);
    if (!Number.isInteger(sourceId) || sourceId < 1) return Response.json({ error: "來源編號不正確" }, { status: 400 });
    const [source] = await db.select().from(examSources).where(eq(examSources.id, sourceId)).limit(1);
    if (!source || source.sourceKind !== "exam") return Response.json({ error: "找不到可處理的真題來源" }, { status: 404 });
    await db.update(examSources).set({ status: "discovering", lastError: null, updatedAt: new Date() }).where(eq(examSources.id, sourceId));
    const existing = await db.select().from(examSourceItems).where(eq(examSourceItems.sourceId, sourceId)).limit(1);
    if (!existing.length || body.rescan) {
      const rows = await discover(source.url, source.examType);
      if (!rows.length) throw new Error("來源頁沒有找到可下載的 PDF");
      const discoveredUrls = rows.map((row) => row.fileUrl);
      const oldItems = await db.select().from(examSourceItems).where(eq(examSourceItems.sourceId, sourceId));
      for (const row of rows) {
        const old = oldItems.find((item) => item.fileUrl === row.fileUrl);
        if (old) await db.update(examSourceItems).set({ title: row.title, year: row.year, subject: row.subject, examName: row.examName }).where(eq(examSourceItems.id, old.id));
        else await db.insert(examSourceItems).values({ sourceId, ...row }).onConflictDoNothing();
        await db.update(examQuestions).set({ examName: row.examName }).where(eq(examQuestions.sourceUrl, row.fileUrl));
      }
      if (body.rescan) {
        const staleUrls = oldItems.filter((item) => !discoveredUrls.includes(item.fileUrl)).map((item) => item.fileUrl);
        if (staleUrls.length) await db.update(examQuestions).set({ examName: "類科待辨識" }).where(inArray(examQuestions.sourceUrl, staleUrls));
      }
    }
    const allItems = await db.select().from(examSourceItems).where(eq(examSourceItems.sourceId, sourceId)).orderBy(asc(examSourceItems.id));
    const next = allItems.find((item) => item.status === "waiting" || item.status === "failed");
    if (!next) { await db.update(examSources).set({ status: "review", discoveredCount: allItems.length, processedCount: allItems.length, updatedAt: new Date() }).where(eq(examSources.id, sourceId)); return Response.json({ sourceId, status: "review", message: "所有 PDF 已拆解完成，請進行人工確認" }); }
    itemId = next.id; await db.update(examSourceItems).set({ status: "extracting", error: null }).where(eq(examSourceItems.id, next.id)); await db.update(examSources).set({ status: "extracting", discoveredCount: allItems.length, updatedAt: new Date() }).where(eq(examSources.id, sourceId));
    const result = await extractPdf(next, source.examType);
    for (const question of result.questions) {
      const teacherAnswer = source.examType === "essay" ? question.teacher_answer?.trim() || "" : "";
      const year = next.year || "未標示";
      const examName = next.examName || "類科待辨識";
      const subject = question.subject || next.subject;
      const questionNumber = question.question_number || String(Date.now());
      const values = { examType: source.examType, year, examName, subject, questionNumber, stem: question.stem.trim(), optionsJson: source.examType === "mcq" ? JSON.stringify(Object.fromEntries((question.options ?? []).map((option) => [option.label.toUpperCase(), option.text]))) : null, correctAnswer: question.correct_answer?.trim() || null, explanation: question.explanation?.trim() || "", teacherAnswer, teacherNotes: source.examType === "essay" ? question.teacher_notes?.trim() || "" : "", rubricJson: source.examType === "essay" ? JSON.stringify(question.rubric ?? []) : "[]", answerSource: teacherAnswer ? "高點名師參考擬答" : "", answerStatus: teacherAnswer ? "source_matched" : "missing", sourceUrl: next.fileUrl };
      const [existingQuestion] = await db.select({ id: examQuestions.id }).from(examQuestions).where(and(eq(examQuestions.examType, source.examType), eq(examQuestions.examName, examName), eq(examQuestions.year, year), eq(examQuestions.subject, subject), eq(examQuestions.questionNumber, questionNumber), eq(examQuestions.sourceUrl, next.fileUrl))).limit(1);
      if (existingQuestion) await db.update(examQuestions).set(values).where(eq(examQuestions.id, existingQuestion.id));
      else await db.insert(examQuestions).values({ ...values, status: "draft" });
    }
    await db.insert(usageLogs).values({ model: result.usage.model, source: "真題拆解", inputTokens: result.usage.input, cachedTokens: result.usage.cached, outputTokens: result.usage.output, fileSearchCalls: 0, estimatedCostUsdMicros: result.usage.costMicros });
    await db.update(examSourceItems).set({ status: "review", questionCount: result.questions.length, processedAt: new Date() }).where(eq(examSourceItems.id, next.id));
    const [counts] = await db.select({ processed: sql<number>`sum(case when ${examSourceItems.status} = 'review' then 1 else 0 end)`, questions: sql<number>`sum(${examSourceItems.questionCount})` }).from(examSourceItems).where(eq(examSourceItems.sourceId, sourceId));
    const processed = Number(counts?.processed ?? 0); const questions = Number(counts?.questions ?? 0); const status = processed >= allItems.length ? "review" : "waiting";
    await db.update(examSources).set({ status, discoveredCount: allItems.length, processedCount: processed, questionCount: questions, lastError: null, updatedAt: new Date() }).where(eq(examSources.id, sourceId));
    return Response.json({ sourceId, status, processedCount: processed, discoveredCount: allItems.length, questionCount: questions, message: `已完成「${next.title}」：拆出 ${result.questions.length} 題` });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "真題處理失敗";
    if (itemId) await db.update(examSourceItems).set({ status: "failed", error: message }).where(eq(examSourceItems.id, itemId)).catch(() => undefined);
    if (sourceId) await db.update(examSources).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(examSources.id, sourceId)).catch(() => undefined);
    return Response.json({ error: message }, { status: 500 });
  }
}
