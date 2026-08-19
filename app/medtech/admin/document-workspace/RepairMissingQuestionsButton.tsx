"use client";

import { unzipSync } from "fflate";
import { useRef, useState } from "react";

const ZIP_DIRECT_UPLOAD_THRESHOLD = 24 * 1024 * 1024;
const DIRECT_UPLOAD_BATCH_BYTES = 12 * 1024 * 1024;
const AUDIO_EXT = /\.(?:mp3|m4a|wav|ogg|aac|webm)$/iu;
const SUBTITLE_EXT = /\.srt$/iu;

type VoicePair = {
  questionId: number;
  sourceOrder?: number;
  audio?: File;
  subtitle?: File;
};

function audioMime(name: string) {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "m4a" ? "audio/mp4"
    : extension === "wav" ? "audio/wav"
      : extension === "ogg" ? "audio/ogg"
        : extension === "aac" ? "audio/aac"
          : extension === "webm" ? "audio/webm"
            : "audio/mpeg";
}

function qidFromName(name: string) {
  const match = name.match(/[_\-]q(?:uestion)?[_\-\s]?(\d+)(?:$|[_\-\s])/iu);
  return match ? Number(match[1]) : 0;
}

function sourceOrderFromName(name: string) {
  const bareQ = name.match(/^q(?:uestion)?[_\-\s]?(\d+)(?:[_\-\s].*)?$/iu)?.[1];
  const prefixed = name.match(/^(?:0*)(\d{1,4})(?:[_-])/u)?.[1];
  return Number(bareQ || prefixed || 0);
}

function basename(name: string) {
  return name.replace(/\\/gu, "/").split("/").pop() ?? name;
}

async function expandLargeVoiceZip(file: File) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const groups = new Map<string, VoicePair>();
  for (const [entryPath, bytes] of Object.entries(entries)) {
    const name = basename(entryPath);
    if (!name || !bytes.length || /(?:^|\/)__macosx(?:\/|$)/iu.test(entryPath) || entryPath.split("/").some((part) => part.startsWith("."))) continue;
    const audio = AUDIO_EXT.test(name);
    const subtitle = SUBTITLE_EXT.test(name);
    if (!audio && !subtitle) continue;
    const questionId = qidFromName(name);
    const sourceOrder = sourceOrderFromName(name);
    if (!questionId && !sourceOrder) throw new Error(`大型 ZIP 的檔名缺少 q題目ID 或題目順序：${name}`);
    const key = name.replace(/\.[^.]+$/u, "").toLocaleLowerCase("zh-Hant");
    const current = groups.get(key) ?? { questionId, sourceOrder };
    if (current.questionId && questionId && current.questionId !== questionId) throw new Error(`同一組檔名的 q題目ID 不一致：${name}`);
    if (current.sourceOrder && sourceOrder && current.sourceOrder !== sourceOrder) throw new Error(`同一組檔名的題目順序不一致：${name}`);
    const copied = new File([new Uint8Array(bytes)], name, { type: audio ? audioMime(name) : "application/x-subrip" });
    if (audio && !current.audio) current.audio = copied;
    if (subtitle && !current.subtitle) current.subtitle = copied;
    groups.set(key, current);
  }
  const pairs = [...groups.values()].filter((pair) => pair.audio || pair.subtitle);
  if (!pairs.length) throw new Error("ZIP 內找不到可匯入的音檔或 SRT 字幕。");
  return pairs;
}

async function resolveVoicePairs(pairs: VoicePair[], documentId: number) {
  const unresolved = pairs.filter((pair) => !pair.questionId);
  if (!unresolved.length) return pairs;
  const response = await fetch(`/api/medtech/admin/audio-import?documentId=${documentId}`, { cache: "no-store" });
  const data = await response.json() as { items?: Array<{ id: number; sourceOrder?: number | null; questionNumber: string }>; error?: string };
  if (!response.ok) throw new Error(data.error || "無法讀取文件題目順序");
  const byOrder = new Map<number, number>();
  const byNumber = new Map<string, number[]>();
  for (const item of data.items ?? []) {
    if (Number(item.sourceOrder) > 0) byOrder.set(Number(item.sourceOrder), item.id);
    const number = String(item.questionNumber ?? "").replace(/^0+/u, "") || "0";
    byNumber.set(number, [...(byNumber.get(number) ?? []), item.id]);
  }
  const resolved = pairs.map((pair) => {
    if (pair.questionId) return pair;
    const number = String(pair.sourceOrder ?? "").replace(/^0+/u, "") || "0";
    const candidates = byNumber.get(number) ?? [];
    return { ...pair, questionId: byOrder.get(pair.sourceOrder ?? 0) ?? (candidates.length === 1 ? candidates[0] : 0) };
  });
  const missing = resolved.filter((pair) => !pair.questionId);
  if (missing.length) throw new Error(`有 ${missing.length} 組語音找不到對應題目，請確認 Q001／題號與原稿順序一致`);
  return resolved;
}

