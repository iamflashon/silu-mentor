"""iBrain private教材節點：只回報狀態，不上傳原始教材。"""
from __future__ import annotations

import json
import hashlib
import os
import platform
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

VERSION = "0.2.0"
USER_AGENT = f"iBrain-Local-Node/{VERSION} Mozilla/5.0"


def run_text(command: list[str]) -> str:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=8, check=False).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def ollama_models() -> list[str]:
    lines = run_text(["ollama", "list"]).splitlines()
    return [line.split()[0] for line in lines[1:] if line.split()][:20]


def gpu_info() -> tuple[str, float | None]:
    output = run_text(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    if not output:
        return "未偵測到 NVIDIA GPU", None
    parts = [part.strip() for part in output.splitlines()[0].split(",")]
    try:
        memory_gb = round(float(parts[1]) / 1024, 1)
    except (IndexError, ValueError):
        memory_gb = None
    return parts[0], memory_gb


def ram_gb() -> float | None:
    if platform.system() == "Windows":
        value = run_text(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"])
        try:
            return round(float(value) / 1024**3, 1)
        except ValueError:
            return None
    return None


def request_json(url: str, token: str, payload: dict | None = None) -> tuple[int, dict | None]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        if error.code == 204:
            return 204, None
        raise


def heartbeat(endpoint: str, token: str, active_job: str = "") -> None:
    gpu, gpu_memory = gpu_info()
    payload = {
        "nodeId": os.getenv("LOCAL_NODE_ID", "company-rtx4090"),
        "name": os.getenv("LOCAL_NODE_NAME", "公司 RTX 4090"),
        "status": "online",
        "version": VERSION,
        "gpu": gpu,
        "gpuMemoryGb": gpu_memory,
        "ramGb": ram_gb(),
        "models": ollama_models(),
        "queuedJobs": 1 if active_job else 0,
        "activeJob": active_job,
        "message": "本機節點已連線；原始教材保留於公司本機。",
    }
    status, _ = request_json(endpoint, token, payload)
    if status >= 300:
        raise RuntimeError(f"heartbeat failed: HTTP {status}")


def extract_text(path: Path) -> tuple[str, int | None]:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".json", ".jsonl", ".html", ".htm", ".csv"}:
        return path.read_text(encoding="utf-8", errors="replace"), None
    if suffix == ".docx":
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = []
        for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
            paragraphs.append("".join(node.text or "" for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")))
        return "\n".join(paragraphs), None
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(str(path))
            return "\n\n".join(page.extract_text() or "" for page in reader.pages), len(reader.pages)
        except ImportError as error:
            raise RuntimeError("尚未安裝 PDF 文字擷取套件 pypdf") from error
    raise RuntimeError(f"目前不支援 {suffix or '無副檔名'} 文件")


def text_chunks(text: str, size: int = 6000, overlap: int = 300) -> list[str]:
    cleaned = "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()
    if not cleaned:
        return []
    chunks, start = [], 0
    while start < len(cleaned) and len(chunks) < 500:
        end = min(len(cleaned), start + size)
        chunks.append(cleaned[start:end])
        if end == len(cleaned):
            break
        start = max(start + 1, end - overlap)
    return chunks


def process_next_job(jobs_url: str, token: str, inbox: Path, node_id: str) -> str:
    status, response = request_json(jobs_url, token)
    if status == 204 or not response or not isinstance(response.get("job"), dict):
        return ""
    job = response["job"]
    job_id = str(job.get("id", ""))
    source_file = Path(str(job.get("sourceFile", ""))).name
    if not job_id or not source_file:
        return ""
    path = inbox / source_file
    try:
        if not path.is_file():
            raise RuntimeError(f"inbox 找不到檔案：{source_file}")
        text, page_count = extract_text(path)
        chunks = text_chunks(text)
        if not chunks:
            raise RuntimeError("沒有擷取到可索引文字；掃描 PDF 需要下一階段 OCR")
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "completed", "message": f"已擷取 {len(text):,} 字，原始檔未上傳", "sha256": sha256, "pageCount": page_count, "chunks": chunks})
    except Exception as error:
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "failed", "message": str(error)[:240]})
    return source_file


def main() -> None:
    endpoint = os.getenv("LOCAL_NODE_HEARTBEAT_URL", "").strip()
    token = os.getenv("LOCAL_NODE_TOKEN", "").strip()
    if not endpoint or not token:
        raise SystemExit("請先設定 LOCAL_NODE_HEARTBEAT_URL 與 LOCAL_NODE_TOKEN。")
    jobs_url = endpoint.rsplit("/heartbeat", 1)[0] + "/jobs"
    inbox = Path(os.getenv("LOCAL_NODE_INBOX", str(Path(__file__).resolve().parent / "inbox"))).resolve()
    inbox.mkdir(parents=True, exist_ok=True)
    node_id = os.getenv("LOCAL_NODE_ID", "company-rtx4090")
    print(f"iBrain 本機節點 {VERSION} 啟動；每 30 秒回報一次狀態。")
    print(f"私有教材收件匣：{inbox}")
    while True:
        try:
            active = process_next_job(jobs_url, token, inbox, node_id)
            heartbeat(endpoint, token, active)
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳成功")
        except (urllib.error.URLError, RuntimeError, TimeoutError) as error:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳失敗:", error)
        time.sleep(30)


if __name__ == "__main__":
    main()
