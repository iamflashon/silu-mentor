"""iBrain 本機節點：教材、影音與司法院裁判的本機前處理。"""
from __future__ import annotations

import json
import hashlib
import os
import platform
import re
import sqlite3
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET

VERSION = "0.6.11"
USER_AGENT = f"iBrain-Local-Node/{VERSION} Mozilla/5.0"
_OCR_ENGINE = None
_SUBTITLE_QUEUE: list[Path] = []
_SUBTITLE_PROCESS: tuple[subprocess.Popen, Path] | None = None
SUPPORTED_INBOX_SUFFIXES = {".pdf", ".docx", ".txt", ".md", ".json", ".jsonl", ".html", ".htm", ".csv"}
SUPPORTED_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".mkv"}
JUDICIAL_REQUIRED_FIELDS = {"JID", "JYEAR", "JCASE", "JNO", "JDATE", "JTITLE", "JFULL", "JPDF"}
JUDICIAL_HEADING_PATTERN = re.compile(
    r"^\s*(主\s*文|事\s*實|犯罪事實|事實及理由|犯罪事實及理由|理\s*由|證\s*據|論罪科刑|據上論斷)\s*[：:]?\s*$"
)


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
        with urllib.request.urlopen(request, timeout=180) as response:
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
            detail = error.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"服務驗證失敗（HTTP {error.code}）：{detail or '無詳細內容'}") from error
        raise


def _upload_headers(token: str, content_type: str = "application/octet-stream") -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": content_type, "Accept": "application/json", "User-Agent": USER_AGENT}
    access_client_id = os.getenv("CF_ACCESS_CLIENT_ID", "").strip()
    access_client_secret = os.getenv("CF_ACCESS_CLIENT_SECRET", "").strip()
    if access_client_id and access_client_secret:
        headers["CF-Access-Client-Id"] = access_client_id
        headers["CF-Access-Client-Secret"] = access_client_secret
    return headers


def remote_file_exists(url: str, token: str) -> bool:
    for attempt, delay in enumerate((2, 4, 8), 1):
        request = urllib.request.Request(url, headers=_upload_headers(token), method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status == 200
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return False
            if error.code not in (408, 425, 429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f"檢查雲端切片失敗（HTTP {error.code}）") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                raise RuntimeError(f"檢查雲端切片失敗：{error}") from error
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"雲端暫時無回應，{delay} 秒後重試檢查")
        time.sleep(delay)
    return False


def upload_file(url: str, token: str, path: Path) -> dict | None:
    data = path.read_bytes()
    delays = (2, 4, 8, 16, 30, 45)
    for attempt, delay in enumerate(delays, 1):
        request = urllib.request.Request(url, data=data, headers=_upload_headers(token), method="PUT")
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:300]
            retryable = error.code in (408, 425, 429, 500, 502, 503, 504)
            if not retryable or attempt == len(delays):
                raise RuntimeError(f"上傳 {path.name} 失敗（HTTP {error.code}）：{detail}") from error
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"上傳 {path.name} 暫時失敗（HTTP {error.code}），{delay} 秒後重試 {attempt}/{len(delays)}")
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == len(delays):
                raise RuntimeError(f"上傳 {path.name} 失敗：{error}") from error
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"上傳 {path.name} 連線中斷，{delay} 秒後重試 {attempt}/{len(delays)}")
        time.sleep(delay)
    return None


def inbox_inventory(inbox: Path, suffixes: set[str] = SUPPORTED_INBOX_SUFFIXES) -> list[dict]:
    files: list[dict] = []
    for path in inbox.iterdir():
        try:
            if not path.is_file() or path.suffix.lower() not in suffixes:
                continue
            stat = path.stat()
            files.append({"name": path.name, "sizeBytes": stat.st_size, "modifiedAt": int(stat.st_mtime * 1000)})
        except OSError:
            continue
    files.sort(key=lambda item: (-int(item["modifiedAt"]), str(item["name"]).lower()))
    return files[:200]


def judicial_inventory(inbox: Path) -> list[dict]:
    return inbox_inventory(inbox, {".rar"})


def heartbeat(endpoint: str, token: str, inbox: Path, video_inbox: Path, judicial_inbox: Path | None = None, judicial_output: Path | None = None, active_job: str = "") -> None:
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
        "videoInboxFiles": inbox_inventory(video_inbox, SUPPORTED_VIDEO_SUFFIXES),
        "judicialInboxFiles": judicial_inventory(judicial_inbox) if judicial_inbox else [],
        "judicialProgress": judicial_progress(judicial_inbox, judicial_output) if judicial_inbox and judicial_output else {},
        "message": "本機節點已連線；教材原稿留本機，影片只上傳轉好的 HLS。",
    }
    status, _ = request_json(endpoint, token, payload)
    if status >= 300:
        raise RuntimeError(f"heartbeat failed: HTTP {status}")