function splitVoicePairs(pairs: VoicePair[]) {
  const batches: VoicePair[][] = [];
  let current: VoicePair[] = [];
  let currentBytes = 0;
  for (const pair of pairs) {
    const pairBytes = (pair.audio?.size ?? 0) + (pair.subtitle?.size ?? 0);
    if (current.length && currentBytes + pairBytes > DIRECT_UPLOAD_BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(pair);
    currentBytes += pairBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function uploadVoicePairs(pairs: VoicePair[]) {
  const batches = splitVoicePairs(pairs);
  let importedAudio = 0;
  let importedSubtitles = 0;
  let completedBatches = 0;
  try {
    for (const batch of batches) {
      const form = new FormData();
      for (const pair of batch) {
        if (pair.audio) {
          form.append("audioQuestionId", String(pair.questionId));
          form.append("audio", pair.audio, pair.audio.name);
        }
        if (pair.subtitle) {
          form.append("subtitleQuestionId", String(pair.questionId));
          form.append("subtitle", pair.subtitle, pair.subtitle.name);
        }
      }
      const response = await fetch("/api/medtech/admin/audio-import", { method: "POST", body: form });
      let data: { error?: string; importedAudio?: number; importedSubtitles?: number } = {};
      try {
        data = await response.json() as typeof data;
      } catch {
        // A failed edge request may not have a JSON response body.
      }
      if (!response.ok) throw new Error(data.error || `第 ${completedBatches + 1} 批匯入失敗`);
      importedAudio += data.importedAudio ?? 0;
      importedSubtitles += data.importedSubtitles ?? 0;
      completedBatches += 1;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知錯誤";
    throw new Error(`已完成 ${completedBatches}/${batches.length} 批；${reason}`);
  }
  return { batches: batches.length, importedAudio, importedSubtitles };
}

export function RepairMissingQuestionsButton({
  documentId,
  disabled,
  onDone,
}: {
  documentId: number;
  disabled?: boolean;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const voiceZipInput = useRef<HTMLInputElement>(null);

  async function repair() {
    if (!confirm("系統會重新讀取這份原稿：把原稿明確標示的答案填入目前空白的老師答案，並補上缺少的題目。已有的老師答案、AI 答案、解析與語音資料都不會覆蓋。確定校對？")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId, repairMissing: true, forceReparse: true }),
      });
      const data = await response.json() as { error?: string; imported?: number; answersUpdated?: number; parsed?: number };
      if (!response.ok) {
        await onDone(data.error || "原稿比對失敗，既有題庫未變更。");
        return;
      }
      const answerMessage = data.answersUpdated ? `已從原稿回填 ${data.answersUpdated} 題老師答案` : "沒有需要回填的空白老師答案";
      const questionMessage = data.imported ? `，另補齊 ${data.imported} 題` : "，沒有新增缺題";
      await onDone(`${answerMessage}${questionMessage}；目前共 ${data.parsed ?? ""} 題。`);
    } catch {
      await onDone("原稿比對失敗，既有題庫未變更。");
    } finally {
      setBusy(false);
    }
  }

  async function uploadVoiceZip(file: File) {
    if (file.size > 360 * 1024 * 1024) {
      await onDone("語音包 ZIP 不可超過 360MB。");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("documentId", String(documentId));
    form.set("zip", file, file.name);
    try {
      if (file.size > ZIP_DIRECT_UPLOAD_THRESHOLD) {
        const pairs = await expandLargeVoiceZip(file);
        const result = await uploadVoicePairs(await resolveVoicePairs(pairs, documentId));
        await onDone(`語音包已自動分 ${result.batches} 批匯入：音檔 ${result.importedAudio} 個，SRT ${result.importedSubtitles} 個`);
        return;
      }
      const response = await fetch("/api/medtech/admin/audio-import", { method: "POST", body: form });
      const data = await response.json() as { error?: string; matched?: number; audioPairs?: number; subtitlePairs?: number; unmatched?: Array<unknown>; invalid?: Array<unknown> };
      if (!response.ok) {
        await onDone(data.error || "語音包匯入失敗。");
        return;
      }
      const unmatched = data.unmatched?.length ? `，未配對 ${data.unmatched.length} 個` : "";
      const invalid = data.invalid?.length ? `，格式問題 ${data.invalid.length} 個` : "";
      await onDone(`語音包匯入完成：配對 ${data.matched ?? 0} 題，音檔 ${data.audioPairs ?? 0} 個，SRT ${data.subtitlePairs ?? 0} 個${unmatched}${invalid}`);
    } catch (error) {
      await onDone(error instanceof Error ? `語音包匯入失敗：${error.message}` : "語音包匯入失敗，請確認 ZIP 未加密且檔名包含 q題目ID。");
    } finally {
      setBusy(false);
      if (voiceZipInput.current) voiceZipInput.current.value = "";
    }
  }

  async function bulkConfirmReview() {
    if (!confirm(`確定將這份文件的全部題目標記為「已完成校對」嗎？這是測試發布用的批次操作，不會自動補老師答案；沒有 A、B、C、D 老師答案的題目仍不能發布。`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medtech/admin/questions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bulkConfirmReview: true, documentId }),
      });
      const data = await response.json() as { updated?: number; unanswered?: number; questionIds?: number[]; error?: string };
      if (response.ok) {
        window.dispatchEvent(new CustomEvent("medtech-bulk-review-updated", {
          detail: { ids: data.questionIds ?? [], unanswered: data.unanswered ?? 0 },
        }));
      }
      const blocked = data.unanswered ? `；仍有 ${data.unanswered} 題沒有 A、B、C、D 老師答案，發布會繼續阻擋` : "；目前可測試發布";
      await onDone(response.ok ? `已將 ${data.updated ?? 0} 題標記為已完成校對${blocked}。` : data.error || "批次校對狀態更新失敗。");
    } catch {
      await onDone("批次校對狀態更新失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return <><button type="button" className="repair-missing-button" disabled={disabled || busy} onClick={() => void repair()}>{busy ? "處理中…" : "校對原稿答案／補缺題"}</button><label className="workspace-zip-upload"><input ref={voiceZipInput} hidden type="file" accept=".zip" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadVoiceZip(file); }} />上傳語音包 ZIP</label><button type="button" className="ai-batch-button" disabled={disabled || busy} onClick={() => void bulkConfirmReview()}>{busy ? "批次校對中…" : "一鍵全部校對完成（測試）"}</button></>;
}
