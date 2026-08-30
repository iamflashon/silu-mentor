import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, chatMessages, chatSessions, documents, examQuestions, usageLogs } from "../../../../db/schema";
import { getOpenAIKey, openAIJson } from "../../../../lib/openai";
import { estimateCostUsdMicros } from "../../../../lib/usage";
import { removeAccountingPageFurniture } from "../../../../lib/accounting-question";
import { requireAdmin, requireMember } from "../../../../lib/member-auth";
import { finishAccountingAiUse, prepareAccountingAiUse } from "../../../../lib/accounting-ai-access";
import { refundTrialQuestion, reserveTrialQuestion, trialStatus } from "../../../../lib/accounting-qa-trial";

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
function sourceBookName(value:string){
  return value
    .trim()
    .replace(/\.pdf$/iu,"")
    .replace(/^51MG\d+[_-]?/iu,"")
    .replace(/全書$/u,"")
    .trim();
}

export async function handleAccountingTutor(request: Request, forceTrialMode = false) {
  let reservedDeviceKey = "";
  try {
    const body = await request.json() as { messages?: Turn[]; mode?: string; level?: string; stage?: string; chapter?: string; questionType?: string; simulateStudent?: boolean; imageDataUrls?: string[] };
    const isTrial = forceTrialMode === true;
    if (!isTrial && !body.simulateStudent) {
      const auth = await requireMember(request);
      if ("error" in auth) return auth.error;
    }
    if (body.simulateStudent) {
      const auth = await requireAdmin(request);
      if ("error" in auth) return auth.error;
    }
    const messages = (body.messages ?? []).filter((item) => item && ["student", "mentor"].includes(item.role) && typeof item.text === "string").slice(-10);
    const studentTurnCount = messages.filter((item) => item.role === "student").length;
    const latest = [...messages].reverse().find((item) => item.role === "student")?.text.trim();
    if (!latest) return Response.json({ error: "請先輸入中級會計問題。" }, { status: 400 });
    if (!await getOpenAIKey()) return Response.json({ error: "Luna 助教模型尚未設定。" }, { status: 503 });
    const reservation = isTrial ? await reserveTrialQuestion(request) : null;
    if (reservation && !reservation.ok) return Response.json({ error: "免費測試次數已用完，請申請繼續測試。", code: "QA_TRIAL_LIMIT", trial: reservation }, { status: 429, headers: reservation.setCookie ? { "set-cookie": reservation.setCookie } : undefined });
    if (reservation?.ok) reservedDeviceKey = reservation.deviceKey;
    const aiGate = isTrial ? { metered: false as const, memberId: 0, db: await getDb() } : await prepareAccountingAiUse(request);
    if (!aiGate) return Response.json({ error: "無法確認課業答疑權限。" }, { status: 401 });
    if (aiGate instanceof Response) return aiGate;
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
    const answerDepth = studentTurnCount <= 1
      ? "這是本題第一次回答，務必極簡。不要寫『先確認題目要求與已知條件』，不要重述題目、逐段教學、補充原理或總結核心。計算題只輸出答案與必要算式，格式以『答案：』開頭，通常控制在 120 至 180 個中文字內；多小題各用一行。觀念題則先給結論，再列最多 3 個關鍵理由。"
      : "這是同一題的接續追問。只補充學生這一輪問到的部分；需要時再展開相關計算、分錄或準則，不要重講整題。";
    const guidedRules = guided ? `目前是申論逐步解題模式。題型：${questionType}；學生程度：${level}；目前階段：${stage}。不得一開始直接給完整答案。每輪只完成一個步驟，依序確認題目要求、已知條件、準則、計算式或分錄、完整作答與核對。學生答錯時先指出要重想的判斷點，再給一層提示。每次結尾只問一個明確問題。` : `目前是首頁課業答疑模式。學生不需要選書或選章節；直接針對觀念、準則、計算、分錄或照片題目回答。${answerDepth}教材只作為背後的回答依據，不要要求學生進入章節學習。`;
    const simulationRules = body.simulateStudent ? `你現在不是老師，而是模擬一位「${level}」程度的中會學生。先閱讀 Luna 助教最後一則回答，找出其中最可能還沒聽懂的一個觀念、計算步驟、分錄方向或教材依據，提出一個自然且具體的接續問題。問題必須延續目前同一題，不得另起新題；不要重貼整題，不要批改老師，不要說明你在模擬，也不要自行公布答案。只輸出學生要送出的那一句或一小段繁體中文問題。` : "";
    const completionMarker = "【LUNA回答完整】";
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是臺灣國考與校內考試的中級會計學 AI 教練。只能以中級會計學、IFRS 與所附會計教材範圍回答，絕不可混入司律或醫檢師內容。以繁體中文教學。${simulationRules || guidedRules} ${body.simulateStudent ? "" : `先在內部完成題意與條件核對，輸出直接從答案開始，不要把核對過程寫給學生。只有學生追問或正確性確實需要時，才逐步展開計算或分錄；數字與單位仍須核對，分錄的借貸方向與金額不得省略到無法判斷。若資料不足，直接指出還缺哪些條件，不可自行補造數字。已開放老師教材時必須先搜尋教材；若附有圖片，先辨認題目中的關鍵句、科目與數字，再用關鍵句搜尋教材。${boundQuestion?"輸入中已有【已入庫老師題庫直接命中】，這就是有效教材依據；必須依該題教材答案校準，不得再說未命中教材。":"只有在題庫直接比對與 file_search 的實際結果都沒有教材時，才明示本次未找到已開放的中會教材。"}回答最後必須有一行明確的『答案：』或『結論：』，並在所有算式、分錄與結論都完成後，另起一行輸出 ${completionMarker}。不得在回答尚未完成時輸出此標記。`}只輸出純文字，避免 Markdown 表格與標題符號。`,
      input,
      ...(allowSearch ? { tools: [{ type: "file_search", vector_store_ids: [setting!.value], max_num_results: 8, filters: { type: "and", filters: [{ key: "exam_category", type: "eq", value: "accounting" }, { key: "homepage_enabled", type: "eq", value: true }] } }], tool_choice: "required", include: ["file_search_call.results"] } : {}),
      max_output_tokens: studentTurnCount <= 1 ? 2000 : 3000,
    }) }) as Record<string, unknown>;
    let reply = outputText(payload);
    const usageRows = [(payload.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }];
    const incomplete = payload.status === "incomplete" || (payload.incomplete_details && typeof payload.incomplete_details === "object" && (payload.incomplete_details as { reason?: string }).reason === "max_output_tokens");
    const missingCompletion = !body.simulateStudent && !reply.includes(completionMarker);
    if ((incomplete || missingCompletion) && typeof payload.id === "string") {
      const continuation = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model,
        previous_response_id: payload.id,
        instructions: `上一則中級會計回答尚未確認完整。只從中斷處補完尚未完成的算式、分錄、答案或結論，不要重複前文，不要新增延伸說明。最後必須另起一行輸出 ${completionMarker}。`,
        input: "請檢查上一則回答；若內容未完，從中斷處接續。務必補上明確答案或結論並完整收尾。",
        max_output_tokens: 1600,
      }) }) as Record<string, unknown>;
      const continuationText = outputText(continuation);
      if (continuationText) reply = `${reply}\n${continuationText}`.trim();
      usageRows.push((continuation.usage ?? {}) as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } });
    }
    reply = reply.replaceAll(completionMarker, "").trim();
    if (!reply) return Response.json({ error: "Luna 助教 暫時沒有完成回答，請再試一次。" }, { status: 502 });
    const inputTokens = usageRows.reduce((sum, usage) => sum + Number(usage.input_tokens || 0), 0), outputTokens = usageRows.reduce((sum, usage) => sum + Number(usage.output_tokens || 0), 0), cachedTokens = usageRows.reduce((sum, usage) => sum + Number(usage.input_tokens_details?.cached_tokens || 0), 0);
    const estimatedCostUsdMicros = estimateCostUsdMicros(model, { inputTokens, outputTokens, cachedTokens });
    const searchResults = fileSearchResults(payload);
    await db.insert(usageLogs).values({ model, source: guided ? "中會引導學習" : "中會首頁 AI", inputTokens, outputTokens, cachedTokens, fileSearchCalls: searchResults.length ? 1 : 0, estimatedCostUsdMicros });
    const searchedFiles = [...new Set(searchResults.map(result => sourceBookName(String(result.filename ?? ""))).filter(Boolean))].slice(0, 3);
    const directSource=boundQuestion?sourceBookName(boundQuestion.examName):"";
    const source=directSource?`依據來源：${directSource}`:searchResults.length ? `依據來源：${searchedFiles.length?searchedFiles.join("、"):`老師教材相關片段`}` : allowSearch ? "本次已搜尋，但未命中老師教材" : "尚無已開放搜尋的老師教材，以下為 AI 一般知識說明";
    let recordId:number|undefined;
    if(!body.simulateStudent&&!guided){
      const userKey=request.headers.get("oai-authenticated-user-email")??(reservedDeviceKey?`qa-trial:${reservedDeviceKey}`:"default-owner");
      const [session]=await db.insert(chatSessions).values({userKey,title:latest.slice(0,80),summary:reply.slice(0,220),progressStatus:"completed",contextType:"accounting",updatedAt:new Date()}).returning();
      recordId=session.id;
      await db.insert(chatMessages).values([{sessionId:session.id,role:"student",text:latest},{sessionId:session.id,role:"mentor",text:reply,source,model:"Luna",estimatedCostUsdMicros}]);
    }
    const aiAccess = await finishAccountingAiUse(aiGate);
    const currentTrial = isTrial ? await trialStatus(request) : undefined;
    const headers=currentTrial?.setCookie?{"set-cookie":currentTrial.setCookie}:undefined;
    return Response.json({ reply, source, recordId, aiAccess, trial:currentTrial, usage: { model: "Luna", inputTokens, outputTokens, cachedTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: estimatedCostUsdMicros / 1_000_000 } },{headers});
  } catch (error) { if(reservedDeviceKey)await refundTrialQuestion(reservedDeviceKey).catch(()=>null);return Response.json({ error: error instanceof Error ? error.message : "Luna 助教 回答失敗" }, { status: 500 }); }
}

export async function POST(request: Request) {
  return handleAccountingTutor(request, false);
}