def _clean_judicial_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u3000", " ")
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def judicial_chunks(text: str, target_size: int = 1800, overlap: int = 180) -> list[dict]:
    """Prefer court heading boundaries; split long sections without losing context."""
    cleaned = _clean_judicial_text(text)
    if not cleaned:
        return []
    lines = cleaned.split("\n")
    sections: list[tuple[str, str]] = []
    heading = "全文"
    buffer: list[str] = []
    for line in lines:
        match = JUDICIAL_HEADING_PATTERN.fullmatch(line)
        if match and buffer:
            sections.append((heading, "\n".join(buffer).strip()))
            heading = re.sub(r"\s+", "", match.group(1))
            buffer = [line.strip()]
        else:
            if match:
                heading = re.sub(r"\s+", "", match.group(1))
            buffer.append(line)
    if buffer:
        sections.append((heading, "\n".join(buffer).strip()))

    result: list[dict] = []
    for section, body in sections:
        if not body:
            continue
        start = 0
        while start < len(body):
            end = min(len(body), start + target_size)
            if end < len(body):
                candidates = [body.rfind(mark, start + target_size // 2, end) for mark in ("\n", "。", "；")]
                boundary = max(candidates)
                if boundary > start:
                    end = boundary + 1
            chunk_text = body[start:end].strip()
            if chunk_text:
                result.append({"sequence": len(result) + 1, "section": section, "text": chunk_text})
            if end >= len(body):
                break
            start = max(start + 1, end - overlap)
    return result


def parse_judicial_document(raw: bytes, source_name: str) -> tuple[dict, list[dict]]:
    try:
        document = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"JSON 無法解析：{source_name}") from error
    if not isinstance(document, dict):
        raise ValueError(f"JSON 根節點不是物件：{source_name}")
    missing = sorted(JUDICIAL_REQUIRED_FIELDS - set(document))
    if missing:
        raise ValueError(f"缺少欄位 {', '.join(missing)}：{source_name}")
    full_text = str(document.get("JFULL") or "")
    chunks = judicial_chunks(full_text)
    if not chunks:
        raise ValueError(f"裁判全文為空：{source_name}")
    normalized = {key: str(document.get(key) or "").strip() for key in JUDICIAL_REQUIRED_FIELDS}
    normalized["contentSha256"] = hashlib.sha256(full_text.encode("utf-8")).hexdigest()
    return normalized, chunks


def _seven_zip_path() -> str:
    configured = os.getenv("LOCAL_NODE_7ZIP", "").strip()
    candidates = [configured, r"C:\Program Files\7-Zip\7z.exe", "7z"]
    for candidate in candidates:
        if not candidate:
            continue
        if candidate == "7z" or Path(candidate).is_file():
            return candidate
    raise RuntimeError("找不到 7-Zip，請設定 LOCAL_NODE_7ZIP")


def _rar_json_members(archive: Path, seven_zip: str) -> list[str]:
    command = [seven_zip, "l", "-slt", "-ba", "-sccUTF-8", str(archive)]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300, check=False,
                               creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0)
    if completed.returncode != 0:
        raise RuntimeError(f"RAR 清單讀取失敗：{archive.name}：{completed.stderr[-300:]}")
    members = []
    for line in completed.stdout.splitlines():
        if line.startswith("Path = "):
            name = line[7:].strip()
            if name.lower().endswith(".json"):
                members.append(name)
    return members


def _read_rar_member(archive: Path, member: str, seven_zip: str) -> bytes:
    completed = subprocess.run([seven_zip, "x", "-so", str(archive), member], capture_output=True, timeout=120, check=False,
                               creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0)
    if completed.returncode != 0:
        raise RuntimeError(f"RAR 內容讀取失敗：{member}：{completed.stderr.decode('utf-8', errors='replace')[-300:]}")
    return completed.stdout


def evenly_spaced_members(members: list[str], limit: int) -> list[str]:
    """Sample the whole archive instead of only the first court directory."""
    if limit >= len(members):
        return list(members)
    if limit <= 1:
        return [members[0]]
    indexes = [round(index * (len(members) - 1) / (limit - 1)) for index in range(limit)]
    return [members[index] for index in dict.fromkeys(indexes)]


