import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  subject: text("subject").notNull(),
  documentType: text("document_type").notNull(),
  status: text("status").notNull().default("uploaded"),
  openaiFileId: text("openai_file_id"),
  indexError: text("index_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const usageLogs = sqliteTable("usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  model: text("model").notNull(),
  source: text("source").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  fileSearchCalls: integer("file_search_calls").notNull().default(0),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studyPlans = sqliteTable("study_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  targetLabel: text("target_label").notNull(),
  dailyMinutes: integer("daily_minutes").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studyTasks = sqliteTable("study_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id")
    .notNull()
    .references(() => studyPlans.id, { onDelete: "cascade" }),
  taskDate: text("task_date").notNull(),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  title: text("title").notNull().default("司律備考對話"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  text: text("text").notNull(),
  source: text("source"),
  citationsJson: text("citations_json"),
  model: text("model"),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studentMemos = sqliteTable("student_memos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull().unique(),
  content: text("content").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studyRecords = sqliteTable("study_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  taskId: integer("task_id").references(() => studyTasks.id, {
    onDelete: "set null",
  }),
  questionId: integer("question_id"),
  recordDate: text("record_date").notNull(),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  activityType: text("activity_type").notNull(),
  plannedMinutes: integer("planned_minutes").notNull().default(0),
  actualMinutes: integer("actual_minutes").notNull().default(0),
  correct: integer("correct", { mode: "boolean" }),
  reflection: text("reflection").notNull().default(""),
  weakness: text("weakness").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const savedNotes = sqliteTable("saved_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  sourceType: text("source_type").notNull().default("manual"),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  subject: text("subject").notNull().default("綜合"),
  tags: text("tags").notNull().default(""),
  sourceLabel: text("source_label").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examQuestions = sqliteTable("exam_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  examType: text("exam_type").notNull(),
  year: text("year").notNull(),
  subject: text("subject").notNull(),
  questionNumber: text("question_number").notNull(),
  stem: text("stem").notNull(),
  optionsJson: text("options_json"),
  correctAnswer: text("correct_answer"),
  explanation: text("explanation").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examAttempts = sqliteTable("exam_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => examQuestions.id, { onDelete: "cascade" }),
  selectedAnswer: text("selected_answer"),
  correct: integer("correct", { mode: "boolean" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examSources = sqliteTable("exam_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull().unique(),
  label: text("label").notNull(),
  examType: text("exam_type").notNull(),
  sourceKind: text("source_kind").notNull().default("exam"),
  status: text("status").notNull().default("waiting"),
  discoveredCount: integer("discovered_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  questionCount: integer("question_count").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examSourceItems = sqliteTable("exam_source_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id")
    .notNull()
    .references(() => examSources.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull().unique(),
  title: text("title").notNull(),
  year: text("year").notNull().default(""),
  subject: text("subject").notNull().default("綜合"),
  status: text("status").notNull().default("waiting"),
  questionCount: integer("question_count").notNull().default(0),
  error: text("error"),
  processedAt: integer("processed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const learningResources = sqliteTable("learning_resources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  resourceType: text("resource_type").notNull(),
  title: text("title").notNull(),
  subject: text("subject").notNull().default("刑法"),
  creator: text("creator").notNull().default(""),
  description: text("description").notNull().default(""),
  documentId: integer("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  linkedBookId: integer("linked_book_id"),
  coverStorageKey: text("cover_storage_key"),
  sourceUrl: text("source_url").notNull().default(""),
  accessType: text("access_type").notNull().default("owned"),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const resourceSegments = sqliteTable("resource_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  resourceId: integer("resource_id")
    .notNull()
    .references(() => learningResources.id, { onDelete: "cascade" }),
  segmentType: text("segment_type").notNull(),
  lessonLabel: text("lesson_label").notNull().default(""),
  title: text("title").notNull(),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  startSeconds: integer("start_seconds"),
  endSeconds: integer("end_seconds"),
  text: text("text").notNull().default(""),
  summary: text("summary").notNull().default(""),
  importance: integer("importance").notNull().default(0),
  recommended: integer("recommended", { mode: "boolean" })
    .notNull()
    .default(false),
  reviewStatus: text("review_status").notNull().default("draft"),
  sequence: integer("sequence").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messageFeedback = sqliteTable("message_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  sessionId: integer("session_id").references(() => chatSessions.id, {
    onDelete: "set null",
  }),
  messageIndex: integer("message_index").notNull().default(0),
  feedbackType: text("feedback_type").notNull(),
  messageText: text("message_text").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const listeningSolutions = sqliteTable("listening_solutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").references(() => examQuestions.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  year: text("year").notNull().default(""),
  subject: text("subject").notNull().default("刑法"),
  questionText: text("question_text").notNull(),
  narrationScript: text("narration_script").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  audioStorageKey: text("audio_storage_key"),
  audioFileName: text("audio_file_name"),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const listeningAudioSegments = sqliteTable("listening_audio_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listeningId: integer("listening_id")
    .notNull()
    .references(() => listeningSolutions.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull().default("audio/mpeg"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  startOffsetSeconds: integer("start_offset_seconds").notNull().default(0),
  sequence: integer("sequence").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const listeningSubtitleCues = sqliteTable("listening_subtitle_cues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listeningId: integer("listening_id")
    .notNull()
    .references(() => listeningSolutions.id, { onDelete: "cascade" }),
  segmentId: integer("segment_id").references(() => listeningAudioSegments.id, {
    onDelete: "cascade",
  }),
  startSeconds: integer("start_seconds").notNull(),
  endSeconds: integer("end_seconds").notNull(),
  text: text("text").notNull(),
  sequence: integer("sequence").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const legalDataSources = sqliteTable("legal_data_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull().unique(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  sourceUrl: text("source_url").notNull(),
  status: text("status").notNull().default("waiting"),
  documentCount: integer("document_count").notNull().default(0),
  articleCount: integer("article_count").notNull().default(0),
  importCursor: integer("import_cursor").notNull().default(0),
  totalAvailable: integer("total_available").notNull().default(0),
  archiveStorageKey: text("archive_storage_key"),
  lastError: text("last_error"),
  lastDownloadedAt: integer("last_downloaded_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const legalDocuments = sqliteTable("legal_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull(),
  externalId: text("external_id").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull().default(""),
  modifiedDate: text("modified_date").notNull().default(""),
  effectiveDate: text("effective_date").notNull().default(""),
  history: text("history").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  status: text("status").notNull().default("active"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const legalArticles = sqliteTable("legal_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id")
    .notNull()
    .references(() => legalDocuments.id, { onDelete: "cascade" }),
  articleNo: text("article_no").notNull(),
  hierarchy: text("hierarchy").notNull().default(""),
  content: text("content").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const judicialCases = sqliteTable("judicial_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jid: text("jid").notNull().unique(),
  court: text("court").notNull().default(""),
  year: text("year").notNull().default(""),
  caseType: text("case_type").notNull().default(""),
  caseNo: text("case_no").notNull().default(""),
  judgmentDate: text("judgment_date").notNull().default(""),
  title: text("title").notNull().default(""),
  fullText: text("full_text").notNull().default(""),
  rawJson: text("raw_json").notNull().default(""),
  status: text("status").notNull().default("active"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
