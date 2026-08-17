"use client";

import { useEffect, useMemo, useState } from "react";
import { unzipSync } from "fflate";
import "./medtech-audio-import.css";

type AudioInfo = { id: number; audioFileName: string | null; status: string; updatedAt: string | Date };
type Question = { id: number; year: string; subject: string; questionNumber: string; stem: string; explanation: string; correctAnswer: string | null; audio: AudioInfo | null };
type Mapping = {
  file: File;
  audio: File | null;
  subtitle: File | null;
  questionId: number | null;
  question: Question | null;
  reason: string;
  status: "matched" | "unmatched" | "duplicate";
};

const AUDIO_EXT = /\.(?:mp3|m4a|wav|ogg|aac|webm)$/iu;
const SUBTITLE_EXT = /\.srt$/iu;

function baseName(name: string) {
  return name.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, "") ?? name;
}
function questionNumber(value: string) {
  return String(value).replace(/^0+/u, "") || "0";
}
function mime(name: string) {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "m4a" ? "audio/mp4" : ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : ext === "aac" ? "audio/aac" : ext === "webm" ? "audio/webm" : "audio/mpeg";
}
function short(value: string) {
  return value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

export default function MedtechAudioImport() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const response = await fetch("/api/medtech/admin/audio-import", { cache: "no-store" });
    const data = (await response.json()) as { items?: Question[]; error?: string };
    if (response.ok) setQuestions(data.items ?? []);
    else setNotice(data.error ?? "題庫讀取失敗");
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  const visibleQuestions = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-Hant");
    return keyword
      ? questions.filter((item) =>
          (item.year + " " + item.subject + " " + item.questionNumber + " " + short(item.stem))
            .toLocaleLowerCase("zh-Hant")
            .includes(keyword),
        )
      : questions;
  }, [questions, search]);

  function matchBundle(bundle: { file: File; audio: File | null; subtitle: File | null }, seen: Set<number>): Mapping {
    const name = baseName(bundle.file.name);
    // A bare Q001 is the package sequence; q123 after an explicit prefix is an internal question ID.
    const qId = name.match(/[_\-]q(?:uestion)?[_\-\s]?(\d+)(?:$|[_\-\s])/iu)?.[1];
    const bareQNumber = name.match(/^q(?:uestion)?[_\-\s]?(\d+)(?:[_\-\s].*)?$/iu)?.[1];
    let candidates = qId ? questions.filter((item) => item.id === Number(qId)) : [];
    let reason = qId ? "q" + qId : "題號推測";
    if (!candidates.length) {
      const number = name.match(/第\s*(\d+)\s*題/iu)?.[1] ?? bareQNumber ?? name.match(/(?:^|[_\-\s])0*(\d{1,3})(?:$|[_\-\s])/u)?.[1];
      if (number) {
        const normalized = questionNumber(number);
        candidates = questions.filter((item) => questionNumber(item.questionNumber) === normalized);
        reason = "第" + normalized + "題";
      }
    }
    if (candidates.length !== 1) {
      return {
        file: bundle.file,
        audio: bundle.audio,
        subtitle: bundle.subtitle,
        questionId: null,
        question: null,
        reason: candidates.length > 1 ? reason + "對應到 " + candidates.length + " 題" : "檔名沒有可驗證的題目 ID／題號",
        status: "unmatched",
      };
    }
    const question = candidates[0];
    if (seen.has(question.id)) {
      return { file: bundle.file, audio: bundle.audio, subtitle: bundle.subtitle, questionId: question.id, question, reason: "同一道題目已有另一組音檔／SRT", status: "duplicate" };
    }
    seen.add(question.id);
    return { file: bundle.file, audio: bundle.audio, subtitle: bundle.subtitle, questionId: question.id, question, reason, status: "matched" };
  }

  async function expandFiles(selected: File[]) {
    const bundles = new Map<string, { file: File; audio: File | null; subtitle: File | null }>();
    const collect = (file: File) => {
      if (!AUDIO_EXT.test(file.name) && !SUBTITLE_EXT.test(file.name)) return;
      const key = baseName(file.name).toLocaleLowerCase("zh-Hant");
      const current = bundles.get(key) ?? { file, audio: null, subtitle: null };
      current.file = current.audio ?? current.subtitle ?? file;
      if (AUDIO_EXT.test(file.name)) current.audio = current.audio ?? file;
      if (SUBTITLE_EXT.test(file.name)) current.subtitle = current.subtitle ?? file;
      bundles.set(key, current);
    };
    for (const file of selected) {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        collect(file);
        continue;
      }
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        for (const [path, bytes] of Object.entries(entries)) {
          const name = path.split("/").pop() ?? "";
          if (!name || path.split("/").some((part) => part.startsWith("."))) continue;
          if (!AUDIO_EXT.test(name) && !SUBTITLE_EXT.test(name)) continue;
          collect(new File([new Uint8Array(bytes)], name, { type: SUBTITLE_EXT.test(name) ? "application/x-subrip" : mime(name) }));
        }
      } catch {
        setNotice("ZIP「" + file.name + "」無法解壓，請確認檔案未加密且沒有損壞。");
      }
    }
    const seen = new Set<number>();
    const expanded = [...bundles.values()];
    setMappings(expanded.slice(0, 160).map((bundle) => matchBundle(bundle, seen)));
    if (expanded.length > 160) setNotice("已讀取前 160 組音檔／SRT；請分批匯入其餘檔案。");
    else setNotice(expanded.length ? "已讀取 " + expanded.length + " 組檔案，會以同檔名配對音檔與 SRT，請確認題目對應。" : "ZIP 內找不到支援的音檔或 SRT。");
  }

  async function importMatched() {
    const matched = mappings.filter((item) => item.status === "matched" && item.questionId);
    if (!matched.length) {
      setNotice("目前沒有可匯入的已配對音檔／SRT。");
      return;
    }
    setBusy(true);
    setNotice("正在匯入 " + matched.length + " 組語音資料…");
    const form = new FormData();
    for (const item of matched) {
      if (item.audio) {
        form.append("audioQuestionId", String(item.questionId));
        form.append("audio", item.audio, item.audio.name);
      }
      if (item.subtitle) {
        form.append("subtitleQuestionId", String(item.questionId));
        form.append("subtitle", item.subtitle, item.subtitle.name);
      }
    }
    const response = await fetch("/api/medtech/admin/audio-import", { method: "POST", body: form });
    const data = (await response.json()) as { imported?: number; importedAudio?: number; importedSubtitles?: number; error?: string };
    if (response.ok) {
      setNotice("已匯入 " + (data.importedAudio ?? 0) + " 段音檔、" + (data.importedSubtitles ?? 0) + " 個 SRT，已依 qID／題號綁定。");
      setMappings([]);
      await load();
    } else {
      setNotice(data.error ?? "音檔／SRT 匯入失敗，未完成本批次變更。");
    }
    setBusy(false);
  }

  const matchedCount = mappings.filter((item) => item.status === "matched").length;
  const unmatchedCount = mappings.filter((item) => item.status !== "matched").length;
  const audioCount = questions.filter((item) => item.audio?.audioFileName).length;
  return (
    <>
      <section className="medtech-admin-panel medtech-audio-intro">
        <div>
          <span>醫檢師 · 語音配對中心</span>
          <h2>錄音與字幕完成後，一次匯入並自動綁定題庫</h2>
          <p>可將同一組檔名的 MP3／M4A 與 SRT 放在同一個 ZIP。系統優先使用 q題目ID，沒有 qID 時才嘗試唯一題號。</p>
        </div>
        <div className="audio-stat">
          <b>{audioCount}</b>
          <small>題已有音檔</small>
        </div>
      </section>
      <section className="medtech-admin-panel">
        <div className="medtech-audio-upload-head">
          <div>
            <h2>批次匯入音檔／SRT</h2>
            <p>可選取多個檔案，或直接選擇包含音檔與 SRT 的 ZIP；系統會忽略資料夾、隱藏檔與其他格式。</p>
          </div>
          <label className="audio-file-picker">
            <input
              type="file"
              multiple
              accept=".zip,.srt,audio/*,.mp3,.m4a,.wav,.ogg,.aac,.webm"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                if (selected.length) void expandFiles(selected);
              }}
            />
            選擇音檔／SRT／ZIP
          </label>
        </div>
        {notice && <p className="medtech-admin-notice">{notice}</p>}
        {mappings.length > 0 && (
          <>
            <div className="audio-mapping-summary">
              <span className="ok">可匯入 {matchedCount} 組</span>
              <span className={unmatchedCount ? "warn" : "muted"}>待確認 {unmatchedCount} 組</span>
              <button disabled={busy || !matchedCount} onClick={() => void importMatched()}>
                {busy ? "匯入中…" : "確認匯入 " + matchedCount + " 組"}
              </button>
            </div>
            <div className="audio-mapping-list">
              {mappings.map((item, index) => (
                <article className={item.status} key={item.file.name + "-" + index}>
                  <div>
                    <b>{item.file.name}</b>
                    <small>{item.audio ? "音檔 ✓" : "無音檔"} · {item.subtitle ? "SRT ✓" : "無 SRT"}</small>
                  </div>
                  <div>
                    {item.question ? (
                      <>
                        <strong>{item.question.subject} · {item.question.year} · 第 {item.question.questionNumber} 題</strong>
                        <span>{short(item.question.stem).slice(0, 100)}</span>
                      </>
                    ) : (
                      <strong>尚未配對題目</strong>
                    )}
                    <small>{item.reason}</small>
                  </div>
                  <i>{item.status === "matched" ? "可匯入" : item.status === "duplicate" ? "重複" : "待確認"}</i>
                </article>
              ))}
            </div>
          </>
        )}
        {!mappings.length && (
          <div className="audio-import-empty">
            <b>尚未選擇錄音檔或 SRT</b>
            <span>建議使用「001_q123_第1題.mp3」與同名「001_q123_第1題.srt」，q123 會直接對應題庫內部題目 ID。</span>
          </div>
        )}
      </section>
      <section className="medtech-admin-panel medtech-audio-question-panel">
        <div className="medtech-audio-question-head">
          <div>
            <h2>題庫配對檢查</h2>
            <p>可搜尋年份、科目或題號，確認哪些題目已有錄音。</p>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋題號、科目或題幹" />
        </div>
        {loading ? (
          <p>正在讀取題庫…</p>
        ) : (
          <div className="audio-question-list">
            {visibleQuestions.slice(0, 240).map((item) => (
              <article key={item.id}>
                <span className={item.audio?.audioFileName ? "has-audio" : "no-audio"}>{item.audio?.audioFileName ? "已配對" : "待錄製"}</span>
                <div>
                  <b>{item.subject} · {item.year} · 第 {item.questionNumber} 題</b>
                  <small>q{item.id} · {short(item.stem).slice(0, 130)}</small>
                </div>
                <em>{item.audio?.audioFileName || "—"}</em>
              </article>
            ))}
            {visibleQuestions.length > 240 && <p>目前顯示前 240 題，請用搜尋縮小範圍。</p>}
            {!visibleQuestions.length && <p>找不到符合條件的題目。</p>}
          </div>
        )}
      </section>
    </>
  );
}
