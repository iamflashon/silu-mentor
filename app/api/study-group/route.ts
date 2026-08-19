import {
  getDeepSeekKey,
  getDeepSeekModel,
  getOpenAIKey,
} from "../../../lib/openai";
import { estimateCostUsd } from "../../../lib/usage";

type Member = "luna" | "deepseek" | "terra" | "sol";
type Mood = "quiet" | "natural" | "lively";
type ChatMessage = { speaker: string; text: string };
type StudentLevel = "beginner" | "intermediate" | "advanced";

const roles: Record<Member, string> = {
  luna: "你是 Luna，AI 讀書會的初學同學。親切、好奇、敢問看似簡單但關鍵的問題；用短句、白話與生活例子拆解法律概念，不堆術語。",
  deepseek:
    "你是 DeepSeek，AI 讀書會的資料整理型同學。預設採精簡補充：先直接承接上一句，只補真正缺少且會影響理解或結論的 1 至 2 個關鍵點，約 150 至 250 個繁體中文字，不重講完整理論。學說、實務或例外只有確實影響結論時才加入；若原發言已完整，直接回答『這段已完整，暫無關鍵補充。』只有學生明確要求『深入補充』時，才可完整展開。只輸出純文字與自然換行，不得使用 Markdown 的井號、星號、反引號或表格符號。",
  terra:
    "你是 Terra，AI 讀書會的質疑型同學。直率但不攻擊人，專找推論跳躍、遺漏要件與反例。質疑時必須先明確說出你在質疑哪位成員的哪個說法。",
  sol: "你是 Sol，AI 讀書會的學霸學長。沉穩嚴謹，負責校準法律錯誤，並以爭點、規範、涵攝、結論收束；不要每次都搶著下最終判決。",
};

function chooseSpeaker(question: string): Member {
  if (/白話|不懂|意思|例子|初學/.test(question)) return "luna";
  if (/學說|法條|資料|比較|整理|有哪些/.test(question)) return "deepseek";
  if (/漏洞|質疑|反例|吐槽|不同意|有問題/.test(question)) return "terra";
  if (/考場|擬答|統整|結論|怎麼寫|校準/.test(question)) return "sol";
  return "luna";
}

function chooseFreeSpeaker(messages: ChatMessage[]): Member {
  const last = [...messages]
    .reverse()
    .find((message) => /^(Luna|DeepSeek|Terra|Sol)$/i.test(message.speaker))
    ?.speaker.toLowerCase() as Member | undefined;
  if (last === "luna") return "deepseek";
  if (last === "deepseek") return "terra";
  if (last === "terra") return "luna";
  if (last === "sol") return "terra";
  return "luna";
}

