import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, listeningSolutions, usageLogs } from "../../../db/schema";
import { openAIJson } from "../../../lib/openai";

function outputText(payload: Record<string, unknown>) {
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
  }
  return "";
}

export async function GET() {
  const db = await getDb();
  const [items, questions] = await Promise.all([
    db.select().from(listeningSolutions).orderBy(desc(listeningSolutions.updatedAt)),
    db.select({ id: examQuestions.id, year: examQuestions.year, subject: examQuestions.subject, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem, sourceUrl: examQuestions.sourceUrl }).from(examQuestions).where(eq(examQuestions.examType, "essay")).orderBy(desc(examQuestions.id)).limit(100),
  ]);
  return Response.json({ items, questions });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const questionId = Number(form.get("questionId")) || null;
  const pasted = String(form.get("questionText") ?? "").trim();
  const titleInput = String(form.get("title") ?? "").trim();
  const file = form.get("file");
  const db = await getDb();
  const preparedTxt = form.get("preparedTxt");
  if (preparedTxt instanceof File) {
    if (!preparedTxt.name.toLowerCase().endsWith(".txt") || preparedTxt.size > 5 * 1024 * 1024) return Response.json({ error: "請上傳 5MB 以下 TXT 聞稿" }, { status: 400 });
    const narrationScript = (await preparedTxt.text()).trim();
    if (!narrationScript) return Response.json({ error: "TXT 聞稿沒有內容" }, { status: 400 });
    const [row] = await db.insert(listeningSolutions).values({ title: titleInput || preparedTxt.name.replace(/\.txt$/i, ""), year: String(form.get("year") || "自訂"), subject: String(form.get("subject") || "刑法"), questionText: pasted || "自備聞稿", narrationScript }).returning();
    return Response.json({ item: row }, { status: 201 });
  }
  const [question] = questionId ? await db.select().from(examQuestions).where(eq(examQuestions.id, questionId)).limit(1) : [];
  if (!question && !pasted && !(file instanceof File)) return Response.json({ error: "請選擇二試真題、貼上題目或上傳題目檔" }, { status: 400 });
  if (file instanceof File && file.size > 12 * 1024 * 1024) return Response.json({ error: "題目檔請控制在 12MB 以下" }, { status: 400 });

  const prompt = question?.stem || pasted;
  const content: Array<Record<string, unknown>> = [];
  if (prompt) content.push({ type: "input_text", text: `題目內容：\n${prompt}` });
  if (file instanceof File) {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    if (file.type.startsWith("image/")) content.push({ type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" });
    else content.push({ type: "input_file", filename: file.name, file_data: `data:${file.type || "application/pdf"};base64,${base64}` });
  }
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    instructions: "你是台灣律師司法官二試解題節目編輯。先忠實辨識題目，不可補造事實；再寫成可直接錄音的繁體中文聞稿。語氣清楚、鼓勵、像老師陪學生審題。結構必須包含：開場定位、事實拆解、爭點清單、法規範、逐點涵攝、常見失分提醒、作答架構與收尾複習。不得聲稱唯一正解；不得加入AI漫畫或畫面指令。narration_script使用自然口語段落，不使用Markdown星號。",
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "listening_solution", strict: true, schema: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, year: { type: "string" }, subject: { type: "string" }, question_text: { type: "string" }, narration_script: { type: "string" } }, required: ["title", "year", "subject", "question_text", "narration_script"] } } },
  }) });
  const parsed = JSON.parse(outputText(payload)) as { title: string; year: string; subject: string; question_text: string; narration_script: string };
  const [row] = await db.insert(listeningSolutions).values({ questionId, title: titleInput || parsed.title, year: question?.year || parsed.year, subject: question?.subject || parsed.subject || "刑法", questionText: question?.stem || parsed.question_text, narrationScript: parsed.narration_script, sourceUrl: question?.sourceUrl || "" }).returning();
  const usage = payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
  await db.insert(usageLogs).values({ model: String(payload.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna"), source: "聽解題聞稿", inputTokens: usage?.input_tokens ?? 0, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 });
  return Response.json({ item: row }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const id = Number(body.id); if (!id) return Response.json({ error: "缺少項目編號" }, { status: 400 });
  const db = await getDb();
  const [row] = await db.update(listeningSolutions).set({ title: String(body.title ?? "").trim(), questionText: String(body.questionText ?? "").trim(), narrationScript: String(body.narrationScript ?? "").trim(), status: String(body.status ?? "draft"), updatedAt: new Date() }).where(eq(listeningSolutions.id, id)).returning();
  return Response.json({ item: row });
}

export async function PUT(request: Request) {
  const form = await request.formData(); const id = Number(form.get("id")); const file = form.get("audio");
  if (!id || !(file instanceof File)) return Response.json({ error: "請選擇音檔" }, { status: 400 });
  if (!file.type.startsWith("audio/") || file.size > 120 * 1024 * 1024) return Response.json({ error: "請上傳 120MB 以下 MP3、M4A 或 WAV" }, { status: 400 });
  const db = await getDb(); const [old] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.id, id)).limit(1);
  if (!old) return Response.json({ error: "找不到聽解題項目" }, { status: 404 });
  const { env } = await import("cloudflare:workers"); const key = `listening/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } }); if (old.audioStorageKey) await env.BUCKET.delete(old.audioStorageKey);
  const [row] = await db.update(listeningSolutions).set({ audioStorageKey: key, audioFileName: file.name, updatedAt: new Date() }).where(eq(listeningSolutions.id, id)).returning();
  return Response.json({ item: row });
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id")); const db = await getDb(); const [row] = await db.select().from(listeningSolutions).where(eq(listeningSolutions.id, id)).limit(1);
  if (!row) return Response.json({ error: "找不到項目" }, { status: 404 }); const { env } = await import("cloudflare:workers"); if (row.audioStorageKey) await env.BUCKET.delete(row.audioStorageKey); await db.delete(listeningSolutions).where(eq(listeningSolutions.id, id)); return Response.json({ ok: true });
}
