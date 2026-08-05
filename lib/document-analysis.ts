type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function parseStoredProcessingResult(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

/**
 * Older processing runs saved `chapters` and `questions` at the root of the
 * processing result. Newer runs may place them under `analysis`. Read both
 * shapes so already-processed教材 do not appear empty after a deployment.
 */
export function storedDocumentAnalysis(value: string) {
  const root = parseStoredProcessingResult(value);
  const nested = asRecord(root.analysis);
  return {
    ...root,
    ...(nested ?? {}),
    chapters: asArray(root.chapters).length
      ? asArray(root.chapters)
      : asArray(nested?.chapters),
    questions: asArray(root.questions).length
      ? asArray(root.questions)
      : asArray(nested?.questions),
  };
}

function textField(row: unknown, keys: string[]) {
  const record = asRecord(row);
  for (const key of keys) {
    const value = String(record?.[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

export function storedDocumentStats(
  value: string,
  fallbackChapterCount = 0,
  fallbackQuestionCount = 0,
) {
  const analysis = storedDocumentAnalysis(value);
  const chapters = asArray(analysis.chapters);
  const questions = asArray(analysis.questions);
  const facts = asRecord(analysis.facts);
  const chapterCandidates = asArray(facts?.chapterCandidates);
  const questionCandidates = asArray(facts?.questionCandidates);
  const topics = new Set(
    questions
      .map((question) => {
        const section = textField(question, ["section", "part"]);
        const topic = textField(question, ["chapter", "topic", "theme"]);
        return topic ? `${section}|${topic}` : "";
      })
      .filter(Boolean),
  );
  const topicCount = Math.max(topics.size, chapters.length);
  return {
    chapterCount: Math.max(fallbackChapterCount, topicCount, chapterCandidates.length),
    topicCount,
    questionCount: Math.max(
      fallbackQuestionCount,
      questions.length,
      questionCandidates.length,
    ),
  };
}
