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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const usageLogs = sqliteTable("usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  model: text("model").notNull(),
  source: text("source").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  fileSearchCalls: integer("file_search_calls").notNull().default(0),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const studyPlans = sqliteTable("study_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  targetLabel: text("target_label").notNull(),
  dailyMinutes: integer("daily_minutes").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const studyTasks = sqliteTable("study_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull().references(() => studyPlans.id, { onDelete: "cascade" }),
  taskDate: text("task_date").notNull(),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  title: text("title").notNull().default("司律導師對話"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  text: text("text").notNull(),
  source: text("source"),
  model: text("model"),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