function extractOpenAIText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string")
    return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = Array.isArray((item as { content?: unknown[] }).content)
        ? (item as { content: unknown[] }).content
        : [];
      return content.map((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? String((part as { text: string }).text)
          : "",
      );
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function ask(
  member: Member,
  prompt: string,
  attachment?: { dataUrl: string; name: string; type: "image" | "pdf" },
) {
  const started = Date.now();
  if (member === "deepseek") {
    const key = await getDeepSeekKey();
    if (!key) throw new Error("DeepSeek 尚未設定");
    const model = await getDeepSeekModel("deepseek-v4-pro");
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `${roles.deepseek}\n你可以在確實需要另一位成員接話時，於發言最後點名 @Luna、@Terra 或 @Sol；若要把問題交回真人學生，請在最後寫 @同學。一次最多點名一位，不要為了熱鬧而點名。`,
          },
          { role: "user", content: prompt },
        ],
        max_tokens: /深入補充/.test(prompt) ? 900 : 500,
      }),
    });
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(payload.error?.message || "DeepSeek 暫時無法回應");
    const inputTokens = payload.usage?.prompt_tokens || 0;
    const outputTokens = payload.usage?.completion_tokens || 0;
    return {
      speaker: member,
      text: payload.choices?.[0]?.message?.content?.trim() || "",
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(model, { inputTokens, outputTokens }),
      durationMs: Date.now() - started,
    };
  }
  const key = await getOpenAIKey();
  if (!key) throw new Error("OpenAI 尚未設定");
  const model =
    member === "sol"
      ? "gpt-5.6-sol"
      : member === "terra"
        ? "gpt-5.6-terra"
        : "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
        instructions: `${roles[member]}\n你是讀書會成員，不是主持人。每次發言控制在 220 字內。不得假裝查過未提供的教材或判決。你可以在確實需要另一位成員接話時，於發言最後點名 @Luna、@DeepSeek、@Terra 或 @Sol；若要把問題交回真人學生，請在最後寫 @同學。一次最多點名一位，不要為了熱鬧而點名。只輸出純文字與自然換行，不得使用 Markdown 的井號、星號、反引號或表格符號。`,
      input: attachment
        ? [{
            role: "user",
            content: [
              ...(attachment.type === "pdf"
                ? [{ type: "input_file", filename: attachment.name || "讀書會附件.pdf", file_data: attachment.dataUrl }]
                : [{ type: "input_image", image_url: attachment.dataUrl, detail: "high" }]),
              { type: "input_text", text: prompt },
            ],
          }]
        : prompt,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown> & {
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(payload.error?.message || `${member} 暫時無法回應`);
  const inputTokens = payload.usage?.input_tokens || 0;
  const outputTokens = payload.usage?.output_tokens || 0;
  return {
    speaker: member,
    text: extractOpenAIText(payload),
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(model, { inputTokens, outputTokens }),
    durationMs: Date.now() - started,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: string;
      target?: Member | "host" | "free";
      mood?: Mood;
      topic?: string;
      messages?: ChatMessage[];
      imageDataUrl?: string;
      attachmentDataUrl?: string;
      attachmentName?: string;
      attachmentType?: "image" | "pdf";
      attachmentTask?: "issues" | "summary" | "discuss";
      action?: "reply" | "simulate-student";
      studentLevel?: StudentLevel;
    };
    if (body.action === "simulate-student") {
      const latest = [...(body.messages || [])]
        .reverse()
        .find((item) => /^(Luna|DeepSeek|Terra|Sol)$/i.test(item.speaker));
      if (!latest?.text?.trim()) {
        return Response.json({ error: "目前還沒有可承接的成員發言" }, { status: 400 });
      }
      const level = body.studentLevel || "beginner";
      const levelInstruction: Record<StudentLevel, string> = {
        beginner:
          "你是剛入門但有認真聽的學生。先用自己的白話說出你從上一位成員聽懂的一個具體重點，再指出一個具體卡住之處或用簡單例子確認。不得只說『我不懂』，不得使用任何題目都能套用的萬用問句。",
        intermediate:
          "你是已有基礎的考生。先用自己的話整理上一位成員的論證順序或判斷步驟，再針對其中一個具體要件、涵攝連結或邊界情形提出追問。必須提到上一則發言中的實質法律概念。",
        advanced:
          "你是成熟且有禮貌的高階考生。先準確確認你理解到的命題，再以『如果遇到……，這個判準是否仍成立』或『是否還要區分……』的方式延伸適用邊界。不得使用質疑、漏洞、過窄、論證不足、請回應我的質疑等審問語氣，也不要點名其他 AI。",
      };
      const suggestion = await ask(
        "luna",
        `請代擬真人學生在讀書會中的下一句話。\n學生程度要求：${levelInstruction[level]}\n\n上一位發言者：${latest.speaker}\n上一則發言：${latest.text}\n\n只輸出學生真正會說的一段話，45 至 110 字；不複製整段原文，不加角色標籤，不命令其他成員接力。`,
      );
      return Response.json({ suggestion: suggestion.text });
    }
    const question = body.question?.trim() || "";
    if (!question)
      return Response.json({ error: "請先輸入想討論的內容" }, { status: 400 });
    const attachment = body.attachmentDataUrl
      ? {
          dataUrl: body.attachmentDataUrl,
          name: body.attachmentName || (body.attachmentType === "pdf" ? "讀書會附件.pdf" : "讀書會圖片"),
          type: (body.attachmentType || "image") as "image" | "pdf",
        }
      : body.imageDataUrl
        ? { dataUrl: body.imageDataUrl, name: "讀書會圖片", type: "image" as const }
        : undefined;
    const attachmentInstruction = attachment?.type === "pdf"
      ? `\n附件任務：${body.attachmentTask === "summary" ? "摘要整份 PDF，保留重要事實、法律依據與結論" : body.attachmentTask === "discuss" ? "依學生指定的問題討論 PDF 內容，先釐清再引導判斷" : "辨識 PDF 中值得討論的法律爭點、判準與可能分歧"}。引用附件內容時請標示可確認的 PDF 頁碼；若是掃描頁或頁碼無法確認，必須明說，不得猜測。`
      : attachment
        ? "\n請先忠實辨識圖片或截圖中的內容，再回答；看不清楚的文字必須明說。"
        : "";
    const history = (body.messages || [])
      .slice(-10)
      .map((item) => `${item.speaker}：${item.text}`)
      .join("\n");
    const named = question
      .match(/@(Luna|DeepSeek|Terra|Sol)/i)?.[1]
      ?.toLowerCase() as Member | undefined;
    const first =
      named ||
      (body.target && !["host", "free"].includes(body.target)
        ? (body.target as Member)
        : body.target === "free"
          ? chooseFreeSpeaker(body.messages || [])
          : chooseSpeaker(question));
    const prompt = `本次主題：${body.topic || "依學生今日學習目標討論"}\n先前對話：\n${history || "尚未發言"}\n\n學生現在說：${question}${attachmentInstruction}\n請直接接續聊天室對話，不要自稱 AI。`;
    let firstPrompt = prompt;
    if (attachment && first === "deepseek") {
      const visual = await ask(
        "luna",
        attachment.type === "pdf"
          ? "請先讀取這份 PDF，依頁碼整理與學生問題直接相關的內容、事實與法律問題，供另一位讀書會成員接續；無法辨識處要明說。"
          : "請只描述圖片中可辨識的事實、文字與法律問題，不要先下結論。",
        attachment,
      );
      firstPrompt += `\n\nLuna 先替你讀取附件如下：${visual.text}`;
    }
    const replies = [await ask(first, firstPrompt, first === "deepseek" ? undefined : attachment)];
    const spoken = new Set<Member>([first]);
    const maxReplies = body.mood === "quiet" ? 1 : body.mood === "lively" ? 3 : 2;
    while (replies.length < maxReplies) {
      const last = replies[replies.length - 1];
      if (/@同學/.test(last.text)) break;
      const tagged = last.text
        .match(/@(Luna|DeepSeek|Terra|Sol)/i)?.[1]
        ?.toLowerCase() as Member | undefined;
      let next: Member | null = tagged && !spoken.has(tagged) ? tagged : null;
      if (!next && replies.length === 1) {
        if (body.target === "free" || body.mood === "lively") {
          next =
            first === "luna"
              ? "deepseek"
              : first === "deepseek"
                ? "terra"
                : first === "terra"
                  ? "luna"
                  : "terra";
        } else if (/錯|但是|不同意|漏洞|遺漏|不確定|另一種/.test(last.text)) {
          next = first === "terra" ? "luna" : "terra";
        }
      }
      if (!next && body.mood === "lively" && !spoken.has("sol")) next = "sol";
      if (!next || spoken.has(next)) break;
      const reason = tagged
        ? `${last.speaker} 剛才在發言中直接點名你，請自然回應他的問題或邀請。`
        : next === "terra"
          ? `你主動發現前一則推論有值得檢查之處。請只提出一個具學習價值的質疑，並說明你在回應誰。`
          : next === "sol"
            ? "討論已進入第二輪，請簡短校準並收束，不要重複前文。"
            : "你認為自己能補上前一則尚未說清楚的重點，請自然接話，不要重複。";
      const recent = replies.map((reply) => `${reply.speaker}：${reply.text}`).join("\n");
      replies.push(await ask(next, `${prompt}\n\n本輪最新對話：\n${recent}\n${reason}`));
      spoken.add(next);
    }
    return Response.json({ assigned: first, replies });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "讀書會暫時無法回應" },
      { status: 500 },
    );
  }
}
