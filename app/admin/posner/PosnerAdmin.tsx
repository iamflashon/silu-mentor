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
type SubtitleSegment = { id:number; title:string; startSeconds:number; endSeconds:number; text:string; summary:string; importance:number; recommended:boolean; reviewStatus:string; sequence:number };
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
  const [segments,setSegments]=useState<SubtitleSegment[]>([]),
    [segmentsOpen,setSegmentsOpen]=useState(false),
    [segmentsLoading,setSegmentsLoading]=useState(false),
    [digesting,setDigesting]=useState(false),
    [segmentSaving,setSegmentSaving]=useState<number|null>(null);
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
    setSegments([]);
    setSegmentsOpen(false);
  }
  async function loadSegments(){
    if(!selectedId)return;
    setSegmentsOpen(true);setSegmentsLoading(true);setNotice("");
    try{const r=await fetch(`/api/admin/posner-courses?resourceId=${selectedId}`,{cache:"no-store"}),d=await r.json() as {segments?:SubtitleSegment[];error?:string};if(!r.ok)throw new Error(d.error||"讀取字幕失敗");setSegments(d.segments??[]);}catch(e){setNotice(e instanceof Error?e.message:"讀取字幕失敗");}finally{setSegmentsLoading(false);}
  }
  function updateSegment(id:number,values:Partial<SubtitleSegment>){setSegments(current=>current.map(item=>item.id===id?{...item,...values}:item));}
  async function saveSegment(segment:SubtitleSegment){
    if(!selectedId)return;setSegmentSaving(segment.id);setNotice("");
    try{const r=await fetch("/api/admin/posner-courses",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:selectedId,action:"update-segment",segmentId:segment.id,startSeconds:segment.startSeconds,endSeconds:segment.endSeconds,text:segment.text,summary:segment.summary,recommended:segment.recommended})}),d=await r.json() as {segment?:SubtitleSegment;error?:string};if(!r.ok)throw new Error(d.error||"儲存字幕失敗");if(d.segment)updateSegment(segment.id,d.segment);setNotice(`已儲存 ${mmss(segment.startSeconds)} 的字幕與摘要。`);}catch(e){setNotice(e instanceof Error?e.message:"儲存字幕失敗");}finally{setSegmentSaving(null);}
  }
  async function generateDigest(){
    if(!selectedId)return;
    setDigesting(true);setNotice("AI 正在閱讀整堂課字幕並整理重點，請稍候…");
    try{
      const r=await fetch("/api/resources/segments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resourceId:selectedId,action:"digest"})});
      const d=await r.json() as {digestCount?:number;analyzed?:number;error?:string};
      if(!r.ok)throw new Error(d.error||"AI 重點摘要產生失敗");
      await Promise.all([loadSegments(),load()]);
      setNotice(`AI 已完成 ${d.digestCount??d.analyzed??0} 個課程重點；你可以逐段校對後再發布。`);
    }catch(e){setNotice(e instanceof Error?e.message:"AI 重點摘要產生失敗");}
    finally{setDigesting(false);}
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
              <section className="posner-subtitle-editor">
                <header><div><b>字幕與 AI 重點摘要</b><span>SRT 完成後由 AI 先整理整堂課重點，你再校對文字、時間與前台推薦。</span></div><div><button type="button" onClick={()=>void generateDigest()} disabled={!selected.subtitleReady||digesting}>{digesting?"AI 產生中…":selected.summaryReady?"重新產生 AI 摘要":"AI 產生重點摘要"}</button><button type="button" onClick={()=>segmentsOpen?setSegmentsOpen(false):void loadSegments()} disabled={!selected.subtitleReady}>{segmentsOpen?"收合編輯器":selected.subtitleReady?"查看／編修":"字幕尚未完成"}</button></div></header>
                {segmentsOpen&&<div className="posner-subtitle-body">{segmentsLoading?<p>正在讀取字幕…</p>:segments.length?segments.map(segment=><article key={segment.id} className={segment.recommended?"recommended":""}>
                  <div className="posner-subtitle-time"><label>開始（秒）<input type="number" min="0" value={segment.startSeconds??0} onChange={e=>updateSegment(segment.id,{startSeconds:Number(e.target.value)})}/></label><label>結束（秒）<input type="number" min="0" value={segment.endSeconds??0} onChange={e=>updateSegment(segment.id,{endSeconds:Number(e.target.value)})}/></label><span>{mmss(segment.startSeconds??0)}－{mmss(segment.endSeconds??0)}</span></div>
                  <label>字幕原文<textarea rows={4} value={segment.text??""} onChange={e=>updateSegment(segment.id,{text:e.target.value})}/></label>
                  <label>AI 重點摘要<textarea rows={3} value={segment.summary??""} placeholder="按上方「AI 產生重點摘要」後會自動填入；你可以再校對修改" onChange={e=>updateSegment(segment.id,{summary:e.target.value})}/></label>
                  <footer><label><input type="checkbox" checked={Boolean(segment.recommended)} onChange={e=>updateSegment(segment.id,{recommended:e.target.checked})}/>列為推薦重點</label><button type="button" onClick={()=>void saveSegment(segment)} disabled={segmentSaving===segment.id}>{segmentSaving===segment.id?"儲存中…":"儲存這一段"}</button></footer>
                </article>):<p>目前尚無可編修的字幕段落，請稍後重新開啟。</p>}</div>}
              </section>
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
