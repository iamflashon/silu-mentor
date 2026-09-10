"use client";

import { useState } from "react";
import styles from "./connect.module.css";

export default function ConnectMcpClient() {
  const endpoint = "https://silu-mentor.iamflashon.chatgpt.site/mcp";
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(endpoint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <div className={styles.endpoint}>
    <div><small>MCP SERVER URL</small><code>{endpoint}</code></div>
    <button type="button" onClick={() => void copy()}>{copied ? "已複製" : "複製網址"}</button>
  </div>;
}
