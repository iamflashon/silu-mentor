type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function firstArray(records: Array<UnknownRecord | null>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = asArray(record?.[key]);
      if (value.length) return value;
    }
  }
  return [];
}

function firstArrayDeep(records: Array<UnknownRecord | null>, keys: string[]) {
  const direct = firstArray(records, keys);
  if (direct.length) return direct;
  for (const record of records) {
    if (!record) continue;
    for (const value of Object.values(record)) {
      const nested = asRecord(value);
      if (!nested) continue;
      const found = firstArray([nested], keys);
      if (found.length) return found;
    }
  }
  return [];
}

function firstNumber(records: Array<UnknownRecord | null>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = Number(record?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
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
  const result = asRecord(root.result);
  const data = asRecord(root.data);
  const nestedResult = asRecord(nested?.result);
  const facts = asRecord(root.facts) ?? asRecord(nested?.facts);
  const candidates = [root, nested, result, data, nestedResult, facts];
  return {
    ...root,
    ...(nested ?? {}),
    chapters: firstArrayDeep(candidates, ["chapters", "chapterCandidates", "chapter_candidates", "sections", "outline"]),
    questions: firstArrayDeep(candidates, ["questions", "questionCandidates", "question_candidates"]),
    storedChapterCount: firstNumber(candidates, ["chapterCount", "topicCount"]),
    storedQuestionCount: firstNumber(candidates, ["questionCount"]),
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
    chapterCount: Math.max(
      fallbackChapterCount,
      topicCount,
      chapterCandidates.length,
      Number(analysis.storedChapterCount ?? 0),
    ),
    topicCount,
    questionCount: Math.max(
      fallbackQuestionCount,
      questions.length,
      questionCandidates.length,
      Number(analysis.storedQuestionCount ?? 0),
    ),
  };
}
