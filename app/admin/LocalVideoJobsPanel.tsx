"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type InboxFile = { name: string; sizeBytes: number; modifiedAt: number };
type Job = {
  id: string;
  kind: string;
  sourceFile: string;
  status: string;
  message?: string;
  bookTitle?: string;
  creator?: string;
  resourceId?: number;
  durationSeconds?: number;
  segmentCount?: number;
  progressPercent?: number;
  progressStage?: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
};
function timeLabel(value = 0) {
  if (!value) return "";
  const minutes = Math.floor(value / 60),
    seconds = value % 60;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

export default function LocalVideoJobsPanel() {
  const [files, setFiles] = useState<InboxFile[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [sourceFile, setSourceFile] = useState(""),
    [title, setTitle] = useState(""),
    [creator, setCreator] = useState("鄭泓"),
    [subject, setSubject] = useState("中級會計學"),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [retrying, setRetrying] = useState(""),
    [connected, setConnected] = useState(false),
    [version, setVersion] = useState("");
  const load = useCallback(async () => {
    const [nodeResponse, jobsResponse] = await Promise.all([
      fetch("/api/admin/local-node", { cache: "no-store" }),
      fetch("/api/admin/local-node/jobs", { cache: "no-store" }),
    ]);
    if (nodeResponse.ok) {
      const data = (await nodeResponse.json()) as {
        connected?: boolean;
        node?: { version?: string; videoInboxFiles?: InboxFile[] } | null;
      };
      setConnected(Boolean(data.connected));
      setVersion(data.node?.version ?? "");
      setFiles(data.node?.videoInboxFiles ?? []);
    }
    if (jobsResponse.ok) {
      const data = (await jobsResponse.json()) as { jobs?: Job[] };
      setJobs(
        (data.jobs ?? []).filter((job) => job.kind === "transcode_video"),
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  const available = useMemo(
    () =>
      files.filter(
        (file) =>
          !jobs.some(
            (job) =>
              job.sourceFile.toLowerCase() === file.name.toLowerCase() &&
              ["queued", "claimed", "completed"].includes(job.status),
          ),
      ),
    [files, jobs],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/local-node/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "transcode_video",
          sourceFile,
          bookTitle: title || sourceFile.replace(/\.[^.]+$/u, ""),
          creator,
          subject,
          examCategory: "accounting",
          documentType: "影音課程",
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "無法建立影音工作");
      setSourceFile("");
      setTitle("");
      setNotice("已送到 RTX 4090；下方會即時顯示處理進度，原始影片不會上雲。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  }
  async function retry(jobId: string, mode?: "subtitle") {
    setRetrying(jobId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/local-node/jobs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, mode }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "無法重新處理");
      setNotice(mode === "subtitle" ? "已排入字幕／摘要補做佇列；既有影片與 HLS 不會重新轉檔或上傳。" : "已重新加入佇列，本機節點會在下一次輪詢時開始處理。");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重新處理失敗");
    } finally {
      setRetrying("");
    }
  }
  return (
    <section className="panel local-video-jobs-panel">
      <div className="local-video-head">
        <div>
          <p>本機影音處理</p>
          <h2>影片轉檔與上傳</h2>
          <span>
            選擇影片並填寫課程資料；原始影片保留在公司電腦，不會上傳。
          </span>
        </div>
        <div className="local-video-head-actions">
          <b className={connected ? "online" : "offline"}>
            <i aria-hidden="true" />
            {connected ? `本機節點已連線 · ${version}` : "本機節點未連線"}
          </b>
          <a href="/iBrain-local-node-v0.6.11.zip" download>
            下載司法全量同步版節點 v0.6.11
          </a>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="video-file-field">
          <span>① 選擇本機影片</span>
          <select
            value={sourceFile}
            onChange={(event) => {
              setSourceFile(event.target.value);
              if (!title) setTitle(event.target.value.replace(/\.[^.]+$/u, ""));
            }}
          >
            <option value="">請選擇 video-inbox 影片</option>
            {available.map((file) => (
              <option value={file.name} key={file.name}>
                {file.name}（{(file.sizeBytes / 1024 / 1024 / 1024).toFixed(2)}{" "}
                GB）
              </option>
            ))}
          </select>
        </label>
        <div className="video-meta-fields">
          <label>
            <span>② 課程名稱</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：金融資產第一講"
            />
          </label>
          <label>
            <span>老師</span>
            <input
              value={creator}
              onChange={(event) => setCreator(event.target.value)}
            />
          </label>
          <label>
            <span>科目</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
        </div>
        <button
          className="video-submit-button"
          disabled={saving || !sourceFile}
        >
          <span>{saving ? "建立工作中…" : "開始處理並上傳"}</span>
          <small>系統自動判斷是否需要轉碼</small>
        </button>
      </form>
      {!files.length && (
        <p className="local-video-empty">video-inbox 目前沒有可處理的影片。</p>
      )}
      {notice && <p className="local-node-job-message">{notice}</p>}
      <div className="local-video-history">
        <h3>處理進度</h3>
        {jobs.slice(0, 10).map((job) => {
          const percent =
            job.status === "completed"
              ? 100
              : job.status === "queued"
                ? 0
                : (job.progressPercent ?? 1);
          return (
            <article key={job.id}>
              <header>
                <div>
                  <strong>{job.bookTitle || job.sourceFile}</strong>
                  <span>
                    {job.creator || "未設定老師"} · {job.sourceFile}
                  </span>
                </div>
                <div className="video-job-actions">
                  <em className={`job-${job.status}`}>
                    {job.status === "queued"
                      ? "等待處理"
                      : job.status === "claimed"
                        ? job.progressStage || "本機處理中"
                        : job.status === "completed"
                          ? "處理完成"
                          : "處理失敗"}
                  </em>
                  <button
                    type="button"
                    onClick={() => void retry(job.id, job.status === "completed" ? "subtitle" : undefined)}
                    disabled={Boolean(retrying)}
                  >
                    {retrying === job.id ? "重新排隊中…" : job.status === "completed" ? "重新產生字幕／摘要" : "重新處理"}
                  </button>
                </div>
              </header>
              <div className="video-progress-row">
                <div
                  className="video-progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <span style={{ width: `${percent}%` }} />
                </div>
                <b>{percent}%</b>
              </div>
              <footer>
                <small>
                  {job.message}
                  {job.status === "completed"
                    ? ` · ${job.segmentCount ?? 0} 個切片 · ${Math.round((job.durationSeconds ?? 0) / 60)} 分鐘`
                    : ""}
                </small>
                {job.status === "claimed" && (
                  <small>
                    {job.elapsedSeconds
                      ? `已用 ${timeLabel(job.elapsedSeconds)}`
                      : ""}
                    {job.estimatedRemainingSeconds
                      ? ` · 約剩 ${timeLabel(job.estimatedRemainingSeconds)}`
                      : ""}
                  </small>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
