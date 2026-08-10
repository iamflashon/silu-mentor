import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, issuePracticeRecords, studyRecords, usageLogs } from "../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getOpenAIKey, openAIJson } from "../../../lib/openai";
import { taipeiDate } from "../../../lib/taipei-time";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
const OWNER_EMAIL = "iamflashon@gmail.com";
type SampleLevel = "basic" | "intermediate" | "advanced";
const sampleLabels: Record<SampleLevel, string> = { basic: "基礎擬答", intermediate: "中等擬答", advanced: "高分擬答" };
function sampleAnswer(answer: string, level: SampleLevel) {
  const source = answer.normalize("NFKC").replace(/\*\*/g, "").replace(/\r/g, "\n");
  const cleanSourceLine = (value: string) => {
    let cleaned = value.trim();
    // A source line can contain stacked prefixes, for example `（九）o3本文`.
    // Remove one prefix at a time until the real sentence begins.
    const prefix = /^(?:[-•]\s*|[oO]\s*\d{1,3}(?=[\p{Script=Han}A-Za-z《「『【（(])\s*|[oO0○]?\d+[.、．]\s*|[一二三四五六七八九十]+[、.．]\s*|[（(][一二三四五六七八九十\d]+[）)]\s*)/u;
    for (let index = 0; index < 6; index += 1) {
      const next = cleaned.replace(prefix, "").trimStart();
      if (next === cleaned) break;
      cleaned = next;
    }
    return cleaned
      .replace(/[？?]+\s*[？?]+/gu, "？")
      .replace(/\s+/gu, " ")
      .trim();
  };
  const isSourceHeading = (line: string) => {
    const normalized = line
      .replace(/^[【\[（(]\s*|\s*[】\]）)]$/gu, "")
      .replace(/[：:？?。．、\s]+$/gu, "")
      .trim();
    return /^(?:(?:高點)?名師)?(?:參考)?擬答$|^(?:老師|名師)?(?:參考)?(?:解析|解答)$|^(?:試題評析|考點命中|答題說明|資料來源|來源)$/u.test(normalized);
  };
  const chunks = source
    .split(/\n+|(?<=[。；])\s*/u)
    .map(cleanSourceLine)
    .filter((line) => line.length >= 8 && !isSourceHeading(line));
  const likely = chunks.filter((line) => /(?:是否|成立|爭點|罪|刑責|責任|競合|正犯|共犯|未遂|既遂|故意|過失|因果|歸責|中止|不能未遂)/u.test(line));
  const sourceIssues = likely.length >= 3 ? likely : chunks;
  const seen = new Set<string>();
  const issues = sourceIssues.flatMap((line) => {
    const actor = line.match(/^(?:就|關於)?([甲乙丙丁戊己庚辛壬癸])(?:之|的|就|對|將|於|因|以|、|，|\s)/u)?.[1] ?? "本題";
    const concise = line
      .replace(/^(?:就|關於)?[甲乙丙丁戊己庚辛壬癸](?:之|的)?(?:刑責|部分)?[：:，、\s]*/u, "")
      .replace(/^(?:爭點|問題)[：:，、\s]*/u, "")
      .split(/[。；]/u)[0]
      .replace(/，(?:惟|然|而|故|又|且|依|蓋).+$/u, "")
      .replace(/[？?。．、：:；;…\s]+$/gu, "")
      .trim();
    if (concise.length < 6) return [];
    // A cut-off proposition is not a usable issue. Keep the complete first
    // proposition and let the textarea wrap it naturally instead of adding an
    // ellipsis and pretending it is a question.
    const text = concise;
    const key = `${actor}:${text.replace(/[，。？?\s]/gu, "")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ actor, text: `${text}？` }];
  }).slice(0, 14);
  const ratio = level === "basic" ? .28 : level === "intermediate" ? .62 : 1;
  const count = Math.min(issues.length, level === "basic" ? Math.max(2, Math.ceil(issues.length * ratio)) : level === "intermediate" ? Math.max(4, Math.ceil(issues.length * ratio)) : issues.length);
  const selected = issues.slice(0, count);
  const groups = new Map<string, string[]>();
  for (const issue of selected) groups.set(issue.actor, [...(groups.get(issue.actor) ?? []), issue.text]);
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const subNumerals = ["（一）", "（二）", "（三）", "（四）", "（五）", "（六）", "（七）", "（八）", "（九）", "（十）", "（十一）", "（十二）", "（十三）", "（十四）"];
  return [...groups.entries()].map(([actor, rows], groupIndex) => {
    const heading = actor === "本題" ? `${numerals[groupIndex]}、本題主要爭點` : `${numerals[groupIndex]}、${actor}之刑責`;
    return `${heading}\n${rows.map((text, index) => `${subNumerals[index] ?? `${index + 1}.`} ${text}`).join("\n")}`;
  }).join("\n\n");
}
function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function parseResult(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

type Workflow = { solReview?: unknown; challenger?: "terra" | "sonnet"; challenge?: unknown; lunaReply?: unknown; solReply?: unknown };
function workflow(value: string | null): Workflow { const parsed = parseResult(value); return parsed && typeof parsed === "object" ? parsed as Workflow : {}; }
function anthropicText(payload: unknown) { const content = payload && typeof payload === "object" ? (payload as { content?: unknown[] }).content : []; return Array.isArray(content) ? content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join("").trim() : ""; }

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const requestedQuestionId = Number(new URL(request.url).searchParams.get("questionId") || 0);
    if (Number.isInteger(requestedQuestionId) && requestedQuestionId > 0) {
      const [record] = await db.select().from(issuePracticeRecords).where(and(eq(issuePracticeRecords.userKey, userKey(request)), eq(issuePracticeRecords.questionId, requestedQuestionId))).limit(1);
      return Response.json({ record: record ? { ...record, lunaResult: parseResult(record.lunaResultJson), solResult: parseResult(record.solResultJson), challengeWorkflow: workflow(record.challengeWorkflowJson), lunaResultJson: undefined, solResultJson: undefined, challengeWorkflowJson: undefined } : null });
    }
    const rows = await db.select({ id: examQuestions.id, year: examQuestions.year, examName: examQuestions.examName, subject: examQuestions.subject, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem, answerSource: examQuestions.answerSource }).from(examQuestions).where(and(eq(examQuestions.status, "published"), eq(examQuestions.examType, "essay"), sql`length(trim(${examQuestions.teacherAnswer})) > 0`)).orderBy(sql`${examQuestions.year} desc`, examQuestions.subject, examQuestions.questionNumber).limit(500);
    const history = await db.select({ questionId: issuePracticeRecords.questionId, updatedAt: issuePracticeRecords.updatedAt }).from(issuePracticeRecords).where(eq(issuePracticeRecords.userKey, userKey(request))).orderBy(desc(issuePracticeRecords.updatedAt)).limit(500);
    return Response.json({ questions: rows, history });
  } catch { return Response.json({ error: "練爭點題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "sample" | "save-supplement" | "sol-review-luna" | "challenge" | "reply"; questionId?: number; studentIssues?: string; studentSupplement?: string; model?: "luna" | "sol"; challenger?: "terra" | "sonnet"; challengeText?: string; sampleLevel?: SampleLevel };
    const questionId = Number(body.questionId); const studentIssues = String(body.studentIssues ?? "").trim(); const requestedModel = body.model === "sol" ? "sol" : "luna";
    if (!Number.isInteger(questionId)) return Response.json({ error: "請先選擇題目" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"), eq(examQuestions.examType, "essay"))).limit(1);
    if (!question) return Response.json({ error: "找不到這一題" }, { status: 404 });
    if (!question.teacherAnswer.trim()) return Response.json({ error: "本題尚未完成老師擬答核對，暫不開放 AI 比對" }, { status: 409 });
    const [existing] = await db.select().from(issuePracticeRecords).where(and(eq(issuePracticeRecords.userKey, userKey(request)), eq(issuePracticeRecords.questionId, questionId))).limit(1);
    const currentWorkflow = workflow(existing?.challengeWorkflowJson ?? null);
    if (body.action === "save-supplement") {
      const supplement = String(body.studentSupplement ?? "").trim().slice(0, 12000);
      await db.insert(issuePracticeRecords).values({ userKey: userKey(request), questionId, studentIssues: studentIssues.slice(0, 12000), studentSupplement: supplement, sampleLevel: body.sampleLevel ?? null, updatedAt: new Date() }).onConflictDoUpdate({ target: [issuePracticeRecords.userKey, issuePracticeRecords.questionId], set: { studentIssues: studentIssues.slice(0, 12000), studentSupplement: supplement, sampleLevel: body.sampleLevel ?? null, updatedAt: new Date() } });
      return Response.json({ ok: true, savedAt: new Date().toISOString() });
    }
    if (body.action === "sample") {
      if (request.headers.get("oai-authenticated-user-email") !== OWNER_EMAIL) return Response.json({ error: "三種擬答是管理者測試工具" }, { status: 403 });
      const level: SampleLevel = body.sampleLevel === "advanced" ? "advanced" : body.sampleLevel === "intermediate" ? "intermediate" : "basic";
      return Response.json({ text: sampleAnswer(question.teacherAnswer, level), level, label: sampleLabels[level] });
    }
    if (["sol-review-luna", "challenge", "reply"].includes(body.action ?? "")) {
      const luna = parseResult(existing?.lunaResultJson ?? null) as ResultShape | null;
      const sol = parseResult(existing?.solResultJson ?? null) as ResultShape | null;
      if (!luna?.analysis || !sol?.analysis) return Response.json({ error: "請先完成 Luna 與 Sol 對同學答案的兩份評論。" }, { status: 400 });
      const base = `你處理的是臺灣司律考試題。必須先完整閱讀老師解析／擬答，並以其作為本次主要校準依據。不得補造事實；老師未採學說只能列為補充，不得用來改判老師結論。只輸出繁體中文純文字。\n\n【題目】\n${question.stem}\n\n【老師解析／擬答】\n${question.teacherAnswer.slice(0, 16000)}\n\n【學生答案】\n${studentIssues}`;
      const started = Date.now(); let model = "gpt-5.6-sol"; let text = ""; let inputTokens = 0; let outputTokens = 0; let cachedTokens = 0; let source = "";
      if (body.action === "sol-review-luna") {
        const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: "你是 Sol 學霸。你的任務不是再次評論學生，而是獨立覆核 Luna 的評論。依序輸出：一、Luna 應保留；二、Luna 應修正；三、Luna 應補充；四、依老師順序給 Luna 的修正版。每點都要對應老師解析。", input: `${base}\n\n【Luna 對學生的評論】\n${luna.analysis}`, max_output_tokens: 2400 }) }) as Record<string, unknown>;
        text = outputText(payload); ({ inputTokens, outputTokens, cachedTokens } = tokenUsage(payload)); source = "練爭點／Sol覆核Luna";
      } else if (body.action === "challenge") {
        const challenger = body.challenger === "sonnet" ? "sonnet" : "terra"; const prompt = `${base}\n\n【Luna 回答】\n${luna.analysis}\n\n【Sol 回答】\n${sol.analysis}`;
        const instruction = `你是${challenger === "terra" ? "Terra 擬答守門員" : "Sonnet 教學式質疑者"}。只檢查 Luna 與 Sol 相對老師擬答的實質偏差。每項成立質疑須列：被質疑模型、問題位置、老師擬答依據、具體差異、學生可採用的追問句。若都符合，明示「目前沒有成立的質疑」，不得硬挑毛病。`;
        if (challenger === "sonnet") { const key = await getAnthropicKey(); if (!key) return Response.json({ error: "Claude Sonnet API 尚未設定" }, { status: 503 }); model = await getAnthropicChatModel("claude-sonnet-5"); const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, system: instruction, messages: [{ role: "user", content: prompt }], max_tokens: 2400 }) }); const payload = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error("Claude Sonnet 暫時無法完成質疑"); text = anthropicText(payload); const u = payload.usage as Record<string, unknown> | undefined; inputTokens = Number(u?.input_tokens ?? 0); outputTokens = Number(u?.output_tokens ?? 0); }
        else { model = "gpt-5.6-terra"; const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: instruction, input: prompt, max_output_tokens: 2400 }) }) as Record<string, unknown>; text = outputText(payload); ({ inputTokens, outputTokens, cachedTokens } = tokenUsage(payload)); }
        source = `練爭點／${challenger === "sonnet" ? "Sonnet" : "Terra"}質疑者`; currentWorkflow.challenger = challenger;
      } else {
        const provider = body.model === "sol" ? "sol" : "luna"; const challengeText = String(body.challengeText ?? "").trim(); if (challengeText.length < 10) return Response.json({ error: "請先保留或修改一段具體質疑。" }, { status: 400 }); model = provider === "sol" ? "gpt-5.6-sol" : "gpt-5.6-luna"; const original = provider === "sol" ? sol.analysis : luna.analysis; const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: `你是${provider === "sol" ? "Sol 學霸" : "Luna 助教"}。重新讀取老師擬答後回應質疑：先說接受與否及理由，再列原回答應保留、修正、補充之處，最後提出完整修正版。不得為維護原答而強辯。`, input: `${base}\n\n【原回答】\n${original}\n\n【學生採用或修改後的質疑】\n${challengeText}`, max_output_tokens: 2400 }) }) as Record<string, unknown>; text = outputText(payload); ({ inputTokens, outputTokens, cachedTokens } = tokenUsage(payload)); source = `練爭點／${provider === "sol" ? "Sol" : "Luna"}回應質疑`;
      }
      if (!text) return Response.json({ error: "模型沒有產生可顯示的內容" }, { status: 502 });
      const estimatedCostUsd = estimateSimple(model, inputTokens, outputTokens, cachedTokens); const saved = { analysis: text, model, usage: { inputTokens, outputTokens, cachedTokens, estimatedCostUsd, durationMs: Date.now() - started } };
      if (body.action === "sol-review-luna") currentWorkflow.solReview = saved; else if (body.action === "challenge") currentWorkflow.challenge = saved; else if (body.model === "sol") currentWorkflow.solReply = saved; else currentWorkflow.lunaReply = saved;
      await db.insert(usageLogs).values({ source, model, inputTokens, outputTokens, cachedTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
      await db.insert(issuePracticeRecords).values({ userKey: userKey(request), questionId, studentIssues: studentIssues.slice(0, 12000), challengeWorkflowJson: JSON.stringify(currentWorkflow), updatedAt: new Date() }).onConflictDoUpdate({ target: [issuePracticeRecords.userKey, issuePracticeRecords.questionId], set: { studentIssues: studentIssues.slice(0, 12000), challengeWorkflowJson: JSON.stringify(currentWorkflow), updatedAt: new Date() } });
      return Response.json({ result: saved, workflow: currentWorkflow });
    }
    if (studentIssues.length < 10) return Response.json({ error: "請先寫下你辨識的爭點再送出" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "AI 模型尚未設定" }, { status: 503 });
    const model = requestedModel === "sol" ? "gpt-5.6-sol" : "gpt-5.6-luna";
    const instructions = `你是臺灣司法官、律師二試的爭點學習助教。比較學生寫的爭點與同一題老師擬答。原始題目是最高依據，老師擬答是主要校準資料，但不得稱為官方唯一答案。不得自行補充題目沒有的事實，不得因用語不同就判定學生錯誤。任務不是寫完整申論，而是診斷爭點辨識。\n第一、二行必須固定輸出「爭點辨識完成度：XX分」及「程度判定：基礎／中等／高分」，不得把分數或程度再寫入正文。接著固定依下列標題輸出：\n一、整體表現（2至3句，不重複分數與程度）\n二、已命中的爭點（指出對應題示事實）\n三、遺漏的爭點（依配分重要性排序；沒有則明示）\n四、錯抓或過度延伸（說明欠缺的題示基礎；沒有則明示）\n五、表達可再精準之處（只修正名稱、法條定位或問句）\n六、建議的最終爭點架構（依行為人與行為順序列精簡清單）\n程度判定標準：基礎＝僅抓到少數核心爭點或有重大遺漏；中等＝主要爭點大致命中但仍有重要缺漏；高分＝重要爭點完整、層次與用語精準。必須區分「未寫到」與「寫錯」，並容許合理不同見解。控制在1400字內。`;
    const safeInstructions = `${instructions}\n再次確認：只可輸出純文字與自然換行，不得輸出 Markdown 星號、井號、底線、反引號、表格或程式碼區塊。`;
    const input = `【題目】\n${question.stem}\n\n【學生寫下的爭點】\n${studentIssues}\n\n【同題老師擬答／解析】\n${question.teacherAnswer.slice(0, 15000)}`;
    const started = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: safeInstructions, input, max_output_tokens: requestedModel === "sol" ? 2400 : 2000 }) }) as Record<string, unknown>;
    const text = outputText(payload); if (!text) return Response.json({ error: "AI 沒有產生可顯示的分析，請稍後再試" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens ?? 0); const outputTokens = Number(usage.output_tokens ?? 0); const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const inputRate = requestedModel === "sol" ? .525 : .105; const outputRate = requestedModel === "sol" ? 3.15 : .63;
    const estimatedCostUsd = Math.max(0, inputTokens - cachedTokens) / 1e6 * inputRate + cachedTokens / 1e6 * inputRate * .1 + outputTokens / 1e6 * outputRate;
    const sampleSuffix = body.sampleLevel ? `／${sampleLabels[body.sampleLevel]}` : "";
    await db.insert(usageLogs).values({ source: `${requestedModel === "sol" ? "練爭點／Sol學霸覆核" : "練爭點／Luna助教比對"}${sampleSuffix}`, model: String(payload.model || model), inputTokens, outputTokens, cachedTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: taipeiDate(), subject: question.subject, title: `${question.year} ${question.examName || "司律二試"}第 ${question.questionNumber} 題｜練爭點`, activityType: "練爭點", reflection: studentIssues.slice(0, 3000), weakness: "依 AI 比對結果回補遺漏爭點", nextStep: "依建議架構重寫一次爭點清單" });
    const savedResult = { analysis: text, model: requestedModel === "sol" ? "Sol 學霸" : "Luna 助教", modelId: String(payload.model || model), reason: requestedModel === "sol" ? "學生主動要求強模型覆核 Luna 的判斷" : "本題已精準命中老師擬答，使用低成本模型進行受資料約束的比對", sampleLevel: body.sampleLevel ?? null, sampleLabel: body.sampleLevel ? sampleLabels[body.sampleLevel] : null, usage: { inputTokens, outputTokens, cachedTokens, estimatedCostUsd, durationMs: Date.now() - started }, answerSource: question.answerSource || "老師參考擬答" };
    const resultField = requestedModel === "sol" ? { solResultJson: JSON.stringify(savedResult) } : { lunaResultJson: JSON.stringify(savedResult) };
    await db.insert(issuePracticeRecords).values({ userKey: userKey(request), questionId, studentIssues: studentIssues.slice(0, 12000), sampleLevel: body.sampleLevel ?? null, ...resultField, updatedAt: new Date() }).onConflictDoUpdate({ target: [issuePracticeRecords.userKey, issuePracticeRecords.questionId], set: { studentIssues: studentIssues.slice(0, 12000), sampleLevel: body.sampleLevel ?? null, ...resultField, updatedAt: new Date() } });
    return Response.json(savedResult);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI 比對暫時無法完成" }, { status: 500 }); }
}

type ResultShape = { analysis?: string };
function tokenUsage(payload: Record<string, unknown>) { const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; return { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), cachedTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0) }; }
function estimateSimple(model: string, input: number, output: number, cached: number) { const rates = /sol/i.test(model) ? [.525, 3.15] : /terra/i.test(model) ? [.206, 1.24] : /sonnet|claude/i.test(model) ? [.356, 1.78] : [.105, .63]; return Math.max(0, input - cached) / 1e6 * rates[0] + cached / 1e6 * rates[0] * .1 + output / 1e6 * rates[1]; }
