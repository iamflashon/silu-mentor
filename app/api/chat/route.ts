type ClientMessage = { role: "mentor" | "student"; text: string };
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { taipeiDate, taipeiGreeting } from "../../../lib/taipei-time";
import { appSettings, chatMessages, chatSessions, studyPlans, studyRecords, studyTasks, usageLogs } from "../../../db/schema";

const baseInstructions = `你是「司律備考」的 AI 學習教練，專門協助台灣律師與司法官考試。
你的任務是教會學生思考，不是立刻交付完整答案。

對話規則：
1. 使用繁體中文與中華民國法律語境。
2. 像真人老師自然對話，每次聚焦一個清楚、學生可以直接回答的問題。
3. 主動判斷學生的程度與下一個學習步驟，不等待學生設計課程。
4. 優先引導學生辨認題目事實、爭點與法律關係；除非學生明確要求，不要第一輪就公布完整解答。
5. 學生答錯時，先指出已經抓對的部分，再給一層提示或更小的問題。
6. 不要使用僵硬的「教學卡、步驟一、步驟二」口吻，不要一次問很多問題。
7. 若資訊不足或法律內容不確定，要直接說明，不得捏造法條、判決或教材來源。
8. 回覆通常控制在 80 至 220 個中文字；必要時可稍長。
9. 若檔案搜尋工具找到教材內容，必須以教材為優先依據；找不到時才使用一般模型知識，且不得捏造教材來源。
10. 當你已經知道學生的考試目標、每日可用時間與目前學習需求，而且目前尚無計畫，才主動呼叫 save_study_plan，建立接下來 7 天可執行的讀書計畫。
11. 行事曆任務必須使用真實 YYYY-MM-DD 日期；不得把尚未公布的考試日期編造成確切日期。
12. 選擇題作答後先確認正誤，再引導學生說明其選項與其他選項的對錯理由；不要立刻傾倒完整解析。
13. 申論題先帶學生審題：辨識人物、行為、時間、法律關係與可能爭點，再形成答題骨架；除非學生明確要求或已完成作答，不要直接提供完整擬答。
14. 不得把模型自行生成的題目冒充歷屆真題；只有題庫或教材中具有明確年度、題號與來源的內容，才能稱為真題。
15. 回覆使用純文字與自然換行，不要輸出 Markdown 星號、井號標題或反引號。
16. 維持學生信心：更正時先肯定學生察覺或已掌握的部分，再用一至兩句澄清並立即帶回下一個可完成的小步驟。不要長篇自責、反覆強調「我錯了／誤導你」，也不要把系統或檢索問題的焦慮丟給學生。
17. 教材搜尋結果必須同時符合「目前科目、今日任務、學生正在問的爭點」才可作為答案依據。僅有相同詞彙但屬於別科、別章或例外規定時，必須忽略，不得因搜尋到教材就硬套。
18. 學生質疑來源時，先重新核對問題與教材的直接關聯；若不直接相關，就簡短說明該段不適用，停止引用並回到正確主題。不要用不相關教材替先前說法辯護。`;

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    });
  }).join("").trim();
}

function usedFileSearch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const output = (payload as { output?: unknown[] }).output;
  return Array.isArray(output) && output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "file_search_call");
}

function extractSources(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as string[];
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return [] as string[];
  const names: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const annotations = (part as { annotations?: unknown[] }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object" || (annotation as { type?: string }).type !== "file_citation") continue;
        const filename = (annotation as { filename?: unknown }).filename;
        if (typeof filename === "string" && filename.trim()) names.push(filename.trim());
      }
    }
  }
  return [...new Set(names)].slice(0, 5);
}

function chooseModel(messages: ClientMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "student")?.text ?? "";
  if (/完整批改|申論批改|評分|逐段改寫|模擬閱卷/.test(latest)) return "gpt-5.6-sol";
  if (latest.length > 500 || /深入分析|學說比較|實務見解|判決分析|完整涵攝|爭點整理/.test(latest)) return "gpt-5.6-terra";
  return "gpt-5.6-luna";
}

function inferSubject(text: string) {
  if (/刑法/.test(text)) return "刑法";
  if (/刑事訴訟法|刑訴/.test(text)) return "刑事訴訟法";
  if (/民事訴訟法|民訴/.test(text)) return "民事訴訟法";
  if (/民法/.test(text)) return "民法";
  if (/憲法/.test(text)) return "憲法";
  if (/行政法/.test(text)) return "行政法";
  if (/公司法|商法|票據法|保險法|證券交易法/.test(text)) return "商事法";
  return "綜合";
}