def _judicial_state_db(output: Path) -> sqlite3.Connection:
    state_dir = output / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(state_dir / "judicial-state.sqlite3")
    db.execute("""CREATE TABLE IF NOT EXISTS archives (
        archive_name TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'waiting', total_members INTEGER NOT NULL DEFAULT 0,
        next_index INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, uploaded INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    # CREATE TABLE IF NOT EXISTS does not add columns to a database created by
    # an older node. Migrate it in place so processing cursors are preserved.
    existing = {str(row[1]) for row in db.execute("PRAGMA table_info(archives)").fetchall()}
    migrations = {
        "uploaded": "INTEGER NOT NULL DEFAULT 0",
        "duplicates": "INTEGER NOT NULL DEFAULT 0",
        "failed": "INTEGER NOT NULL DEFAULT 0",
        "chunks": "INTEGER NOT NULL DEFAULT 0",
        "last_error": "TEXT NOT NULL DEFAULT ''",
        "updated_at": "TEXT NOT NULL DEFAULT ''",
    }
    for column, definition in migrations.items():
        if column not in existing:
            db.execute(f"ALTER TABLE archives ADD COLUMN {column} {definition}")
    db.commit()
    return db


def _insert_archive_state(db: sqlite3.Connection, archive: Path, total_members: int) -> None:
    """Insert into both current and legacy archive schemas without losing state."""
    values: dict[str, object] = {
        "archive_name": archive.name,
        "status": "processing",
        "total_members": total_members,
        "next_index": 0,
        "processed": 0,
        "uploaded": 0,
        "duplicates": 0,
        "failed": 0,
        "chunks": 0,
        "last_error": "",
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        # Compatibility with state databases created by pre-0.6.9 builds.
        "archive_size": archive.stat().st_size,
        "archive_mtime": archive.stat().st_mtime_ns,
        "archive_mtime_ns": archive.stat().st_mtime_ns,
    }
    columns = db.execute("PRAGMA table_info(archives)").fetchall()
    insert_values: dict[str, object] = {}
    for _, name, column_type, not_null, default_value, primary_key in columns:
        if name in values:
            insert_values[name] = values[name]
        elif not_null and default_value is None and not primary_key:
            insert_values[name] = "" if "TEXT" in str(column_type).upper() else 0
    names = list(insert_values)
    placeholders = ",".join("?" for _ in names)
    db.execute(f"INSERT INTO archives({','.join(names)}) VALUES({placeholders})", tuple(insert_values[name] for name in names))


def judicial_progress(inbox: Path, output: Path) -> dict:
    mode = os.getenv("LOCAL_NODE_JUDICIAL_MODE", "test").strip().lower()
    archives = sorted(inbox.glob("*.rar"))
    result = {"mode": mode, "archives": len(archives), "completedArchives": 0, "totalMembers": 0, "processed": 0, "uploaded": 0,
              "pendingUpload": 0, "duplicates": 0, "failed": 0, "chunks": 0, "currentArchive": ""}
    try:
        db = _judicial_state_db(output)
        rows = db.execute("SELECT archive_name,status,total_members,processed,uploaded,duplicates,failed,chunks FROM archives").fetchall()
        db.close()
        for name, status, total, processed, uploaded, duplicates, failed, chunks in rows:
            result["totalMembers"] += int(total or 0); result["processed"] += int(processed or 0); result["uploaded"] += int(uploaded or 0)
            result["duplicates"] += int(duplicates or 0); result["failed"] += int(failed or 0); result["chunks"] += int(chunks or 0)
            if status == "completed": result["completedArchives"] += 1
            elif status == "processing" and not result["currentArchive"]: result["currentArchive"] = name
    except (OSError, sqlite3.Error):
        pass
    for marker in output.glob("*/completed.json"):
        try:
            report = json.loads(marker.read_text(encoding="utf-8"))
            upload_state = marker.parent / "upload-state.json"
            uploaded = int(json.loads(upload_state.read_text(encoding="utf-8")).get("uploaded", 0)) if upload_state.is_file() else 0
            processed = int(report.get("processed", 0))
            result["processed"] += processed; result["uploaded"] += min(processed, uploaded); result["pendingUpload"] += max(0, processed - uploaded)
            result["failed"] += int(report.get("failed", 0)); result["duplicates"] += int(report.get("duplicates", 0)); result["chunks"] += int(report.get("chunks", 0))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    result["pendingUpload"] += max(0, result["processed"] - result["uploaded"] - result["pendingUpload"])
    return result


def _bounded_record_batch(records: list[dict], start: int, maximum: int = 10, max_chars: int = 1_500_000) -> list[dict]:
    batch: list[dict] = []; size = 0
    for record in records[start:start + maximum]:
        encoded = json.dumps(record, ensure_ascii=False)
        if batch and size + len(encoded) > max_chars: break
        batch.append(record); size += len(encoded)
    return batch


def upload_completed_judicial_outputs(endpoint: str, token: str, output: Path) -> str:
    if os.getenv("LOCAL_NODE_JUDICIAL_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}: return ""
    judicial_url = endpoint.rsplit("/heartbeat", 1)[0] + "/judicial"
    for records_path in sorted(output.glob("*/records.jsonl")):
        completed = records_path.parent / "completed.json"
        if not completed.is_file(): continue
        records = [json.loads(line) for line in records_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        state_path = records_path.parent / "upload-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {"uploaded": 0}
        uploaded = max(0, min(int(state.get("uploaded", 0)), len(records)))
        if uploaded >= len(records): continue
        batch = _bounded_record_batch(records, uploaded)
        status, response = request_json(judicial_url, token, {"records": batch, "progress": judicial_progress(records_path.parent.parent, output)})
        if status >= 300 or not response or not response.get("ok"): raise RuntimeError(f"司法裁判上傳失敗（HTTP {status}）")
        uploaded += len(batch)
        state_path.write_text(json.dumps({"uploaded": uploaded, "total": len(records), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"司法既有結果上傳：{records_path.parent.name} {uploaded}/{len(records)}")
        return records_path.parent.name
    return ""


def process_judicial_full_batch(endpoint: str, token: str, judicial_inbox: Path, judicial_output: Path) -> str:
    if os.getenv("LOCAL_NODE_JUDICIAL_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}: return ""
    if os.getenv("LOCAL_NODE_JUDICIAL_MODE", "test").strip().lower() != "full": return ""
    batch_size = max(1, min(int(os.getenv("LOCAL_NODE_JUDICIAL_BATCH_SIZE", "20")), 50))
    db = _judicial_state_db(judicial_output)
    archives = sorted(judicial_inbox.glob("*.rar"))
    for archive in archives:
        row = db.execute("SELECT status,next_index,processed,uploaded,duplicates,failed,chunks FROM archives WHERE archive_name=?", (archive.name,)).fetchone()
        if row and row[0] == "completed": continue
        seven_zip = _seven_zip_path(); members = _rar_json_members(archive, seven_zip)
        if not row:
            _insert_archive_state(db, archive, len(members)); db.commit()
            row = ("processing", 0, 0, 0, 0, 0, 0)
        _, next_index, processed, uploaded, duplicates, failed, chunks_total = row
        candidates: list[dict] = []; batch_failed = 0; batch_chunks = 0; batch_duplicates = 0
        for member in members[int(next_index):int(next_index) + batch_size]:
            try:
                document, chunks = parse_judicial_document(_read_rar_member(archive, member, seven_zip), member)
                candidates.append({"sourceArchive": archive.name, "sourceMember": member, "document": document, "chunks": chunks}); batch_chunks += len(chunks)
            except Exception:
                batch_failed += 1
        if candidates:
            judicial_url = endpoint.rsplit("/heartbeat", 1)[0] + "/judicial"
            start = 0
            while start < len(candidates):
                upload_batch = _bounded_record_batch(candidates, start)
                status, response = request_json(judicial_url, token, {"records": upload_batch, "progress": {"mode": "full", "currentArchive": archive.name}})
                if status >= 300 or not response or not response.get("ok"): raise RuntimeError(f"司法全量上傳失敗（HTTP {status}）")
                batch_duplicates += int(response.get("duplicates", 0))
                start += len(upload_batch)
        advanced = min(batch_size, max(0, len(members) - int(next_index))); next_value = int(next_index) + advanced
        status_value = "completed" if next_value >= len(members) else "processing"
        db.execute("UPDATE archives SET status=?,total_members=?,next_index=?,processed=?,uploaded=?,duplicates=?,failed=?,chunks=?,updated_at=CURRENT_TIMESTAMP WHERE archive_name=?",
                   (status_value, len(members), next_value, int(processed) + len(candidates), int(uploaded) + len(candidates), int(duplicates) + batch_duplicates, int(failed) + batch_failed, int(chunks_total) + batch_chunks, archive.name)); db.commit(); db.close()
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"司法全量：{archive.name} {next_value}/{len(members)}；本批上傳 {len(candidates)} 筆")
        return archive.name
    db.close(); return ""


def process_judicial_test(judicial_inbox: Path, judicial_output: Path) -> str:
    """Process one explicitly selected RAR locally. No Cloudflare upload occurs."""
    if os.getenv("LOCAL_NODE_JUDICIAL_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return ""
    if os.getenv("LOCAL_NODE_JUDICIAL_MODE", "test").strip().lower() == "full":
        return ""
    selected = os.getenv("LOCAL_NODE_JUDICIAL_TEST_ARCHIVE", "").strip()
    if not selected:
        return "司法測試待指定 RAR"
    archive = judicial_inbox / Path(selected).name
    if not archive.is_file() or archive.suffix.lower() != ".rar":
        raise RuntimeError(f"司法收件匣找不到指定 RAR：{selected}")
    max_docs = max(1, min(int(os.getenv("LOCAL_NODE_JUDICIAL_MAX_DOCS", "100")), 1000))
    run_key = hashlib.sha256(f"{VERSION}:{archive.name}:{archive.stat().st_size}:{archive.stat().st_mtime_ns}:{max_docs}".encode()).hexdigest()[:16]
    output_dir = judicial_output / f"{archive.stem}-{run_key}"
    completed_marker = output_dir / "completed.json"
    if completed_marker.is_file():
        return ""
    output_dir.mkdir(parents=True, exist_ok=True)
    seven_zip = _seven_zip_path()
    members = _rar_json_members(archive, seven_zip)
    if not members:
        raise RuntimeError(f"RAR 內找不到 JSON：{archive.name}")
    records_path = output_dir / "records.jsonl"
    errors_path = output_dir / "errors.jsonl"
    processed = failed = duplicate = chunks_total = 0
    seen: set[str] = set()
    started_at = time.time()
    selected_members = evenly_spaced_members(members, max_docs)
    with records_path.open("w", encoding="utf-8") as records, errors_path.open("w", encoding="utf-8") as errors:
        for member in selected_members:
            try:
                document, chunks = parse_judicial_document(_read_rar_member(archive, member, seven_zip), member)
                unique_key = f"{document['JID']}:{document['contentSha256']}"
                if unique_key in seen:
                    duplicate += 1
                    continue
                seen.add(unique_key)
                records.write(json.dumps({"sourceArchive": archive.name, "sourceMember": member, "document": document, "chunks": chunks}, ensure_ascii=False) + "\n")
                processed += 1
                chunks_total += len(chunks)
            except Exception as error:
                errors.write(json.dumps({"sourceMember": member, "error": str(error)[:500]}, ensure_ascii=False) + "\n")
                failed += 1
    report = {
        "mode": "local_test_only",
        "version": VERSION,
        "archive": archive.name,
        "archiveSizeBytes": archive.stat().st_size,
        "jsonMembers": len(members),
        "sampleLimit": max_docs,
        "samplingStrategy": "evenly_spaced_across_archive",
        "selectedMembers": len(selected_members),
        "processed": processed,
        "failed": failed,
        "duplicates": duplicate,
        "chunks": chunks_total,
        "elapsedSeconds": round(time.time() - started_at, 2),
        "cloudflareUploaded": False,
        "recordsFile": str(records_path),
        "errorsFile": str(errors_path),
    }
    completed_marker.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(time.strftime("%Y-%m-%d %H:%M:%S"), f"司法測試完成：{processed} 筆、{chunks_total} 段、失敗 {failed} 筆；未上傳 Cloudflare")
    return archive.name


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


def video_duration(path: Path) -> float:
    output = run_text(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)])
    try:
        return round(float(output), 2)
    except ValueError:
        return 0.0


def make_vtt(srt_text: str) -> str:
    return "WEBVTT\n\n" + re.sub(r"(?<=\d),(?=\d{3}(?:\s|$))", ".", srt_text)


def transcribe_video(source: Path, output: Path) -> tuple[Path | None, Path | None]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return None, None
    model_name = os.getenv("LOCAL_NODE_WHISPER_MODEL", "medium")
    model = WhisperModel(model_name, device="cuda", compute_type="float16")
    segments, _ = model.transcribe(str(source), language="zh", vad_filter=True)
    rows = []
    for index, segment in enumerate(segments, 1):
        def stamp(value: float, comma: bool = True) -> str:
            millis = int(value * 1000); hours, rest = divmod(millis, 3600000); minutes, rest = divmod(rest, 60000); seconds, ms = divmod(rest, 1000)
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}{',' if comma else '.'}{ms:03d}"
        rows.append(f"{index}\n{stamp(segment.start)} --> {stamp(segment.end)}\n{segment.text.strip()}\n")
    if not rows:
        return None, None
    srt = output / "transcript.srt"; srt.write_text("\n".join(rows), encoding="utf-8")
    vtt = output / "subtitles.vtt"; vtt.write_text(make_vtt(srt.read_text(encoding="utf-8")), encoding="utf-8")
    return srt, vtt


def process_subtitle_in_background(source: Path, output: Path, jobs_url: str, media_url: str, token: str, job: dict, node_id: str, duration: float, segment_count: int) -> bool:
    """Generate/upload subtitles without blocking the next video job."""
    job_id = str(job.get("id", ""))
    try:
        srt = output / "transcript.srt"
        vtt = output / "subtitles.vtt"
        if srt.is_file() and srt.stat().st_size > 0:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕背景工作：偵測到既有 transcript.srt，略過重新辨識並直接補傳")
            if not vtt.is_file() or vtt.stat().st_size == 0:
                vtt.write_text(make_vtt(srt.read_text(encoding="utf-8")), encoding="utf-8")
        else:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕背景工作：開始產生 SRT")
            srt, vtt = transcribe_video(source, output)
        if not srt:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕背景工作：未安裝字幕模組，影片不受影響")
            return True
        for subtitle in (srt, vtt):
            if subtitle:
                query = urllib.parse.urlencode({"jobId": job_id, "path": subtitle.name})
                upload_file(f"{media_url}?{query}", token, subtitle)
        prefix = f"course-media/{job.get('resourceId')}/{job_id}"
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "completed", "message": "SRT 字幕已完成並上傳，正在建立重點摘要", "hlsKey": f"{prefix}/index.m3u8", "posterKey": f"{prefix}/poster.jpg", "subtitleKey": f"{prefix}/transcript.srt", "durationSeconds": duration, "segmentCount": segment_count})
        print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕背景工作：SRT 上傳完成")
        return True
    except Exception as error:
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"字幕背景工作失敗（影片仍可播放）：{str(error)[:240]}")
        return False


def queue_subtitle_worker(source: Path, output: Path, jobs_url: str, media_url: str, job: dict, node_id: str, duration: float, segment_count: int) -> None:
    """Persist and queue a subtitle task for an isolated Python subprocess."""
    task_path = output / "subtitle-task.json"
    task_path.write_text(json.dumps({
        "source": str(source), "output": str(output), "jobsUrl": jobs_url, "mediaUrl": media_url,
        "job": job, "nodeId": node_id, "duration": duration, "segmentCount": segment_count,
    }, ensure_ascii=False), encoding="utf-8")
    if task_path not in _SUBTITLE_QUEUE:
        _SUBTITLE_QUEUE.append(task_path)
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕背景佇列：已排入獨立程序，不會阻塞下一支影片")
    service_subtitle_queue()


def service_subtitle_queue() -> None:
    """Run at most one Whisper process so multiple videos cannot exhaust GPU memory."""
    global _SUBTITLE_PROCESS
    if _SUBTITLE_PROCESS:
        process, task_path = _SUBTITLE_PROCESS
        returncode = process.poll()
        if returncode is None:
            return
        if returncode == 0:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "字幕獨立程序：工作完成")
        else:
            failed_path = task_path.with_suffix(".failed.json")
            try:
                task_path.replace(failed_path)
            except OSError:
                pass
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"字幕獨立程序異常結束（代碼 {returncode}）；主節點仍繼續運作")
        _SUBTITLE_PROCESS = None
    if not _SUBTITLE_PROCESS and _SUBTITLE_QUEUE:
        task_path = _SUBTITLE_QUEUE.pop(0)
        creationflags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
        process = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "--subtitle-worker", str(task_path)], creationflags=creationflags)
        _SUBTITLE_PROCESS = (process, task_path)


def run_subtitle_worker(task_path: Path) -> int:
    token = os.getenv("LOCAL_NODE_TOKEN", "").strip()
    if not token:
        print("字幕獨立程序：找不到 LOCAL_NODE_TOKEN")
        return 1
    try:
        task = json.loads(task_path.read_text(encoding="utf-8"))
        succeeded = process_subtitle_in_background(
            Path(task["source"]), Path(task["output"]), task["jobsUrl"], task["mediaUrl"], token,
            task["job"], task["nodeId"], float(task["duration"]), int(task["segmentCount"]),
        )
        if succeeded:
            task_path.unlink(missing_ok=True)
            return 0
        return 1
    except Exception as error:
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"字幕獨立程序無法啟動：{str(error)[:240]}")
        return 1


def process_video_job(job: dict, jobs_url: str, token: str, video_inbox: Path, video_output: Path, node_id: str, heartbeat_callback=None) -> None:
    job_id = str(job.get("id", "")); source_file = Path(str(job.get("sourceFile", ""))).name
    source = video_inbox / source_file; output = video_output / job_id
    if not source.is_file():
        raise RuntimeError(f"video-inbox 找不到影片：{source_file}")
    if not run_text(["ffmpeg", "-version"]):
        raise RuntimeError("找不到 FFmpeg，請先安裝並加入 PATH")
    output.mkdir(parents=True, exist_ok=True)
    started_at = time.time()
    last_heartbeat_at = started_at
    duration = video_duration(source)
    media_url = jobs_url.rsplit("/jobs", 1)[0] + "/media"
    if job.get("retryMode") == "subtitle":
        playlist = output / "index.m3u8"
        segment_count = len(list(output.glob("segment-*.ts")))
        if not playlist.is_file() or not segment_count:
            raise RuntimeError("本機找不到既有 HLS，請改用完整重新處理")
        prefix = f"course-media/{job.get('resourceId')}/{job_id}"
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "completed", "message": "既有 HLS 已保留；字幕正在獨立程序產生，完成後自動建立 AI 重點摘要", "hlsKey": f"{prefix}/index.m3u8", "posterKey": f"{prefix}/poster.jpg", "subtitleKey": "", "durationSeconds": duration, "segmentCount": segment_count})
        queue_subtitle_worker(source, output, jobs_url, media_url, job, node_id, duration, segment_count)
        return
    def report(percent: int, stage: str, message: str = "") -> None:
        nonlocal last_heartbeat_at
        elapsed = max(0, int(time.time() - started_at))
        remaining = int(elapsed * (100 - percent) / percent) if percent > 1 else 0
        request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "progress", "progressPercent": percent, "progressStage": stage, "message": message or stage, "elapsedSeconds": elapsed, "estimatedRemainingSeconds": remaining})
        print(time.strftime("%Y-%m-%d %H:%M:%S"), f"{stage}：{percent}%", message or "")
        if heartbeat_callback and time.time() - last_heartbeat_at >= 25:
            heartbeat_callback(source_file)
            last_heartbeat_at = time.time()
    report(2, "分析影片", "正在分析影片格式與長度")
    playlist = output / "index.m3u8"
    reusable_hls = playlist.is_file() and "#EXT-X-ENDLIST" in playlist.read_text(encoding="utf-8", errors="replace") and any(output.glob("segment-*.ts"))
    encode_args = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "5M", "-maxrate", "7M", "-bufsize", "10M", "-c:a", "aac", "-b:a", "160k", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_filename", str(output / "segment-%05d.ts"), str(output / "index.m3u8")]
    def encode(use_cuda_decode: bool) -> tuple[int, str]:
        command = ["ffmpeg", "-y"] + (["-hwaccel", "cuda"] if use_cuda_decode else []) + ["-i", str(source), *encode_args, "-progress", "pipe:1", "-nostats"]
        # Do not leave stderr unread in a pipe: FFmpeg can fill the Windows pipe
        # buffer and appear alive while conversion has actually stopped.
        error_log = output / "ffmpeg-error.log"
        with error_log.open("w+", encoding="utf-8", errors="replace") as stderr_file:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr_file, text=True, creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0)
            last_report = 0.0
            assert process.stdout is not None
            for line in process.stdout:
                if not line.startswith("out_time_ms=") or duration <= 0:
                    continue
                try:
                    completed = int(line.split("=", 1)[1].strip()) / 1_000_000
                except ValueError:
                    continue
                now = time.time()
                if now - last_report >= 4:
                    percent = min(74, max(3, int(completed / duration * 72) + 3))
                    report(percent, "轉換 HLS", f"正在轉換 HLS · {percent}%")
                    last_report = now
            returncode = process.wait()
            stderr_file.seek(0)
            stderr = stderr_file.read()
        if returncode == 0:
            error_log.unlink(missing_ok=True)
        return returncode, stderr
    if reusable_hls:
        report(75, "沿用 HLS", "偵測到完整的本機 HLS，略過重新轉檔")
    else:
        returncode, stderr = encode(True)
        if returncode != 0:
            # Some camera/screen-recording codecs cannot use CUDA decoding. Keep NVENC
            # encoding, but retry with FFmpeg software decoding before failing the job.
            returncode, stderr = encode(False)
        if returncode != 0:
            raise RuntimeError(f"HLS 轉檔失敗：{stderr[-500:]}")
    report(76, "產生縮圖", "HLS 已完成，正在產生課程縮圖")
    subprocess.run(["ffmpeg", "-y", "-ss", "5", "-i", str(source), "-frames:v", "1", "-q:v", "2", str(output / "poster.jpg")], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0)
    upload_names = [path.name for path in sorted(output.iterdir()) if path.is_file() and (path.name == "index.m3u8" or path.name == "poster.jpg" or path.name.startswith("segment-"))]
    report(80, "上傳 R2", f"HLS 已完成，準備上傳 {len(upload_names)} 個影音檔案")
    for index, name in enumerate(upload_names, 1):
        query = urllib.parse.urlencode({"jobId": job_id, "path": name})
        upload_url = f"{media_url}?{query}"
        if remote_file_exists(upload_url, token):
            print(time.strftime("%Y-%m-%d %H:%M:%S"), f"略過已上傳：{name}")
        else:
            upload_file(upload_url, token, output / name)
        if index == len(upload_names) or index % 5 == 0:
            percent = min(98, 80 + int(index / max(1, len(upload_names)) * 18))
            report(percent, "上傳 R2", f"正在上傳 R2 · {index}/{len(upload_names)} 個檔案")
    prefix = f"course-media/{job.get('resourceId')}/{job_id}"
    segment_count = len(list(output.glob("segment-*.ts")))
    request_json(jobs_url, token, {"jobId": job_id, "nodeId": node_id, "status": "completed", "message": f"單畫質 HLS 已完成並上傳，共 {segment_count} 個切片；字幕已轉入背景佇列", "hlsKey": f"{prefix}/index.m3u8", "posterKey": f"{prefix}/poster.jpg", "subtitleKey": "", "durationSeconds": duration, "segmentCount": segment_count})
    queue_subtitle_worker(source, output, jobs_url, media_url, job, node_id, duration, segment_count)


def process_next_job(jobs_url: str, token: str, inbox: Path, video_inbox: Path, video_output: Path, node_id: str, heartbeat_callback=None) -> str:
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
        if job.get("kind") == "transcode_video":
            process_video_job(job, jobs_url, token, video_inbox, video_output, node_id, heartbeat_callback)
            return source_file
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
    video_inbox = Path(os.getenv("LOCAL_NODE_VIDEO_INBOX", str(Path(__file__).resolve().parent / "video-inbox"))).resolve()
    video_output = Path(os.getenv("LOCAL_NODE_VIDEO_OUTPUT", str(Path(__file__).resolve().parent / "video-output"))).resolve()
    judicial_inbox = Path(os.getenv("LOCAL_NODE_JUDICIAL_INBOX", str(Path(__file__).resolve().parent / "legal-inbox" / "judicial"))).resolve()
    judicial_output = Path(os.getenv("LOCAL_NODE_JUDICIAL_OUTPUT", str(Path(__file__).resolve().parent / "judicial-output"))).resolve()
    for directory in (video_inbox, video_output, judicial_inbox, judicial_output, Path(__file__).resolve().parent / "video-processing", Path(__file__).resolve().parent / "video-failed"):
        directory.mkdir(parents=True, exist_ok=True)
    node_id = os.getenv("LOCAL_NODE_ID", "company-rtx4090")
    for task_path in sorted(video_output.glob("*/subtitle-task.json")):
        _SUBTITLE_QUEUE.append(task_path)
    print(f"iBrain 本機節點 {VERSION} 啟動；每 30 秒回報一次狀態。")
    print(f"私有教材收件匣：{inbox}")
    print(f"影音收件匣：{video_inbox}（單畫質 HLS；原始影片不上傳）")
    print(f"司法裁判收件匣：{judicial_inbox}（支援斷點拆解、去重與分批上傳）")
    while True:
        try:
            service_subtitle_queue()
            heartbeat(endpoint, token, inbox, video_inbox, judicial_inbox, judicial_output)
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳成功")
            judicial_active = upload_completed_judicial_outputs(endpoint, token, judicial_output)
            if not judicial_active:
                judicial_active = process_judicial_full_batch(endpoint, token, judicial_inbox, judicial_output)
            if not judicial_active:
                judicial_active = process_judicial_test(judicial_inbox, judicial_output)
            active = process_next_job(
                jobs_url,
                token,
                inbox,
                video_inbox,
                video_output,
                node_id,
                lambda source_file: heartbeat(endpoint, token, inbox, video_inbox, judicial_inbox, judicial_output, source_file),
            )
            heartbeat(endpoint, token, inbox, video_inbox, judicial_inbox, judicial_output, active or judicial_active)
            if active or judicial_active:
                print(time.strftime("%Y-%m-%d %H:%M:%S"), "影片／資料工作完成；字幕若已排入仍會在獨立程序處理，心跳成功")
        except (urllib.error.URLError, RuntimeError, TimeoutError) as error:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳失敗:", error)
        time.sleep(30)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--subtitle-worker":
        raise SystemExit(run_subtitle_worker(Path(sys.argv[2]).resolve()))
    main()
