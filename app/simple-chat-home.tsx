"use client";

import Image from "next/image";
import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, ReactNode, useRef, useState } from "react";
import styles from "./simple-chat-home.module.css";

type ChatMessage = {
  role: "student" | "mentor";
  text: string;
  usage?: ChatUsage;
  attachmentName?: string;
};

type ChatUsage = { model: string; inputTokens: number; cachedTokens?: number; outputTokens: number; estimatedCostUsd: number };
type Attachment = { name: string; type: string; size: number; dataUrl: string };

type ChatResponse = {
  reply?: string;
  error?: string;
  code?: string;
  signIn?: string;
  sessionId?: number;
  usage?: ChatUsage;
};

type SimpleChatHomeProps = {
  brand?: string;
  symbol?: string;
  logoSrc?: string;
  heroLogoSrc?: string;
  greeting?: string;
  knowledgeScope?: "all" | "anglepedia";
  endpoint?: string;
};

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      parts.push(link ? <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : token);
    }
    cursor = index + token.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function MarkdownMessage({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const content = renderInlineMarkdown(heading[2], `heading-${index}`);
      blocks.push(heading[1].length <= 2
        ? <h2 key={`heading-${index}`}>{content}</h2>
        : <h3 key={`heading-${index}`}>{content}</h3>);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={`ul-${index}`}>{renderInlineMarkdown(item, `ul-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-block-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*\d+\.\s+/, "");
        items.push(<li key={`ol-${index}`}>{renderInlineMarkdown(item, `ol-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-block-${index}`}>{items}</ol>);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+/.test(lines[index]) && !/^\s*[-*]\s+/.test(lines[index]) && !/^\s*\d+\.\s+/.test(lines[index]) && !lines[index].trimStart().startsWith("```")) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {paragraphLines.map((paragraphLine, lineIndex) => (
          <span key={`line-${index}-${lineIndex}`}>
            {lineIndex > 0 && <br />}
            {renderInlineMarkdown(paragraphLine.trim(), `paragraph-${index}-${lineIndex}`)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className={styles.markdown}>{blocks}</div>;
}

export default function SimpleChatHome({ brand = "iBrain Pedia X", symbol = "智", logoSrc, heroLogoSrc, greeting = "有什麼我可以幫忙的？", knowledgeScope = "all", endpoint = "/api/chat" }: SimpleChatHomeProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim() || (attachment ? `請分析這份${attachment.type.startsWith("image/") ? "圖片" : "文件"}：${attachment.name}` : "");
    if (!question || thinking) return;

    const submittedAttachment = attachment;
    const nextMessages: ChatMessage[] = [...messages, { role: "student", text: question, attachmentName: submittedAttachment?.name }];
    setMessages(nextMessages);
    setInput("");
    setAttachment(null);
    setAttachmentError("");
    setThinking(true);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          sessionId,
          context: { type: "home" },
          modelMode: "auto",
          teachingLevel: "general",
          assistantMode: "advisor",
          centralTestMode: true,
          knowledgeScope,
          ...(submittedAttachment?.type.startsWith("image/") ? { imageDataUrl: submittedAttachment.dataUrl } : submittedAttachment ? { fileDataUrl: submittedAttachment.dataUrl, fileName: submittedAttachment.name, fileMimeType: submittedAttachment.type } : {}),
          persistStudentMessage: true,
          requestKey: crypto.randomUUID(),
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("請先登入後再開始對話。");
      }
      const result = await response.json() as ChatResponse;
      if (!response.ok || !result.reply) {
        if (result.code === "SIGN_IN_REQUIRED" && result.signIn) {
          throw new Error(`${result.error || "請先登入。"}\n\n[使用 ChatGPT 帳號登入](${result.signIn})`);
        }
        throw new Error(result.error || "暫時無法取得回覆，請稍後再試。");
      }
      if (typeof result.sessionId === "number") setSessionId(result.sessionId);
      setMessages((current) => [...current, { role: "mentor", text: result.reply!, usage: result.usage }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "mentor",
        text: error instanceof Error ? error.message : "暫時無法取得回覆，請稍後再試。",
      }]);
    } finally {
      setThinking(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function startNewChat() {
    setMessages([]);
    setSessionId(null);
    setInput("");
    setAttachment(null);
    setAttachmentError("");
    inputRef.current?.focus();
  }

  function loadAttachment(file: File) {
    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const isDocument = ["application/pdf", "text/plain", "text/markdown"].includes(file.type) || /\.(pdf|txt|md)$/i.test(file.name);
    const maxBytes = isImage ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
    if (!isImage && !isDocument) {
      setAttachmentError("只接受 JPG、PNG、WebP、PDF、TXT 或 Markdown。");
      return;
    }
    if (file.size > maxBytes) {
      setAttachmentError(isImage ? "圖片不可超過 4 MB。" : "文件不可超過 8 MB。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setAttachment({ name: file.name.slice(0, 120), type: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain"), size: file.size, dataUrl: reader.result });
      setAttachmentError("");
    };
    reader.onerror = () => setAttachmentError("檔案讀取失敗，請重新選擇。");
    reader.readAsDataURL(file);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) loadAttachment(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    if (!file) return;
    event.preventDefault();
    loadAttachment(file);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.brand} type="button" onClick={startNewChat} aria-label="開始新對話">
          {logoSrc ? <Image className={styles.brandLogo} src={logoSrc} width={38} height={38} alt="" aria-hidden="true" /> : <span aria-hidden="true">{symbol}</span>}
          <strong>{brand}</strong>
        </button>
        <button className={styles.newChat} type="button" onClick={startNewChat}>新對話</button>
      </header>

      <section className={`${styles.conversation} ${messages.length ? styles.hasMessages : ""}`} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            {heroLogoSrc ? <Image className={styles.heroWordmark} src={heroLogoSrc} width={2048} height={768} alt={brand} priority /> : logoSrc ? <div className={styles.heroIdentity}><Image className={styles.emptyLogo} src={logoSrc} width={56} height={56} alt="" aria-hidden="true" /><strong>{brand}</strong></div> : <span aria-hidden="true">{symbol}</span>}
            <h1>{greeting}</h1>
          </div>
        ) : messages.map((message, index) => (
          <article className={`${styles.message} ${message.role === "student" ? styles.student : styles.mentor}`} key={`${message.role}-${index}`}>
            {message.role === "mentor" && (logoSrc ? <Image className={styles.avatarLogo} src={logoSrc} width={32} height={32} alt="" aria-hidden="true" /> : <span className={styles.avatar} aria-hidden="true">{symbol}</span>)}
            <div>
              {message.attachmentName && <small className={styles.attachmentInMessage}>附件：{message.attachmentName}</small>}
              {message.role === "mentor" ? <MarkdownMessage text={message.text} /> : <div>{message.text}</div>}
              {message.role === "mentor" && message.usage && (
                <small className={styles.usage}>
                  {message.usage.model === "gpt-5.6-luna" ? "Luna" : message.usage.model === "central-question-bank" ? "中央題庫" : message.usage.model}
                  {` · 輸入 ${message.usage.inputTokens.toLocaleString()} · 輸出 ${message.usage.outputTokens.toLocaleString()} tokens · 約 US$${message.usage.estimatedCostUsd.toFixed(6)}`}
                </small>
              )}
            </div>
          </article>
        ))}
        {thinking && (
          <article className={`${styles.message} ${styles.mentor}`}>
            <span className={styles.avatar} aria-hidden="true">{symbol}</span>
            <div className={styles.thinking} aria-label="正在思考"><i /><i /><i /></div>
          </article>
        )}
      </section>

      <div className={styles.composerDock}>
        {(attachment || attachmentError) && <div className={styles.attachmentBar}>{attachment ? <><span>{attachment.name} · {(attachment.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" onClick={() => setAttachment(null)} aria-label="移除附件">×</button></> : <span className={styles.attachmentError}>{attachmentError}</span>}</div>}
        <form className={styles.composer} onSubmit={sendMessage}>
          <input ref={fileRef} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,text/markdown,.md" onChange={selectFile} />
          <button className={styles.attachButton} type="button" onClick={() => fileRef.current?.click()} disabled={thinking} aria-label="上傳圖片或文件">＋</button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="輸入訊息"
            rows={1}
            aria-label="輸入訊息"
          />
          <button className={styles.sendButton} type="submit" disabled={(!input.trim() && !attachment) || thinking} aria-label="送出訊息">↑</button>
        </form>
      </div>
    </main>
  );
}
