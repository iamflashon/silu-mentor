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

VERSION = "0.4.1"
USER_AGENT = f"iBrain-Local-Node/{VERSION} Mozilla/5.0"
_OCR_ENGINE = None
SUPPORTED_INBOX_SUFFIXES = {".pdf", ".docx", ".txt", ".md", ".json", ".jsonl", ".html", ".htm", ".csv"}


def run_text(command: list[str]) -> str:
    try:
        creationflags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
        return subprocess.run(command, capture_output=True, text=True, timeout=8, check=False, creationflags=creationflags).stdout.strip()
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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT}
    access_client_id = os.getenv("CF_ACCESS_CLIENT_ID", "").strip()
    access_client_secret = os.getenv("CF_ACCESS_CLIENT_SECRET", "").strip()
    if access_client_id and access_client_secret:
        headers["CF-Access-Client-Id"] = access_client_id
        headers["CF-Access-Client-Secret"] = access_client_secret
    request = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            if not raw:
                return response.status, None
            content_type = response.headers.get("Content-Type", "").lower()
            if "json" not in content_type:
                raise RuntimeError(
                    f"服務回傳非 JSON 內容（HTTP {response.status}，{content_type or '未知格式'}）。"
                    "若網址受 Cloudflare Access 保護，請設定 CF_ACCESS_CLIENT_ID 與 CF_ACCESS_CLIENT_SECRET。"
                )
            try:
                return response.status, json.loads(raw)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"服務回傳無效 JSON（HTTP {response.status}）") from error
    except urllib.error.HTTPError as error:
        if error.code == 204:
            return 204, None
        if error.code in (302, 401, 403):
            raise RuntimeError(
                f"Cloudflare Access 驗證失敗（HTTP {error.code}）。"
                "請確認 Service Auth 原則及 CF_ACCESS_CLIENT_ID／CF_ACCESS_CLIENT_SECRET。"
            ) from error
        raise


def inbox_inventory(inbox: Path) -> list[dict]:
    files: list[dict] = []
    for path in inbox.iterdir():
        try:
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_INBOX_SUFFIXES:
                continue
            stat = path.stat()
            files.append({"name": path.name, "sizeBytes": stat.st_size, "modifiedAt": int(stat.st_mtime * 1000)})
        except OSError:
            continue
    files.sort(key=lambda item: (-int(item["modifiedAt"]), str(item["name"]).lower()))
    return files[:200]


def heartbeat(endpoint: str, token: str, inbox: Path, active_job: str = "") -> None:
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
        "inboxFiles": inbox_inventory(inbox),
        "message": "本機節點已連線；原始教材保留於公司本機。",
    }
    status, _ = request_json(endpoint, token, payload)
    if status >= 300:
        raise RuntimeError(f"heartbeat failed: HTTP {status}")


def _ocr_strings(value) -> list[str]:
    found: list[str] = []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, dict):
        for key in ("rec_texts", "texts", "text"):
            if key in value:
                found.extend(_ocr_strings(value[key]))
        if found:
            return found
        for item in value.values():
            found.extend(_ocr_strings(item))
    elif isinstance(value, (list, tuple)):
        # PaddleOCR v2 rows commonly end with (text, confidence).
        if len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], (int, float)):
            return [value[0].strip()] if value[0].strip() else []
        for item in value:
            found.extend(_ocr_strings(item))
    elif hasattr(value, "json"):
        try:
            found.extend(_ocr_strings(value.json))
        except Exception:
            pass
    return found


def ocr_pdf_page(page) -> str:
    global _OCR_ENGINE
    try:
        import fitz  # type: ignore
        import numpy as np  # type: ignore
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError as error:
        raise RuntimeError("掃描 PDF 需要安裝 PyMuPDF、PaddlePaddle 與 PaddleOCR") from error
    if _OCR_ENGINE is None:
        try:
            _OCR_ENGINE = PaddleOCR(lang="ch", device="gpu", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
        except Exception:
            try:
                _OCR_ENGINE = PaddleOCR(lang="ch", use_gpu=True, show_log=False)
            except Exception:
                _OCR_ENGINE = PaddleOCR(lang="ch")
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
    try:
        result = _OCR_ENGINE.predict(image)
    except (AttributeError, TypeError):
        result = _OCR_ENGINE.ocr(image, cls=True)
    return "\n".join(dict.fromkeys(_ocr_strings(result)))


def extract_pages(path: Path) -> tuple[list[str], str]:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".json", ".jsonl", ".html", ".htm", ".csv"}:
        return [path.read_text(encoding="utf-8", errors="replace")], "native_text"
    if suffix == ".docx":
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        paragraphs = []
        for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
            paragraphs.append("".join(node.text or "" for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")))
        return ["\n".join(paragraphs)], "native_text"
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(str(path))
            pages = [page.extract_text() or "" for page in reader.pages]
        except ImportError as error:
            raise RuntimeError("尚未安裝 PDF 文字擷取套件 pypdf") from error
        weak_pages = [index for index, text in enumerate(pages) if len(text.strip()) < 40]
        if weak_pages and os.getenv("LOCAL_NODE_OCR", "auto").lower() != "off":
            try:
                import fitz  # type: ignore
                document = fitz.open(path)
                for index in weak_pages:
                    pages[index] = ocr_pdf_page(document[index])
            except ImportError as error:
                raise RuntimeError("偵測到掃描頁；請安裝 PyMuPDF、PaddlePaddle 與 PaddleOCR") from error
        mode = "ocr" if weak_pages and all(index in weak_pages for index in range(len(pages))) else "mixed" if weak_pages else "native_text"
        return pages, mode
    raise RuntimeError(f"目前不支援 {suffix or '無副檔名'} 文件")


def text_chunks(text: str, size: int = 6000, overlap: int = 300) -> list[str]:
    text = text.replace("\uf06c", "•").replace("\uf0e0", "→")
    text = "".join(" " if 0xE000 <= ord(char) <= 0xF8FF else char for char in text)
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


def page_chunks(pages: list[str]) -> list[dict]:
    result: list[dict] = []
    for page_number, text in enumerate(pages, 1):
        for chunk in text_chunks(text):
            result.append({"text": chunk, "sequence": len(result) + 1, "pageStart": page_number, "pageEnd": page_number})
            if len(result) >= 500:
                return result
    return result


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
        pages, extraction_mode = extract_pages(path)
        chunks = page_chunks(pages)
        text_length = sum(len(page) for page in pages)
        if not chunks:
            raise RuntimeError("沒有擷取到可索引文字；掃描 PDF 需要下一階段 OCR")
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "completed", "message": f"已擷取 {text_length:,} 字，原始檔未上傳", "sha256": sha256, "pageCount": len(pages), "extractionMode": extraction_mode, "chunks": chunks})
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
            heartbeat(endpoint, token, inbox, active)
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳成功")
        except (urllib.error.URLError, RuntimeError, TimeoutError) as error:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳失敗:", error)
        time.sleep(30)


if __name__ == "__main__":
    main()
