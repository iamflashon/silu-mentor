import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, examQuestions, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { requireAdmin } from "../../../../lib/member-auth";

type Turn = { role: "student" | "mentor"; text: string };
function outputText(payload: Record<string, unknown>) { if (typeof payload.output_text === "string") return payload.output_text.trim(); const output = Array.isArray(payload.output) ? payload.output : []; return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim(); }
function fileSearchResults(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "file_search_call") return [];
    const results = Array.isArray((item as { results?: unknown[] }).results) ? (item as { results: unknown[] }).results : [];
    return results.filter((result): result is Record<string, unknown> => Boolean(result && typeof result === "object"));
  });
}
function matchText(value:string){return value.toLowerCase().replace(/\[\[page:\s*\d+\]\]/giu,"").replace(/[\s，。！？、；：,.!?;:（）()$％%]/gu,"")}
function matchScore(query:string,stem:string){const q=matchText(query),s=matchText(stem);if(q.length<12||s.length<12)return 0;if(q.includes(s.slice(0,Math.min(80,s.length)))||s.includes(q.slice(0,Math.min(80,q.length))))return 1;const chunks=[...new Set(Array.from({length:Math.max(0,q.length-11)},(_,i)=>q.slice(i,i+12)))];if(!chunks.length)return 0;return chunks.filter(chunk=>s.includes(chunk)).length/chunks.length}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: Turn[]; mode?: string; level?: string; stage?: string; chapter?: string; questionType?: string; simulateStudent?: boolean; imageDataUrls?: string[] };
    if (body.simulateStudent) {
      const auth = await requireAdmin(request);
      if ("error" in auth) return auth.error;
    }
    const messages = (body.messages ?? []).filter((item) => item && ["student", "mentor"].includes(item.role) && typeof item.text === "string").slice(-10);
    const latest = [...messages].reverse().find((item) => item.role === "student")?.text.trim();
    if (!latest) return Response.json({ error: "請先輸入中級會計問題。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "Luna 助教模型尚未設定。" }, { status: 503 });
    const db = await getDb();
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
    const enabledDocuments = await db.select({ id: documents.id, fileName: documents.fileName, openaiFileId: documents.openaiFileId, subject: documents.subject, documentType: documents.documentType }).from(documents).where(and(eq(documents.examCategory, "accounting"), eq(documents.homepageSearchEnabled, true), eq(documents.vectorIndexed, true)));
    if (setting?.value && enabledDocuments.length) {
      await Promise.all(enabledDocuments.map(document => document.openaiFileId ? openAIJson(`/vector_stores/${setting.value}/files/${document.openaiFileId}`, {
        method: "POST",
        body: JSON.stringify({ attributes: { exam_category: "accounting", subject: document.subject, document_type: document.documentType, source_file: document.fileName, homepage_enabled: true } }),
      }).catch(() => null) : null));
    }
    const questionRows = await db.select({ examName:examQuestions.examName, questionNumber:examQuestions.questionNumber, year:examQuestions.year, stem:examQuestions.stem, optionsJson:examQuestions.optionsJson, explanation:examQuestions.explanation, teacherAnswer:examQuestions.teacherAnswer, teacherNotes:examQuestions.teacherNotes }).from(examQuestions).where(eq(examQuestions.examCategory,"accounting"));
    const matchQuery=messages.filter(item=>item.role==="student").slice(-3).map(item=>item.text).join("\n");
    const directMatch = questionRows.map(row=>({row,score:matchScore(matchQuery,row.stem)})).sort((a,b)=>b.score-a.score)[0];
    const boundQuestion = directMatch&&directMatch.score>=.2?directMatch.row:null;
    let boundOptions="";try{const parsed=JSON.parse(boundQuestion?.optionsJson||"{}") as Record<string,string>;boundOptions=Object.entries(parsed).map(([key,value])=>`${key}. ${removeAccountingPageFurniture(value)}`).join("\n")}catch{}
    const boundEvidence=boundQuestion?`【已入庫老師題庫直接命中】\n來源書：${boundQuestion.examName}\n考試來源：${boundQuestion.year}\n題號：${boundQuestion.questionNumber}\n原稿位置：${boundQuestion.teacherNotes}\n題目：${removeAccountingPageFurniture(boundQuestion.stem)}\n${boundOptions}\n教材答案與解析：${removeAccountingPageFurniture(boundQuestion.explanation||boundQuestion.teacherAnswer)||"本題尚未拆出獨立解析"}`:"";
    const allowSearch = Boolean(setting?.value && enabledDocuments.length);
    const model = "gpt-5.6-luna", startedAt = Date.now();
    const conversation = messages.map((item) => `${item.role === "student" ? "學生" : "Luna 助教"}：${item.text.slice(0, 2500)}`).join("\n\n");
    const guided = body.mode === "guided";
    const level = ["入門", "進階", "考前"].includes(body.level || "") ? body.level! : "入門";
    const stage = ["讀題", "條件", "準則", "計算", "核對"].includes(body.stage || "") ? body.stage! : "讀題";
    const chapter = String(body.chapter || "未指定章節").slice(0, 80);
    const questionType = ["選擇題", "計算題", "觀念題"].includes(body.questionType || "") ? body.questionType! : "選擇題";
    const imageDataUrls = (body.imageDataUrls ?? []).filter((value) => typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(value) && value.length < 4_500_000).slice(0, 2);
    const groundedConversation=`${boundEvidence?`${boundEvidence}\n\n`:""}${conversation}`;
    const input = imageDataUrls.length && !body.simulateStudent ? [{ role: "user", content: [{ type: "input_text", text: `${groundedConversation}\n\n圖片共有 ${imageDataUrls.length} 張，請按照第 1 頁、第 2 頁順序視為同一道跨頁題目閱讀。` }, ...imageDataUrls.map((image_url) => ({ type: "input_image", image_url }))] }] : groundedConversation;
    const guidedRules = guided ? `目前是申論逐步解題模式。題型：${questionType}；學生程度：${level}；目前階段：${stage}。不得一開始直接給完整答案。每輪只完成一個步驟，依序確認題目要求、已知條件、準則、計算式或分錄、完整作答與核對。學生答錯時先指出要重想的判斷點，再給一層提示。每次結尾只問一個明確問題。` : "目前是首頁課業答疑模式。學生不需要選書或選章節；直接針對觀念、準則、計算、分錄或照片題目回答。先給白話結論，再按需要逐步列式與核對。教材只作為背後的回答依據，不要要求學生進入章節學習。";
    const simulationRules = body.simulateStudent ? `你現在不是老師，而是模擬一位「${level}」程度的中會學生。先閱讀 Luna 助教最後一則回答，找出其中最可能還沒聽懂的一個觀念、計算步驟、分錄方向或教材依據，提出一個自然且具體的接續問題。問題必須延續目前同一題，不得另起新題；不要重貼整題，不要批改老師，不要說明你在模擬，也不要自行公布答案。只輸出學生要送出的那一句或一小段繁體中文問題。` : "";
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是臺灣國考與校內考試的中級會計學 AI 教練。只能以中級會計學、IFRS 與所附會計教材範圍回答，絕不可混入司律或醫檢師內容。以繁體中文教學。${simulationRules || guidedRules} ${body.simulateStudent ? "" : `先確認題目要求與已知條件，再依序說明適用準則、計算或分錄、最後核對。數字題必須逐步列式並檢查單位；分錄題要明列借方、貸方與金額；觀念題要區分原則、適用條件與常見陷阱。若資料不足，直接指出還缺哪些條件，不可自行補造數字。已開放老師教材時必須先搜尋教材；若附有圖片，先辨認題目中的關鍵句、科目與數字，再用關鍵句搜尋教材。${boundQuestion?"輸入中已有【已入庫老師題庫直接命中】，這就是有效教材依據；必須依該題教材答案校準，不得再說未命中教材。":"只有在題庫直接比對與 file_search 的實際結果都沒有教材時，才明示本次未找到已開放的中會教材。"}`}只輸出純文字，避免 Markdown 表格與標題符號。`,
      input,
      ...(allowSearch ? { tools: [{ type: "file_search", vector_store_ids: [setting!.value], max_num_results: 8, filters: { type: "and", filters: [{ key: "exam_category", type: "eq", value: "accounting" }, { key: "homepage_enabled", type: "eq", value: true }] } }], tool_choice: "required", include: ["file_search_call.results"] } : {}),
      max_output_tokens: 1200,
    }) }) as Record<string, unknown>;
    const reply = outputText(payload); if (!reply) return Response.json({ error: "Luna 助教 暫時沒有完成回答，請再試一次。" }, { status: 502 });
    const usage = (payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    const inputTokens = Number(usage.input_tokens || 0), outputTokens = Number(usage.output_tokens || 0), cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens });
    const searchResults = fileSearchResults(payload);
    await db.insert(usageLogs).values({ model, source: guided ? "中會引導學習" : "中會首頁 AI", inputTokens, outputTokens, cachedTokens, fileSearchCalls: searchResults.length ? 1 : 0, estimatedCostUsdMicros });
    const searchedFiles = [...new Set(searchResults.map(result => String(result.filename ?? "").trim()).filter(Boolean))].slice(0, 3);
    const directSource=boundQuestion?`${boundQuestion.examName}｜${boundQuestion.year}｜第 ${boundQuestion.questionNumber} 題${boundQuestion.teacherNotes?`｜${boundQuestion.teacherNotes}`:""}`:"";
    return Response.json({ reply, source: directSource?`已命中老師教材：${directSource}`:searchResults.length ? `已命中老師教材：${searchedFiles.length?searchedFiles.join("、"):`共 ${searchResults.length} 個相關片段`}` : allowSearch ? "本次已搜尋，但未命中老師教材" : "尚無已開放搜尋的老師教材，以下為 AI 一般知識說明", usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Luna 助教 回答失敗" }, { status: 500 }); }
}
