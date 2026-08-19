import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, issuePracticeRecords, studyRecords, usageLogs } from "../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getOpenAIKey, openAIJson } from "../../../lib/openai";
import { taipeiDate } from "../../../lib/taipei-time";
import { supportsIssuePractice } from "../../../lib/issue-practice-subjects";
import { inputFingerprint, relevantSections } from "../../../lib/input-budget";

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
  const rawLines = source.split(/\n+/u).map((line) => line.trim()).filter(Boolean);
  const actorHeading = /^(?:[一二三四五六七八九十百]+[、.．]\s*)?([甲乙丙丁戊己庚辛壬癸])(?:之|的)?刑責/u;
  let currentActor = "本題";
  const chunks: Array<{ actor: string; line: string }> = [];
  for (const rawLine of rawLines) {
    const headingMatch = cleanSourceLine(rawLine).match(actorHeading);
    if (headingMatch) {
      currentActor = headingMatch[1];
      continue;
    }
    for (const sentence of rawLine.split(/(?<=[。；])\s*/u)) {
      const line = cleanSourceLine(sentence);
      if (line.length >= 8 && !isSourceHeading(line)) chunks.push({ actor: currentActor, line });
    }
  }
  const likely = chunks.filter(({ line }) => /(?:是否|成立|爭點|罪|刑責|責任|競合|正犯|共犯|未遂|既遂|故意|過失|因果|歸責|中止|不能未遂)/u.test(line));
  const sourceIssues = likely.length >= 3 ? likely : chunks;
  const seen = new Set<string>();
  const issues = sourceIssues.flatMap(({ actor: sectionActor, line }) => {
    const explicitActor = line.match(/^(?:就|關於)?([甲乙丙丁戊己庚辛壬癸])(?:之|的|就|對|將|於|因|以|、|，|\s)/u)?.[1];
    const actor = explicitActor ?? sectionActor;
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
  });
  const ratio = level === "basic" ? .28 : level === "intermediate" ? .62 : 1;
  // The advanced sample is a completeness test. Never silently cut it at an
  // arbitrary number of rows; otherwise Luna is being tested against a sample
  // that is labelled high-scoring while omitting the teacher answer's tail.
  const count = level === "basic"
    ? Math.min(issues.length, Math.max(2, Math.ceil(issues.length * ratio)))
    : level === "intermediate"
      ? Math.min(issues.length, Math.max(4, Math.ceil(issues.length * ratio)))
      : issues.length;
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

const deductionRanges = {
  "核心完全遺漏": [8, 12],
  "必要獨立爭點遺漏": [8, 12],
  "結論有寫正文未論證": [3, 5],
  "關鍵事實未涵攝": [5, 10],
  "備位論證遺漏": [4, 8],
  "罪數競合遺漏": [3, 5],
  "責任例外規定遺漏": [3, 5],
  "行為人筆誤": [1, 2],
  "行為人主體錯置": [6, 12],
  "法條罪名不精確": [1, 2],
  "老師未處理補充爭議": [0, 0],
} as const;

