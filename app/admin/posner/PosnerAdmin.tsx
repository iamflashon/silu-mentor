"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Course = {
  id: number;
  title: string;
  subject: string;
  creator: string;
  description: string;
  status: string;
  accessType: string;
  sourceUrl: string;
  hasCover: string | null;
  price: number;
  accessDays: number;
  previewStartSeconds: number;
  previewDurationSeconds: number;
  salesEnabled: boolean;
  hlsReady: boolean;
  subtitleReady: boolean;
  summaryReady: boolean;
  mediaMessage: string;
};
type Draft = {
  title: string;
  subject: string;
  creator: string;
  description: string;
  published: boolean;
  price: number;
  accessDays: number;
  previewStartSeconds: number;
  previewDurationSeconds: number;
  salesEnabled: boolean;
};
const empty: Draft = {
  title: "",
  subject: "主題講座",
  creator: "陳友心",
  description: "",
  published: false,
  price: 0,
  accessDays: 365,
  previewStartSeconds: 0,
  previewDurationSeconds: 300,
  salesEnabled: false,
};
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const secondsFrom = (v: string) => {
  const p = v.split(":").map(Number);
  return p.length === 2 && p.every(Number.isFinite)
    ? Math.max(0, Math.floor(p[0] * 60 + p[1]))
    : Math.max(0, Math.floor(Number(v) || 0));
};