const modelRates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.10, cached: 0.01, output: 0.60 },
  "gpt-5.6-terra": { input: 1.00, cached: 0.10, output: 6.00 },
  "gpt-5.6-sol": { input: 2.50, cached: 0.25, output: 15.00 },
};

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const inputTokens = Number(usage?.input_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? 0);
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : null;
  const cachedTokens = Number(details?.cached_tokens ?? 0);
  return { inputTokens, outputTokens, cachedTokens };
}

type PlanCall = { title: string; target_label: string; daily_minutes: number; tasks: Array<{ date: string; subject: string; title: string; duration_minutes: number; details: string }> };
type DeletePlanCall = { mode: "duplicates" | "title"; title: string; date: string; subject: string };

function readPlanCall(payload: unknown): PlanCall | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return null;
  const call = output.find((item) => item && typeof item === "object" && (item as { type?: string; name?: string }).type === "function_call" && (item as { name?: string }).name === "save_study_plan") as { arguments?: string } | undefined;
  if (!call?.arguments) return null;
  try { return JSON.parse(call.arguments) as PlanCall; } catch { return null; }
}

function readDeleteCall(payload: unknown): DeletePlanCall | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return null;
  const call = output.find((item) => item && typeof item === "object" && (item as { type?: string; name?: string }).type === "function_call" && (item as { name?: string }).name === "delete_study_tasks") as { arguments?: string } | undefined;
  if (!call?.arguments) return null;
  try { return JSON.parse(call.arguments) as DeletePlanCall; } catch { return null; }
}

function normalizedTaskPart(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。,、:：·・\-_—]/g, "");
}

