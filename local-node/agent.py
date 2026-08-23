"""iBrain private教材節點：只回報狀態，不上傳原始教材。"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import time
import urllib.error
import urllib.request

VERSION = "0.1.0"


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


def heartbeat(endpoint: str, token: str) -> None:
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
        "queuedJobs": 0,
        "message": "本機節點已連線；原始教材保留於公司本機。",
    }
    request = urllib.request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status >= 300:
            raise RuntimeError(f"heartbeat failed: HTTP {response.status}")


def main() -> None:
    endpoint = os.getenv("LOCAL_NODE_HEARTBEAT_URL", "").strip()
    token = os.getenv("LOCAL_NODE_TOKEN", "").strip()
    if not endpoint or not token:
        raise SystemExit("請先設定 LOCAL_NODE_HEARTBEAT_URL 與 LOCAL_NODE_TOKEN。")
    print(f"iBrain 本機節點 {VERSION} 啟動；每 30 秒回報一次狀態。")
    while True:
        try:
            heartbeat(endpoint, token)
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳成功")
        except (urllib.error.URLError, RuntimeError, TimeoutError) as error:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "心跳失敗:", error)
        time.sleep(30)


if __name__ == "__main__":
    main()