export default function PosnerAdmin() {
  const [courses, setCourses] = useState<Course[]>([]),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [draft, setDraft] = useState<Draft>(empty),
    [file, setFile] = useState<File | null>(null),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [linePay, setLinePay] = useState({
      environment: "sandbox",
      configured: false,
    }),
    [voucher, setVoucher] = useState("");
  const selected = useMemo(
    () => courses.find((x) => x.id === selectedId) ?? null,
    [courses, selectedId],
  );
  async function load() {
    const r = await fetch("/api/admin/posner-courses", { cache: "no-store" }),
      d = (await r.json()) as {
        courses?: Course[];
        linePay?: { environment: string; configured: boolean };
        error?: string;
      };
    if (!r.ok) throw new Error(d.error || "無法讀取影音課程");
    setCourses(d.courses ?? []);
    if (d.linePay) setLinePay(d.linePay);
  }
  useEffect(() => {
    void load().catch((e) =>
      setNotice(e instanceof Error ? e.message : "讀取失敗"),
    );
  }, []);
  function choose(c: Course) {
    setSelectedId(c.id);
    setDraft({
      title: c.title,
      subject: c.subject,
      creator: c.creator || "陳友心",
      description: c.description,
      published: c.accessType === "posner" && c.status === "active",
      price: c.price,
      accessDays: c.accessDays,
      previewStartSeconds: c.previewStartSeconds,
      previewDurationSeconds: c.previewDurationSeconds,
      salesEnabled: c.salesEnabled,
    });
    setFile(null);
    setVoucher("");
    setNotice("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setNotice("");
    try {
      const r = await fetch("/api/admin/posner-courses", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: selectedId, ...draft }),
        }),
        d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error || "儲存失敗");
      if (file) {
        const f = new FormData();
        f.set("id", String(selectedId));
        f.set("file", file);
        const u = await fetch("/api/admin/posner-courses", {
            method: "POST",
            body: f,
          }),
          x = (await u.json()) as { error?: string };
        if (!u.ok) throw new Error(x.error || "縮圖上傳失敗");
      }
      await load();
      setFile(null);
      setNotice(
        draft.published
          ? "已儲存並發布到波斯納前台。"
          : "已儲存為草稿，前台不會顯示。",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }
  async function recommend() {
    if (!selectedId) return;
    const r = await fetch("/api/admin/posner-courses", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selectedId, action: "recommend-preview" }),
      }),
      d = (await r.json()) as {
        startSeconds?: number;
        title?: string;
        error?: string;
      };
    if (r.ok && d.startSeconds != null) {
      setDraft({ ...draft, previewStartSeconds: d.startSeconds });
      setNotice(
        `AI 建議從 ${mmss(d.startSeconds)}「${d.title}」開始試看，儲存後生效。`,
      );
    } else setNotice(d.error || "目前無法推薦");
  }
  async function createVoucher() {
    if (!selectedId) return;
    const r = await fetch("/api/admin/posner-courses", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          action: "create-voucher",
          accessDays: draft.accessDays,
        }),
      }),
      d = (await r.json()) as { code?: string; error?: string };
    if (r.ok && d.code) {
      setVoucher(d.code);
      setNotice("已建立一組一次性兌換碼。");
    } else setNotice(d.error || "兌換碼建立失敗");
  }
  return (
    <main className="posner-admin">
      <header>
        <div>
          <span>POSNER VIDEO STUDIO</span>
          <h1>波斯納影音課程</h1>
          <p>整理課程內容、試看片段、售價與觀看期限。</p>
        </div>
        <a href="/posner">查看前台</a>
      </header>
      <div className="posner-admin-workspace">
        <aside>
          <h2>影音素材</h2>
          <p>原始檔名只在後台顯示。</p>
          <div className="posner-admin-list">
            {courses.map((c) => (
              <button
                type="button"
                className={selectedId === c.id ? "active" : ""}
                key={c.id}
                onClick={() => choose(c)}
              >
                <span>
                  {c.hlsReady
                    ? c.summaryReady
                      ? "影片、字幕與摘要已完成"
                      : c.subtitleReady
                        ? "字幕完成・摘要處理中"
                        : "影片可看・字幕處理中"
                    : "影片處理中"}
                </span>
                <b>{c.title}</b>
                <small>
                  {c.creator || "尚未設定講師"} ·{" "}
                  {c.accessType === "posner" && c.status === "active"
                    ? "前台已發布"
                    : "草稿"}
                </small>
              </button>
            ))}
          </div>
        </aside>
        <section className="posner-admin-editor">
          {selected ? (
            <form onSubmit={save}>
              <div className="posner-admin-preview">
                <div className="posner-admin-cover">
                  {selected.hasCover ? (
                    <img
                      src={`/api/resources/cover?id=${selected.id}`}
                      alt="目前課程縮圖"
                    />
                  ) : (
                    <span>尚未上傳縮圖</span>
                  )}
                </div>
                <div>
                  <small>前台卡片預覽</small>
                  <b>{draft.title || "課程名稱"}</b>
                  <span>
                    {draft.creator || "講師姓名"} ·{" "}
                    {draft.subject || "課程分類"}
                  </span>
                  <small>
                    HLS：{selected.hlsReady ? "完成" : "處理中"}　SRT：
                    {selected.subtitleReady ? "完成" : "等待中"}　AI 摘要：
                    {selected.summaryReady ? "完成" : "等待中"}
                  </small>
                </div>
              </div>
              <div className="posner-admin-fields">
                <label className="wide">
                  課程名稱
                  <input
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  講師
                  <input
                    value={draft.creator}
                    onChange={(e) =>
                      setDraft({ ...draft, creator: e.target.value })
                    }
                  />
                </label>
                <label>
                  課程分類
                  <input
                    value={draft.subject}
                    onChange={(e) =>
                      setDraft({ ...draft, subject: e.target.value })
                    }
                  />
                </label>
                <label className="wide">
                  課程說明
                  <textarea
                    rows={6}
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  售價（新台幣）
                  <input
                    type="number"
                    min="0"
                    value={draft.price}
                    onChange={(e) =>
                      setDraft({ ...draft, price: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  購買／兌換後可看天數
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    value={draft.accessDays}
                    onChange={(e) =>
                      setDraft({ ...draft, accessDays: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  精彩片段開始（分:秒）
                  <input
                    value={mmss(draft.previewStartSeconds)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        previewStartSeconds: secondsFrom(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  試看片長（秒）
                  <input
                    type="number"
                    min="0"
                    max="7200"
                    value={draft.previewDurationSeconds}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        previewDurationSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <div className="wide posner-admin-inline">
                  <button type="button" onClick={() => void recommend()}>
                    AI 推薦試看片段
                  </button>
                  <span>
                    目前：{mmss(draft.previewStartSeconds)} 起，試看{" "}
                    {Math.floor(draft.previewDurationSeconds / 60)} 分{" "}
                    {draft.previewDurationSeconds % 60} 秒
                  </span>
                </div>
                <label className="wide file">
                  課程縮圖
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <span>{file?.name || "建議使用 16:9 圖片"}</span>
                </label>
              </div>
              <div className="posner-commerce-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.salesEnabled}
                    onChange={(e) =>
                      setDraft({ ...draft, salesEnabled: e.target.checked })
                    }
                  />
                  <span>
                    <b>開放 LINE Pay 購買</b>
                    <small>
                      {linePay.configured
                        ? `LINE Pay ${linePay.environment === "sandbox" ? "Sandbox 測試" : "正式環境"}已連線`
                        : "尚未設定 LINE Pay Channel ID／Secret"}
                    </small>
                  </span>
                </label>
                <div>
                  <button type="button" onClick={() => void createVoucher()}>
                    產生一次性兌換碼
                  </button>
                  {voucher && <output>{voucher}</output>}
                </div>
              </div>
              <label className="posner-publish-check">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) =>
                    setDraft({ ...draft, published: e.target.checked })
                  }
                />
                <span>
                  <b>發布到波斯納前台</b>
                  <small>關閉時只儲存草稿，學生看不到。</small>
                </span>
              </label>
              <div className="posner-admin-actions">
                <span role="status">{notice || selected.mediaMessage}</span>
                <button
                  disabled={
                    saving ||
                    !draft.title.trim() ||
                    (draft.published && !selected.hlsReady)
                  }
                >
                  {saving
                    ? "儲存中…"
                    : draft.published
                      ? "儲存並發布"
                      : "儲存草稿"}
                </button>
              </div>
            </form>
          ) : (
            <div className="posner-admin-empty">
              <b>選擇一支影音素材</b>
              <span>即可設定課程資料、售價與精彩試看片段。</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