function applyFixedIssueScore(raw: string) {
  let deductions = 0;
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const tagPattern = /【扣分:(核心完全遺漏|必要獨立爭點遺漏|結論有寫正文未論證|關鍵事實未涵攝|備位論證遺漏|罪數競合遺漏|責任例外規定遺漏|行為人筆誤|行為人主體錯置|法條罪名不精確|老師未處理補充爭議):(\d{1,2})】/gu;
  for (const match of raw.matchAll(tagPattern)) {
    const key = `${match.index}:${match[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [minimum, maximum] = deductionRanges[match[1] as keyof typeof deductionRanges];
    deductions += Math.min(maximum, Math.max(minimum, Number(match[2])));
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const fullScorePassed = /【滿分檢核:通過】/u.test(raw);
  // 100 分不是「沒有輸出扣分標籤」的預設值。模型必須逐項完成
  // 題目事實、規範、主要／備位論證及全部問句的滿分檢核。
  let ceiling = fullScorePassed ? 100 : 89;
  const coreMisses = (counts.get("核心完全遺漏") ?? 0) + (counts.get("必要獨立爭點遺漏") ?? 0);
  const unsupportedConclusions = counts.get("結論有寫正文未論證") ?? 0;
  const substantiveGaps = (counts.get("關鍵事實未涵攝") ?? 0) + (counts.get("備位論證遺漏") ?? 0) + (counts.get("責任例外規定遺漏") ?? 0);
  const subjectConfusion = counts.get("行為人主體錯置") ?? 0;
  if (coreMisses > 0 || subjectConfusion > 0 || unsupportedConclusions >= 2) ceiling = Math.min(ceiling, 74);
  else if (substantiveGaps > 0 || unsupportedConclusions === 1) ceiling = Math.min(ceiling, 79);
  const score = Math.max(0, Math.min(ceiling, 100 - deductions));
  const level = score >= 80 ? "高分" : score >= 60 ? "中等" : "基礎";
  const body = raw
    .replace(tagPattern, "")
    .replace(/【滿分檢核:(?:通過|未通過)】/gu, "")
    .replace(/(?:爭點辨識)?完成度\s*(?:[：:]|約為?|達)?\s*\d{1,3}\s*分\s*/gu, "")
    .replace(/程度判定\s*[：:]\s*(?:基礎|中等|高分)\s*/gu, "")
    .replace(/^\s+|\s+$/gu, "")
    .replace(/\n{3,}/gu, "\n\n");
  return `爭點辨識完成度：${score}分\n程度判定：${level}\n${body}`;
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
    return Response.json({ questions: rows.filter((question) => supportsIssuePractice(question.subject)), history });
  } catch { return Response.json({ error: "練爭點題庫暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "sample" | "save-supplement" | "sol-review-luna" | "challenge" | "reply"; questionId?: number; studentIssues?: string; studentSupplement?: string; model?: "luna" | "sol"; challenger?: "terra" | "sonnet"; challengeText?: string; sampleLevel?: SampleLevel };
    const questionId = Number(body.questionId); const studentIssues = String(body.studentIssues ?? "").trim(); const requestedModel = "luna" as const;
    if (!Number.isInteger(questionId)) return Response.json({ error: "請先選擇題目" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"), eq(examQuestions.examType, "essay"))).limit(1);
    if (!question) return Response.json({ error: "找不到這一題" }, { status: 404 });
    if (!supportsIssuePractice(question.subject)) return Response.json({ error: "這個科目不開放找爭點練習" }, { status: 409 });
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
      if (level === "advanced" && await getOpenAIKey()) {
        const model = "gpt-5.6-sol";
        const started = Date.now();
        const payload = await openAIJson("/responses", {
          method: "POST",
          body: JSON.stringify({
            model,
            instructions: `你是臺灣司法官、律師二試的高分考生。請產生一份「爭點清單」，用來測試另一個模型能否正確判級。必須先只依原始題目獨立完整解題，再用老師擬答校準採說；老師擬答不是爭點上限。依每位行為人分組，逐項使用「具體行為＋罪名／法律問題＋必要判斷方向」表達。必須涵蓋題示事實直接觸發的獨立罪名、加重事由、未遂／既遂、正犯／共犯、主觀故意範圍、違法性、責任及罪數競合。老師未寫但原題明確觸發的必要爭點仍須列入；邊緣爭議或事實不足者只能以條件式簡短列示。不得補造事實，不得寫成完整擬答，不得加入自我評語。只輸出可直接貼入文字框的繁體中文爭點清單，第一層固定依「一、甲之刑責」「二、乙之刑責」排列。`,
            input: `【原始題目】\n${question.stem}\n\n【老師解析／擬答】\n${question.teacherAnswer.slice(0, 16000)}`,
            max_output_tokens: 1800,
          }),
        }) as Record<string, unknown>;
        const text = outputText(payload);
        if (text) {
          const { inputTokens, outputTokens, cachedTokens } = tokenUsage(payload);
          const estimatedCostUsd = estimateSimple(model, inputTokens, outputTokens, cachedTokens);
          await db.insert(usageLogs).values({ source: "練爭點／高分測試樣本", model, inputTokens, outputTokens, cachedTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
          return Response.json({ text, level, label: sampleLabels[level], generator: { model, inputTokens, outputTokens, cachedTokens, estimatedCostUsd, durationMs: Date.now() - started } });
        }
      }
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
    const fingerprint = inputFingerprint(question.stem, question.teacherAnswer, studentIssues, requestedModel);
    const priorResult = parseResult(requestedModel === "sol" ? existing?.solResultJson ?? null : existing?.lunaResultJson ?? null) as (ResultShape & { inputFingerprint?: string }) | null;
    if (priorResult?.analysis && priorResult.inputFingerprint === fingerprint) {
      return Response.json({ ...priorResult, reused: true, reason: "沿用這位同學先前對同一題、同一爭點內容的結果，本次未重新呼叫模型", usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedCostUsd: 0, durationMs: 0 } });
    }
    if (!await getOpenAIKey()) return Response.json({ error: "AI 模型尚未設定" }, { status: 503 });
    const model = requestedModel === "sol" ? "gpt-5.6-sol" : "gpt-5.6-luna";
    const lunaPrior = requestedModel === "sol" ? parseResult(existing?.lunaResultJson ?? null) as ResultShape | null : null;
    const instructions = `你是臺灣司法官、律師二試的爭點診斷員。原始題目是最高依據；老師擬答用來校準採說、標準順序與預期結論，但不是爭點上限。不得補造事實，不得因用語不同判錯。你的工作只有分類命中、遺漏與錯誤，不得自行給總分。\n\n評分必須依序完成四階段：\n第一，獨立完整解題。暫時不看學生答案與老師擬答，只依原始題目建立人物、行為、時間、順序、知悉時點、程序階段、結果、因果流程及例外事實清單；逐一檢查構成要件、未遂／既遂、違法性、責任、其他獨立罪名及罪數競合。行駛中交通工具的駕駛遭攻擊，必須檢查公共危險罪；飲酒或精神狀態，必須完整檢查責任能力及自行招致規定；已有實害結果，必須檢查結果犯及其與主要罪名的競合。\n第二，老師校準。對照老師擬答，保留老師採說、順序與標準結論，並辨識老師未列但第一階段已發現的項目。\n第三，必要性判斷。只有題示事實直接觸發、屬完整回答題問不可缺少，且能以現行法具體論證者，才列為必要獨立爭點。僅屬不同學說、邊緣延伸、事實不足或老師未採的補充爭議，不得扣分。老師沒寫到不等於當然不得扣分，但不得憑想像擴張罪名。\n第四，學生比對。逐項檢查學生是否處理事實、規範、主要／備位論證、各問結論、實害結果及罪數競合，不得只比對罪名或最終結論。\n\n每個實際扣分項目，必須在該項說明句末加一個機器標籤，且只能使用：\n【扣分:核心完全遺漏:8至12間整數】\n【扣分:必要獨立爭點遺漏:8至12間整數】\n【扣分:結論有寫正文未論證:3至5間整數】\n【扣分:關鍵事實未涵攝:5至10間整數】\n【扣分:備位論證遺漏:4至8間整數】\n【扣分:罪數競合遺漏:3至5間整數】\n【扣分:責任例外規定遺漏:3至5間整數】\n【扣分:行為人筆誤:1至2間整數】\n【扣分:法條罪名不精確:1至2間整數】\n單純補充爭議標記【扣分:老師未處理補充爭議:0】，不得加分或扣分。不得創造其他扣分類型；相同缺失只用最能描述實質問題的一類，不得重複扣分。\n\n只有以下條件全部成立，文末才可輸出【滿分檢核:通過】：獨立完整解題與老師擬答已交叉檢查；每個有法律意義的關鍵事實均已涵攝；必要獨立罪名、責任例外及罪數競合均已處理；全部問句均有明確結論；老師擬答的主要與備位論證均已處理；無法律錯誤、主體錯置或重要遺漏；表達已達可直接交卷程度。任一條件未達即輸出【滿分檢核:未通過】。\n\n固定標題：一、整體表現；二、已命中的爭點；三、遺漏的爭點；四、錯抓或過度延伸；五、表達可再精準之處；六、建議的最終爭點架構。控制在1400字內。你是 Luna，負責辨識並分類各項命中、遺漏與錯誤。`;
    const scoringCalibration = `補充校準規則：\n一、本功能評的是爭點清單，不要求展開成完整考場申論；但每一爭點至少須具體指出行為、法律問題或罪名及必要判斷方向。只有罪名、問號或「成立／不成立」而沒有理由者，標記【扣分:結論有寫正文未論證:3至5間整數】，不得因未寫完整三段論而額外扣分。\n二、另可使用【扣分:行為人主體錯置:6至12間整數】。「行為人筆誤」只限單一姓名或法條項次的偶發誤植；把其他行為人的整段罪責或總結放在錯誤行為人名下，必須標記「行為人主體錯置」。\n三、不得自行增加法條沒有規定、老師擬答也未採用的構成要件。例如刑法第318條之1不得另要求特定身分或一般性的保密義務。若認為學生欠缺某要件，必須先以現行條文及本次老師擬答確認；無法確認者只能列為不扣分的補充爭議。\n四、滿分檢核中的「可直接交卷」在本功能是指可直接轉寫為申論架構，不是要求學生已寫成完整申論。`;
    const safeInstructions = `${instructions}\n\n${scoringCalibration}\n\n再次確認：只可輸出純文字與自然換行，不得輸出 Markdown 星號、井號、底線、反引號、表格或程式碼區塊。`;
    const focusedTeacherAnswer = relevantSections(question.teacherAnswer, `${question.stem}\n${studentIssues}`, 9000);
    const input = `【題目｜第一階段必須先獨立解題】\n${question.stem}\n\n【學生寫下的爭點｜完成獨立解題後才可比對】\n${studentIssues}\n\n【同題老師擬答／解析｜已依本題爭點選取相關段落，用於校準】\n${focusedTeacherAnswer}`;
    const started = Date.now();
    let payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions: safeInstructions, input, max_output_tokens: requestedModel === "sol" ? 6000 : 5000 }) }) as Record<string, unknown>;
    let rawText = outputText(payload);
    // Long 100-point questions can exhaust the model's reasoning allowance
    // before it emits a final answer. Retry once with an explicitly concise
    // final-output instruction instead of returning an opaque 502 to the user.
    if (!rawText) {
      payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model,
        instructions: `${safeInstructions}\n這是精簡重試：立即輸出最終評語，不得停留在內部分析；每個固定標題保留必要結論即可，全文不得超過1200字。`,
        input,
        max_output_tokens: requestedModel === "sol" ? 7000 : 6000,
      }) }) as Record<string, unknown>;
      rawText = outputText(payload);
    }
    if (!rawText) return Response.json({ error: "這題內容較長，Luna 本次未完成最終評語；請按一次重新比對" }, { status: 502 });
    const text = requestedModel === "sol" ? rawText : applyFixedIssueScore(rawText);
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens ?? 0); const outputTokens = Number(usage.output_tokens ?? 0); const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
    const inputRate = requestedModel === "sol" ? .525 : .105; const outputRate = requestedModel === "sol" ? 3.15 : .63;
    const estimatedCostUsd = Math.max(0, inputTokens - cachedTokens) / 1e6 * inputRate + cachedTokens / 1e6 * inputRate * .1 + outputTokens / 1e6 * outputRate;
    const sampleSuffix = body.sampleLevel ? `／${sampleLabels[body.sampleLevel]}` : "";
    await db.insert(usageLogs).values({ source: `${requestedModel === "sol" ? "練爭點／Sol學霸覆核" : "練爭點／Luna助教比對"}${sampleSuffix}`, model: String(payload.model || model), inputTokens, outputTokens, cachedTokens, fileSearchCalls: 0, estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1e6) });
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: taipeiDate(), subject: question.subject, title: `${question.year} ${question.examName || "司律二試"}第 ${question.questionNumber} 題｜練爭點`, activityType: "練爭點", reflection: studentIssues.slice(0, 3000), weakness: "依 AI 比對結果回補遺漏爭點", nextStep: "依建議架構重寫一次爭點清單" });
    const savedResult = { analysis: text, model: requestedModel === "sol" ? "Sol 學霸" : "Luna 助教", modelId: String(payload.model || model), reason: requestedModel === "sol" ? "Sol 只覆核 Luna 的項目分類；總分由固定扣分規則計算" : "Luna 負責辨識命中、遺漏與錯誤；總分由固定扣分規則計算", inputFingerprint: fingerprint, reused: false, sampleLevel: body.sampleLevel ?? null, sampleLabel: body.sampleLevel ? sampleLabels[body.sampleLevel] : null, usage: { inputTokens, outputTokens, cachedTokens, estimatedCostUsd, durationMs: Date.now() - started }, answerSource: question.answerSource || "老師參考擬答" };
    const resultField = requestedModel === "sol" ? { solResultJson: JSON.stringify(savedResult) } : { lunaResultJson: JSON.stringify(savedResult) };
    await db.insert(issuePracticeRecords).values({ userKey: userKey(request), questionId, studentIssues: studentIssues.slice(0, 12000), sampleLevel: body.sampleLevel ?? null, ...resultField, updatedAt: new Date() }).onConflictDoUpdate({ target: [issuePracticeRecords.userKey, issuePracticeRecords.questionId], set: { studentIssues: studentIssues.slice(0, 12000), sampleLevel: body.sampleLevel ?? null, ...resultField, updatedAt: new Date() } });
    return Response.json(savedResult);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI 比對暫時無法完成" }, { status: 500 }); }
}

type ResultShape = { analysis?: string };
function tokenUsage(payload: Record<string, unknown>) { const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }; return { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), cachedTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0) }; }
function estimateSimple(model: string, input: number, output: number, cached: number) { const rates = /sol/i.test(model) ? [.525, 3.15] : /terra/i.test(model) ? [.206, 1.24] : /sonnet|claude/i.test(model) ? [.356, 1.78] : [.105, .63]; return Math.max(0, input - cached) / 1e6 * rates[0] + cached / 1e6 * rates[0] * .1 + output / 1e6 * rates[1]; }