async function deletePlanTasks(command: DeletePlanCall) {
  const db = await getDb();
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
  if (!plan) return { count: 0, titles: [] as string[] };
  const tasks = await db.select().from(studyTasks).where(eq(studyTasks.planId, plan.id)).orderBy(asc(studyTasks.id));
  let targets = tasks;
  if (command.mode === "duplicates") {
    const seen = new Set<string>();
    targets = tasks.filter((task) => {
      const key = `${task.taskDate}|${normalizedTaskPart(task.subject)}|${normalizedTaskPart(task.title)}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  } else {
    const title = normalizedTaskPart(command.title);
    targets = tasks.filter((task) => normalizedTaskPart(task.title) === title && (!command.date || task.taskDate === command.date) && (!command.subject || normalizedTaskPart(task.subject) === normalizedTaskPart(command.subject)));
  }
  for (const task of targets) await db.delete(studyTasks).where(eq(studyTasks.id, task.id));
  return { count: targets.length, titles: targets.slice(0, 5).map((task) => `${task.taskDate} ${task.subject}／${task.title}`) };
}

async function savePlan(plan: PlanCall) {
  const db = await getDb();
  await db.update(studyPlans).set({ active: false }).where(eq(studyPlans.active, true));
  const [created] = await db.insert(studyPlans).values({
    title: plan.title.slice(0, 120),
    targetLabel: plan.target_label.slice(0, 120),
    dailyMinutes: Math.max(15, Math.min(720, Number(plan.daily_minutes) || 120)),
  }).returning();
  const tasks = plan.tasks.slice(0, 14).filter((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.date));
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = `${task.date}|${normalizedTaskPart(task.subject)}|${normalizedTaskPart(task.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(studyTasks).values({
      planId: created.id,
      taskDate: task.date,
      subject: task.subject.slice(0, 40),
      title: task.title.slice(0, 120),
      durationMinutes: Math.max(10, Math.min(480, Number(task.duration_minutes) || 30)),
      details: (task.details ?? "").slice(0, 500),
    });
  }
  return tasks.length;
}

async function getOrCreateSession(request: Request, requestedId: number | null, firstText: string) {
  const db = await getDb();
  const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
  if (requestedId) {
    const [existing] = await db.select().from(chatSessions).where(eq(chatSessions.id, requestedId)).limit(1);
    if (existing?.userKey === key) return existing;
  }
  const [latest] = await db.select().from(chatSessions).where(eq(chatSessions.userKey, key)).orderBy(desc(chatSessions.updatedAt)).limit(1);
  if (latest) return latest;
  const [created] = await db.insert(chatSessions).values({ userKey: key, title: firstText.slice(0, 60) || "司律備考對話" }).returning();
  return created;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "OPENAI_API_KEY 尚未設定於司律備考的伺服器環境" }, { status: 503 });
    }

    const body = await request.json() as { messages?: ClientMessage[]; sessionId?: number | null; imageDataUrl?: string };
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    if (!messages.length) return Response.json({ error: "缺少對話內容" }, { status: 400 });
    const imageDataUrl = typeof body.imageDataUrl === "string" && /^data:image\/jpeg;base64,/.test(body.imageDataUrl) && body.imageDataUrl.length <= 4_500_000 ? body.imageDataUrl : "";
    const latestStudent = [...messages].reverse().find((message) => message.role === "student");
    const session = await getOrCreateSession(request, Number(body.sessionId) || null, latestStudent?.text ?? "司律備考對話");
    if (latestStudent) {
      const db = await getDb();
      await db.insert(chatMessages).values({ sessionId: session.id, role: "student", text: latestStudent.text });
      await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, session.id));
    }

    let vectorStoreId = "";
    try {
      const db = await getDb();
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
      vectorStoreId = setting?.value ?? "";
    } catch { /* answer from model knowledge until the index is ready */ }

    const today = taipeiDate();
    let planContext = "目前尚未建立讀書計畫。";
    let recordContext = "目前尚無學習紀錄。";
    try {
      const db = await getDb();
      const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
      if (plan) {
        const tasks = await db.select().from(studyTasks).where(eq(studyTasks.planId, plan.id)).orderBy(asc(studyTasks.taskDate)).limit(30);
        planContext = `目前計畫：${plan.title}；目標：${plan.targetLabel}；每日 ${plan.dailyMinutes} 分鐘。任務：${tasks.map((task) => `${task.taskDate} ${task.subject}/${task.title}/${task.durationMinutes}分鐘/${task.status}`).join("；") || "尚無任務"}`;
      }
    } catch { /* the tutor can continue before plan storage is ready */ }
    try {
      const db = await getDb();
      const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
      const records = await db.select().from(studyRecords).where(eq(studyRecords.userKey, key)).orderBy(desc(studyRecords.createdAt)).limit(20);
      if (records.length) recordContext = `近期學習紀錄：${records.map((record) => `${record.recordDate} ${record.subject}/${record.title}/${record.activityType}/${record.actualMinutes}分鐘${record.correct === null ? "" : record.correct ? "/答對" : "/答錯"}${record.weakness ? `/弱點:${record.weakness}` : ""}${record.nextStep ? `/接續:${record.nextStep}` : ""}`).join("；")}`;
    } catch { /* continue without record context */ }
    const instructions = `${baseInstructions}\n\n現在是台北時間 ${today}，目前時段應使用「${taipeiGreeting()}」；所有「今天、明天、明年」都必須以台北時間換算，不得使用伺服器時區。\n${planContext}\n${recordContext}\n你必須根據學生實際完成狀態、作答正誤、延誤與新弱點調整後續計畫；不要重複已完成任務。若有下次接續點，優先從該處接著教。\n重要：學生詢問「今天的讀書計畫、目前計畫、接下來要做什麼」時，必須直接依上方任務與學習紀錄逐項回答，絕對不可呼叫 save_study_plan。只有學生明確說要建立、重排、修改或調整計畫時，才可寫入新計畫。\n重要：學生明確要求刪除、移除或清理行事曆任務時，必須使用 delete_study_tasks；若要求處理重複行程，使用 mode=duplicates，只刪除每組重複中的後續項目並保留最早的一項。沒有明確刪除要求時禁止刪除。`;
    const selectedModel = process.env.OPENAI_MODEL || chooseModel(messages);
    const tools: Array<Record<string, unknown>> = [{
      type: "function",
      name: "save_study_plan",
      description: "僅在學生明確要求建立、重排、修改或調整計畫時，將已確認的安排寫入行事曆；查詢目前計畫時禁止使用",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          target_label: { type: "string", description: "例如 116年律師考試；日期未公布時只寫目標月份" },
          daily_minutes: { type: "integer" },
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 14,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                date: { type: "string", description: "YYYY-MM-DD" },
                subject: { type: "string" },
                title: { type: "string" },
                duration_minutes: { type: "integer" },
                details: { type: "string" },
              },
              required: ["date", "subject", "title", "duration_minutes", "details"],
            },
          },
        },
        required: ["title", "target_label", "daily_minutes", "tasks"],
      },
    }];
    tools.push({
      type: "function",
      name: "delete_study_tasks",
      description: "只有學生明確要求刪除、移除或清理行事曆時使用。mode=duplicates 會判斷同一天、同科目、同任務名稱的重複項目，保留最早建立的一項；mode=title 刪除指定名稱，可再用日期與科目縮小範圍。",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["duplicates", "title"] },
          title: { type: "string", description: "mode=title 時填寫完整任務名稱，其他模式填空字串" },
          date: { type: "string", description: "可填 YYYY-MM-DD；不指定時填空字串" },
          subject: { type: "string", description: "可填科目；不指定時填空字串" },
        },
        required: ["mode", "title", "date", "subject"],
      },
    });
    if (vectorStoreId) tools.unshift({ type: "file_search", vector_store_ids: [vectorStoreId], max_num_results: 8 });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        instructions,
        input: messages.map((message, index) => ({
          role: message.role === "mentor" ? "assistant" : "user",
          content: imageDataUrl && message.role === "student" && index === messages.length - 1 ? [
            { type: "input_text", text: message.text },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ] : message.text,
        })),
        tools,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ error: "AI 服務暫時無法回應" }, { status: 502 });
    }
    let reply = extractText(payload);
    const planCall = readPlanCall(payload);
    const deleteCall = readDeleteCall(payload);
    let planSaved = false;
    if (planCall) {
      try {
        const count = await savePlan(planCall);
        if (count) {
          planSaved = true;
          reply = `${reply ? `${reply}\n\n` : ""}我已經把接下來 ${count} 項任務寫入你的讀書計畫。你可以打開行事曆查看，也可以隨時告訴我調整。`;
        }
      } catch { /* keep the conversation available */ }
    }
    let tasksDeleted = 0;
    if (deleteCall) {
      try {
        const result = await deletePlanTasks(deleteCall);
        tasksDeleted = result.count;
        reply = `${reply ? `${reply}\n\n` : ""}${result.count ? `已刪除 ${result.count} 項行事曆任務。${result.titles.length ? `\n${result.titles.join("\n")}` : ""}` : "目前沒有找到符合條件的行事曆任務。"}`;
      } catch { /* keep the conversation available */ }
    }
    if (!reply) return Response.json({ error: "AI 未產生可顯示內容" }, { status: 502 });

    const searchedFiles = usedFileSearch(payload);
    const sources = searchedFiles ? extractSources(payload) : [];
    const fromFiles = sources.length > 0;
    const usage = readUsage(payload);
    const rates = modelRates[selectedModel] ?? modelRates["gpt-5.6-luna"];
    const nonCachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
    const tokenCost = (nonCachedInput * rates.input + usage.cachedTokens * rates.cached + usage.outputTokens * rates.output) / 1_000_000;
    const fileSearchCost = searchedFiles ? 0.0025 : 0;
    const estimatedCostUsd = tokenCost + fileSearchCost;
    try {
      const db = await getDb();
      await db.insert(usageLogs).values({
        model: selectedModel,
        source: fromFiles ? "教材" : "AI 補充",
        inputTokens: usage.inputTokens,
        cachedTokens: usage.cachedTokens,
        outputTokens: usage.outputTokens,
        fileSearchCalls: searchedFiles ? 1 : 0,
        estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1_000_000),
      });
      await db.insert(chatMessages).values({
        sessionId: session.id,
        role: "mentor",
        text: reply,
        source: fromFiles ? "教材" : "AI 補充",
        citationsJson: sources.length ? JSON.stringify(sources) : null,
        model: selectedModel,
        estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1_000_000),
      });
      await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, session.id));
      if (latestStudent && latestStudent.text.trim().length >= 6) {
        const learningMinutes = Math.min(30, Math.max(5, Math.ceil(latestStudent.text.trim().length / 80) * 5));
        await db.insert(studyRecords).values({
          userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
          recordDate: today,
          subject: inferSubject(latestStudent.text),
          title: `AI 對話｜${latestStudent.text.trim().slice(0, 72)}`,
          activityType: "AI 對話學習",
          actualMinutes: learningMinutes,
          reflection: "已完成一次 AI 引導學習對話。",
          nextStep: reply.replace(/\s+/g, " ").slice(0, 180),
        });
      }
    } catch { /* usage logging must not block the learner */ }

    return Response.json({
      reply,
      source: fromFiles ? "教材" : "AI 補充",
      usage: { model: selectedModel, ...usage, fileSearchCalls: searchedFiles ? 1 : 0, estimatedCostUsd },
      planSaved,
      tasksDeleted,
      sources,
      sessionId: session.id,
    });
  } catch {
    return Response.json({ error: "對話處理失敗" }, { status: 500 });
  }
}
