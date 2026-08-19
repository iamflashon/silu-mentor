type ConversationMessage = { role: string; text: string };

function terms(value: string) {
  return new Set((value.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z0-9.-]{2,}/gu) ?? []).map((item) => item.toLowerCase()));
}

export function relevantSections(source: string, query: string, maxChars = 9000) {
  const clean = source.trim();
  if (clean.length <= maxChars) return clean;
  const queryTerms = terms(query);
  const sections = clean.split(/\n\s*\n|(?=^[一二三四五六七八九十]+、)|(?=^\d+[.、])/mu).map((item) => item.trim()).filter(Boolean);
  const ranked = sections.map((text, index) => {
    const sectionTerms = terms(text);
    let score = 0;
    for (const term of queryTerms) if (sectionTerms.has(term)) score += Math.min(6, term.length);
    return { text, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  let used = 0;
  for (const item of ranked) {
    if (used >= maxChars) break;
    const text = item.text.slice(0, maxChars - used);
    if (!text) break;
    selected.push({ ...item, text });
    used += text.length + 2;
  }
  return selected.sort((a, b) => a.index - b.index).map((item) => item.text).join("\n\n");
}

export function compactConversation<T extends ConversationMessage>(messages: T[], recentCount = 6, summaryChars = 1200): T[] {
  const deduped = messages.filter((message, index, all) => {
    const normalized = message.text.replace(/\s+/g, " ").trim();
    return normalized && all.findIndex((candidate) => candidate.role === message.role && candidate.text.replace(/\s+/g, " ").trim() === normalized) === index;
  });
  if (deduped.length <= recentCount) return deduped;
  const older = deduped.slice(0, -recentCount);
  const summary = older.map((message) => `${message.role}：${message.text.replace(/\s+/g, " ").trim().slice(0, 180)}`).join("\n").slice(-summaryChars);
  return [{ ...older[0], role: "mentor", text: `【較早對話摘要】\n${summary}` } as T, ...deduped.slice(-recentCount)];
}

export function inputFingerprint(...values: string[]) {
  let hash = 2166136261;
  const text = values.join("\u241f").replace(/\s+/g, " ").trim();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
