"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import styles from "./simple-chat-home.module.css";

type ChatMessage = {
  role: "student" | "mentor";
  text: string;
};

type ChatResponse = {
  reply?: string;
  error?: string;
  sessionId?: number;
};

export default function SimpleChatHome() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || thinking) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "student", text: question }];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          sessionId,
          context: { type: "home" },
          modelMode: "auto",
          teachingLevel: "general",
          assistantMode: "advisor",
          persistStudentMessage: true,
          requestKey: crypto.randomUUID(),
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("請先登入後再開始對話。");
      }
      const result = await response.json() as ChatResponse;
      if (!response.ok || !result.reply) throw new Error(result.error || "暫時無法取得回覆，請稍後再試。");
      if (typeof result.sessionId === "number") setSessionId(result.sessionId);
      setMessages((current) => [...current, { role: "mentor", text: result.reply! }]);
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
    inputRef.current?.focus();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.brand} type="button" onClick={startNewChat} aria-label="開始新對話">
          <span aria-hidden="true">智</span>
          <strong>iBrain</strong>
        </button>
        <button className={styles.newChat} type="button" onClick={startNewChat}>新對話</button>
      </header>

      <section className={`${styles.conversation} ${messages.length ? styles.hasMessages : ""}`} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <span aria-hidden="true">智</span>
            <h1>有什麼我可以幫忙的？</h1>
          </div>
        ) : messages.map((message, index) => (
          <article className={`${styles.message} ${message.role === "student" ? styles.student : styles.mentor}`} key={`${message.role}-${index}`}>
            {message.role === "mentor" && <span className={styles.avatar} aria-hidden="true">智</span>}
            <div>{message.text}</div>
          </article>
        ))}
        {thinking && (
          <article className={`${styles.message} ${styles.mentor}`}>
            <span className={styles.avatar} aria-hidden="true">智</span>
            <div className={styles.thinking} aria-label="正在思考"><i /><i /><i /></div>
          </article>
        )}
      </section>

      <div className={styles.composerDock}>
        <form className={styles.composer} onSubmit={sendMessage}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息"
            rows={1}
            aria-label="輸入訊息"
          />
          <button type="submit" disabled={!input.trim() || thinking} aria-label="送出訊息">↑</button>
        </form>
      </div>
    </main>
  );
}
