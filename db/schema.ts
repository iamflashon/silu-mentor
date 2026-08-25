import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  role: text("role").notNull().default("student"),
  canAdmin: integer("can_admin", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  className: text("class_name").notNull().default("未分班"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const memberPasswordResetRequests = sqliteTable(
  "member_password_reset_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    requestedAt: integer("requested_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    completedBy: text("completed_by").notNull().default(""),
  },
  (table) => [
    index("member_password_reset_requests_member_status_idx").on(
      table.memberId,
      table.status,
    ),
    index("member_password_reset_requests_requested_idx").on(table.requestedAt),
  ],
);

export const medtechDeviceSessions = sqliteTable(
  "medtech_device_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    deviceKey: text("device_key").notNull(),
    deviceLabel: text("device_label").notNull().default("未知裝置"),
    ipHash: text("ip_hash").notNull().default(""),
    userAgentHash: text("user_agent_hash").notNull().default(""),
    lastPath: text("last_path").notNull().default(""),
    status: text("status").notNull().default("active"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("medtech_device_sessions_user_device_unique").on(
      table.userKey,
      table.deviceKey,
    ),
    index("medtech_device_sessions_user_status_idx").on(
      table.userKey,
      table.status,
    ),
    index("medtech_device_sessions_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const medtechSecurityEvents = sqliteTable(
  "medtech_security_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    deviceKey: text("device_key").notNull().default(""),
    deviceLabel: text("device_label").notNull().default("未知裝置"),
    ipHash: text("ip_hash").notNull().default(""),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("medtech_security_events_user_created_idx").on(
      table.userKey,
      table.createdAt,
    ),
    index("medtech_security_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
  ],
);

export const memberAccountDeletionAudits = sqliteTable(
  "member_account_deletion_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deletionRef: text("deletion_ref").notNull().unique(),
    actorType: text("actor_type").notNull().default("member_self_service"),
    requestChannel: text("request_channel").notNull().default("authenticated_member_portal"),
    authenticationMethod: text("authentication_method").notNull().default("session_password_confirmation_phrase"),
    outcome: text("outcome").notNull().default("started"),
    ipHash: text("ip_hash").notNull().default(""),
    userAgentHash: text("user_agent_hash").notNull().default(""),
    retainedPaymentOrders: integer("retained_payment_orders").notNull().default(0),
    paymentDataAnonymized: integer("payment_data_anonymized", { mode: "boolean" }).notNull().default(false),
    learningDataDeleted: integer("learning_data_deleted", { mode: "boolean" }).notNull().default(false),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("member_account_deletion_audits_ref_unique").on(table.deletionRef),
    index("member_account_deletion_audits_requested_idx").on(table.requestedAt),
  ],
);

export const memberExamAccess = sqliteTable(
  "member_exam_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    examCategory: text("exam_category").notNull(),
    status: text("status").notNull().default("active"),
    canAdmin: integer("can_admin", { mode: "boolean" })
      .notNull()
      .default(false),
    permissionsJson: text("permissions_json").notNull().default("[]"),
    className: text("class_name").notNull().default("未分班"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("member_exam_access_member_category_unique").on(
      table.memberId,
      table.examCategory,
    ),
    index("member_exam_access_category_status_idx").on(
      table.examCategory,
      table.status,
    ),
  ],
);

export const medtechProducts = sqliteTable("medtech_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productKey: text("product_key").notNull().unique(),
  title: text("title").notNull(),
  listPrice: integer("list_price").notNull().default(199),
  salePrice: integer("sale_price"),
  saleLabel: text("sale_label").notNull().default(""),
  saleStartsAt: integer("sale_starts_at", { mode: "timestamp" }),
  saleEndsAt: integer("sale_ends_at", { mode: "timestamp" }),
  accessDays: integer("access_days").notNull().default(30),
  trialQuestions: integer("trial_questions").notNull().default(30),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const medtechMemberEntitlements = sqliteTable(
  "medtech_member_entitlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    note: text("note").notNull().default(""),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("medtech_member_entitlements_member_product_unique").on(table.memberId, table.productKey),
    index("medtech_member_entitlements_product_expiry_idx").on(table.productKey, table.expiresAt),
  ],
);

export const accountingProducts = sqliteTable("accounting_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productKey: text("product_key").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  descriptionHtml: text("description_html").notNull().default(""),
  coverStorageKey: text("cover_storage_key"),
  listPrice: integer("list_price").notNull().default(249),
  salePrice: integer("sale_price"),
  saleLabel: text("sale_label").notNull().default(""),
  saleStartsAt: integer("sale_starts_at", { mode: "timestamp" }),
  saleEndsAt: integer("sale_ends_at", { mode: "timestamp" }),
  accessDays: integer("access_days").notNull().default(90),
  trialQuestions: integer("trial_questions").notNull().default(10),
  renewalMode: text("renewal_mode").notNull().default("extend"),
  status: text("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(10),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const accountingMemberEntitlements = sqliteTable("accounting_member_entitlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  productKey: text("product_key").notNull(),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("manual"),
  startsAt: integer("starts_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  note: text("note").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("accounting_member_entitlements_member_product_unique").on(table.memberId, table.productKey),
  index("accounting_member_entitlements_product_expiry_idx").on(table.productKey, table.expiresAt),
]);

export const aiAccessEntitlements = sqliteTable(
  "ai_access_entitlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("manual"),
    quotaTotal: integer("quota_total").notNull().default(30),
    quotaUsed: integer("quota_used").notNull().default(0),
    coachRoundsUsed: integer("coach_rounds_used").notNull().default(0),
    coachWebSearchUsed: integer("coach_web_search_used").notNull().default(0),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    referenceId: text("reference_id").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("ai_access_entitlements_member_expiry_idx").on(table.memberId, table.expiresAt),
  ],
);

export const aiAccessLedger = sqliteTable(
  "ai_access_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entitlementId: integer("entitlement_id").notNull().references(() => aiAccessEntitlements.id, { onDelete: "cascade" }),
    memberId: integer("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    action: text("action").notNull(),
    requestKey: text("request_key").notNull().default(""),
    description: text("description").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_access_ledger_request_unique").on(table.memberId, table.requestKey),
    index("ai_access_ledger_member_created_idx").on(table.memberId, table.createdAt),
  ],
);

export const activationCodes = sqliteTable(
  "activation_codes",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id"),
    codeHash: text("code_hash").notNull().unique(),
    last4: text("last4").notNull(),
    label: text("label").notNull(),
    benefitType: text("benefit_type").notNull(),
    examCategory: text("exam_category").notNull().default(""),
    productKey: text("product_key").notNull().default(""),
    quota: integer("quota").notNull().default(0),
    durationDays: integer("duration_days").notNull().default(30),
    status: text("status").notNull().default("unused"),
    redeemBy: integer("redeem_by", { mode: "timestamp" }),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
    redeemedByMemberId: integer("redeemed_by_member_id").references(() => members.id, { onDelete: "set null" }),
    selectedUnitKey: text("selected_unit_key").notNull().default(""),
    selectedUnitLabel: text("selected_unit_label").notNull().default(""),
    createdBy: text("created_by").notNull().default(""),
    createdByMemberId: integer("created_by_member_id").references(() => members.id, { onDelete: "set null" }),
    disabledBy: text("disabled_by").notNull().default(""),
    disabledReason: text("disabled_reason").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("activation_codes_status_created_idx").on(table.status, table.createdAt),
    index("activation_codes_redeemed_member_idx").on(table.redeemedByMemberId),
  ],
);

export const activationCodeBatches = sqliteTable("activation_code_batches", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  purpose: text("purpose").notNull(),
  benefitType: text("benefit_type").notNull(),
  quantity: integer("quantity").notNull(),
  createdByMemberId: integer("created_by_member_id").references(() => members.id, { onDelete: "set null" }),
  createdByEmail: text("created_by_email").notNull(),
  dailyLimit: integer("daily_limit").notNull(),
  monthlyLimit: integer("monthly_limit").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("activation_code_batches_creator_created_idx").on(table.createdByMemberId, table.createdAt)]);

export const activationCodeAuditLogs = sqliteTable("activation_code_audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeId: text("code_id").references(() => activationCodes.id, { onDelete: "set null" }),
  batchId: text("batch_id").references(() => activationCodeBatches.id, { onDelete: "set null" }),
  actorMemberId: integer("actor_member_id").references(() => members.id, { onDelete: "set null" }),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("activation_code_audit_code_created_idx").on(table.codeId, table.createdAt), index("activation_code_audit_actor_created_idx").on(table.actorMemberId, table.createdAt)]);

export const aiPaymentOrders = sqliteTable(
  "ai_payment_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
    orderId: text("order_id").notNull().unique(),
    transactionId: text("transaction_id"),
    environment: text("environment").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("TWD"),
    quota: integer("quota").notNull(),
    durationDays: integer("duration_days").notNull(),
    status: text("status").notNull().default("pending"),
    returnCode: text("return_code"),
    returnMessage: text("return_message"),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("ai_payment_orders_member_created_idx").on(table.memberId, table.createdAt),
    index("ai_payment_orders_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  examCategory: text("exam_category").notNull().default("law"),
  bookTitle: text("book_title").notNull().default(""),
  subject: text("subject").notNull(),
  documentType: text("document_type").notNull(),
  status: text("status").notNull().default("uploaded"),
  openaiFileId: text("openai_file_id"),
  indexError: text("index_error"),
  processingStage: text("processing_stage").notNull().default("queued"),
  processingMessage: text("processing_message")
    .notNull()
    .default("等待自動處理"),
  fileSha256: text("file_sha256"),
  pageCount: integer("page_count"),
  extractedChars: integer("extracted_chars").notNull().default(0),
  chapterCount: integer("chapter_count").notNull().default(0),
  questionCount: integer("question_count").notNull().default(0),
  tagsJson: text("tags_json").notNull().default("[]"),
  processingResultJson: text("processing_result_json").notNull().default("{}"),
  fullTextIndexed: integer("full_text_indexed", { mode: "boolean" })
    .notNull()
    .default(false),
  vectorIndexed: integer("vector_indexed", { mode: "boolean" })
    .notNull()
    .default(false),
  homepageSearchEnabled: integer("homepage_search_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  processedAt: integer("processed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A company document is stored once, then assigned to any number of learning
// platforms/subjects.  Legacy examCategory/subject columns remain as the
// primary assignment so existing documents continue to work unchanged.
export const documentAssignments = sqliteTable(
  "document_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    examCategory: text("exam_category").notNull(),
    subject: text("subject").notNull().default("綜合"),
    usageType: text("usage_type").notNull().default("教材檢索"),
    visibility: text("visibility").notNull().default("members"),
    aiSearchEnabled: integer("ai_search_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("document_assignments_document_category_subject_unique").on(
      table.documentId,
      table.examCategory,
      table.subject,
    ),
    index("document_assignments_category_subject_idx").on(
      table.examCategory,
      table.subject,
    ),
  ],
);

// Fine-grained, page-authoritative retrieval units.  Each unit is small enough
// for precise matching but retains its page and hierarchy path for citations.
export const documentSearchUnits = sqliteTable(
  "document_search_units",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    unitType: text("unit_type").notNull().default("paragraph_window"),
    hierarchyPath: text("hierarchy_path").notNull().default(""),
    title: text("title").notNull().default(""),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    sequence: integer("sequence").notNull().default(0),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull().default(""),
    keywordsJson: text("keywords_json").notNull().default("[]"),
    contentHash: text("content_hash").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("document_search_units_document_sequence_unique").on(
      table.documentId,
      table.sequence,
    ),
    index("document_search_units_document_page_idx").on(
      table.documentId,
      table.pageStart,
    ),
  ],
);

export const medtechUsage = sqliteTable("medtech_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull().unique(),
  audioTrialQuestionIdsJson: text("audio_trial_question_ids_json")
    .notNull()
    .default("[]"),
  aiCredits: integer("ai_credits").notNull().default(10),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const medtechPointLedger = sqliteTable(
  "medtech_point_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    action: text("action").notNull(),
    description: text("description").notNull(),
    questionId: integer("question_id"),
    sourceDetail: text("source_detail"),
    availableUntil: integer("available_until", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("medtech_point_ledger_user_created_idx").on(
      table.userKey,
      table.createdAt,
    ),
  ],
);

export const medtechPaymentOrders = sqliteTable(
  "medtech_payment_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    orderId: text("order_id").notNull().unique(),
    transactionId: text("transaction_id").unique(),
    provider: text("provider").notNull().default("line_pay"),
    environment: text("environment").notNull().default("sandbox"),
    packageName: text("package_name").notNull(),
    packNumber: integer("pack_number").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("TWD"),
    status: text("status").notNull().default("pending"),
    returnCode: text("return_code"),
    returnMessage: text("return_message"),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    activatedAt: integer("activated_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("medtech_payment_orders_user_created_idx").on(
      table.userKey,
      table.createdAt,
    ),
    index("medtech_payment_orders_package_status_idx").on(
      table.userKey,
      table.packageName,
      table.packNumber,
      table.status,
    ),
  ],
);

export const medtechPracticeSessions = sqliteTable(
  "medtech_practice_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    packageName: text("package_name").notNull(),
    packNumber: integer("pack_number").notNull().default(1),
    packageType: text("package_type").notNull().default("chapter"),
    questionIdsJson: text("question_ids_json").notNull().default("[]"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    status: text("status").notNull().default("in_progress"),
    lastActiveAt: integer("last_active_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastQuestionIndex: integer("last_question_index").notNull().default(0),
    answerDetailsJson: text("answer_details_json").notNull().default("[]"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    totalQuestions: integer("total_questions").notNull().default(0),
    answeredQuestions: integer("answered_questions").notNull().default(0),
    correctQuestions: integer("correct_questions").notNull().default(0),
    incorrectQuestionIdsJson: text("incorrect_question_ids_json")
      .notNull()
      .default("[]"),
    repeatedWrongQuestionIdsJson: text("repeated_wrong_question_ids_json")
      .notNull()
      .default("[]"),
    weaknessesJson: text("weaknesses_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("medtech_practice_sessions_user_created_idx").on(
      table.userKey,
      table.createdAt,
    ),
  ],
);

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

export const legalExplanationCache = sqliteTable("legal_explanation_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cacheKey: text("cache_key").notNull().unique(),
  model: text("model").notNull(),
  explanation: text("explanation").notNull(),
  analysisJson: text("analysis_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const organizedNoteCache = sqliteTable("organized_note_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cacheKey: text("cache_key").notNull().unique(),
  model: text("model").notNull(),
  noteJson: text("note_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" })
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
  sessionDate: text("session_date"),
  summary: text("summary").notNull().default(""),
  progressStatus: text("progress_status").notNull().default("open"),
  contextType: text("context_type").notNull().default("home"),
  resourceId: integer("resource_id"),
  segmentId: integer("segment_id"),
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
  citationStatus: text("citation_status"),
  comparisonJson: text("comparison_json"),
  model: text("model"),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const learningPreferences = sqliteTable("learning_preferences", {
  userKey: text("user_key").primaryKey(),
  bookTeachingLevel: text("book_teaching_level"),
  bookModelMode: text("book_model_mode").notNull().default("luna"),
  bookSettingsPinned: integer("book_settings_pinned", { mode: "boolean" })
    .notNull()
    .default(false),
  lastBookResourceId: integer("last_book_resource_id"),
  lastBookSegmentId: integer("last_book_segment_id"),
  lastBookSessionId: integer("last_book_session_id").references(
    () => chatSessions.id,
    {
      onDelete: "set null",
    },
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" })
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

export const issuePracticeRecords = sqliteTable(
  "issue_practice_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    questionId: integer("question_id")
      .notNull()
      .references(() => examQuestions.id, { onDelete: "cascade" }),
    studentIssues: text("student_issues").notNull().default(""),
    studentSupplement: text("student_supplement").notNull().default(""),
    sampleLevel: text("sample_level"),
    lunaResultJson: text("luna_result_json"),
    solResultJson: text("sol_result_json"),
    challengeWorkflowJson: text("challenge_workflow_json"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("issue_practice_records_user_question_unique").on(
      table.userKey,
      table.questionId,
    ),
  ],
);

export const personalIssueQuestions = sqliteTable(
  "personal_issue_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    title: text("title").notNull(),
    subject: text("subject").notNull().default("未分類"),
    sourceLabel: text("source_label").notNull().default("我的書籍"),
    questionText: text("question_text").notNull(),
    imageStorageKey: text("image_storage_key"),
    imageContentType: text("image_content_type"),
    imageStorageKeysJson: text("image_storage_keys_json")
      .notNull()
      .default("[]"),
    imageContentTypesJson: text("image_content_types_json")
      .notNull()
      .default("[]"),
    ocrPartsJson: text("ocr_parts_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("personal_issue_questions_user_updated_idx").on(
      table.userKey,
      table.updatedAt,
    ),
    index("personal_issue_questions_user_subject_idx").on(
      table.userKey,
      table.subject,
    ),
  ],
);

export const personalIssuePracticeRecords = sqliteTable(
  "personal_issue_practice_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    personalQuestionId: integer("personal_question_id")
      .notNull()
      .references(() => personalIssueQuestions.id, { onDelete: "cascade" }),
    studentIssues: text("student_issues").notNull().default(""),
    aiResultJson: text("ai_result_json"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("personal_issue_records_user_question_unique").on(
      table.userKey,
      table.personalQuestionId,
    ),
  ],
);

export const learningAnalyses = sqliteTable("learning_analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  sourceRecordCount: integer("source_record_count").notNull().default(0),
  sourceLatestRecordId: integer("source_latest_record_id").notNull().default(0),
  statusLabel: text("status_label").notNull(),
  summary: text("summary").notNull(),
  strengthsJson: text("strengths_json").notNull().default("[]"),
  gapsJson: text("gaps_json").notNull().default("[]"),
  nextAction: text("next_action").notNull(),
  recommendationsJson: text("recommendations_json").notNull().default("[]"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
    .notNull()
    .default(0),
  generatedAt: integer("generated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
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
  originalContent: text("original_content").notNull().default(""),
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

export const noteAttachments = sqliteTable("note_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  noteId: integer("note_id")
    .notNull()
    .references(() => savedNotes.id, { onDelete: "cascade" }),
  userKey: text("user_key").notNull(),
  kind: text("kind").notNull().default("screenshot"),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull().default("image/jpeg"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sourceUrl: text("source_url").notNull().default(""),
  episodeTitle: text("episode_title").notNull().default(""),
  positionSeconds: integer("position_seconds").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examQuestions = sqliteTable("exam_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  examType: text("exam_type").notNull(),
  examCategory: text("exam_category").notNull().default("law"),
  year: text("year").notNull(),
  examName: text("exam_name").notNull().default("類科待辨識"),
  subject: text("subject").notNull(),
  questionNumber: text("question_number").notNull(),
  stem: text("stem").notNull(),
  optionsJson: text("options_json"),
  correctAnswer: text("correct_answer"),
  explanation: text("explanation").notNull().default(""),
  completeExplanation: text("complete_explanation").notNull().default(""),
  aiCompleteExplanation: text("ai_complete_explanation").notNull().default(""),
  teacherCompleteExplanation: text("teacher_complete_explanation")
    .notNull()
    .default(""),
  voiceScript: text("voice_script").notNull().default(""),
  teacherAnswer: text("teacher_answer").notNull().default(""),
  teacherNotes: text("teacher_notes").notNull().default(""),
  rubricJson: text("rubric_json").notNull().default("[]"),
  answerSource: text("answer_source").notNull().default(""),
  answerStatus: text("answer_status").notNull().default("missing"),
  simulatedAnswer: text("simulated_answer").notNull().default(""),
  simulatedExplanation: text("simulated_explanation").notNull().default(""),
  simulatedCompleteExplanation: text("simulated_complete_explanation")
    .notNull()
    .default(""),
  simulatedSource: text("simulated_source").notNull().default(""),
  simulatedAnswerStatus: text("simulated_answer_status")
    .notNull()
    .default("missing"),
  simulatedTeacherNote: text("simulated_teacher_note").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  sourceOrder: integer("source_order"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const medtechQuestionEvidenceReviews = sqliteTable(
  "medtech_question_evidence_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => examQuestions.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull().default(""),
    provider: text("provider").notNull().default("openai_web_search"),
    queryText: text("query_text").notNull().default(""),
    resultJson: text("result_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("medtech_question_evidence_reviews_question_idx").on(
      table.questionId,
      table.createdAt,
    ),
  ],
);

export const medtechAiExplanationCache = sqliteTable(
  "medtech_ai_explanation_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cacheKey: text("cache_key").notNull().unique(),
    questionId: integer("question_id")
      .notNull()
      .references(() => examQuestions.id, { onDelete: "cascade" }),
    answer: text("answer").notNull().default(""),
    level: text("level").notNull().default("入門"),
    reply: text("reply").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);

export const examAttempts = sqliteTable("exam_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => examQuestions.id, { onDelete: "cascade" }),
  selectedAnswer: text("selected_answer"),
  correct: integer("correct", { mode: "boolean" }),
  answerText: text("answer_text"),
  gradingJson: text("grading_json").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const examCoachMessages = sqliteTable("exam_coach_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => examQuestions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const guidedPracticeSessions = sqliteTable(
  "guided_practice_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userKey: text("user_key").notNull(),
    questionId: integer("question_id")
      .notNull()
      .references(() => examQuestions.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("guided"),
    status: text("status").notNull().default("in_progress"),
    stateJson: text("state_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userQuestionUnique: uniqueIndex("guided_practice_user_question_idx").on(
      table.userKey,
      table.questionId,
    ),
  }),
);

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
  examName: text("exam_name").notNull().default("類科待辨識"),
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

export const courseCollections = sqliteTable("course_collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const courseCollectionItems = sqliteTable("course_collection_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => courseCollections.id, { onDelete: "cascade" }),
  resourceId: integer("resource_id")
    .notNull()
    .references(() => learningResources.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const myCourses = sqliteTable("my_courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceKind: text("source_kind").notNull().default("video"),
  playlistId: text("playlist_id"),
  videoId: text("video_id"),
  subject: text("subject").notNull().default("綜合"),
  examType: text("exam_type").notNull().default("一試／二試"),
  scope: text("scope").notNull().default("全科"),
  relevanceLabel: text("relevance_label").notNull().default("待確認"),
  relevanceScore: integer("relevance_score").notNull().default(0),
  metadataJson: text("metadata_json").notNull().default("{}"),
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
  sourceUrl: text("source_url").notNull().default(""),
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
  rating: integer("rating").notNull().default(0),
  errorTypesJson: text("error_types_json").notNull().default("[]"),
  studentNote: text("student_note").notNull().default(""),
  model: text("model").notNull().default(""),
  originalPrompt: text("original_prompt").notNull().default(""),
  reviewStatus: text("review_status").notNull().default("pending"),
  solRequested: integer("sol_requested", { mode: "boolean" })
    .notNull()
    .default(false),
  solReview: text("sol_review").notNull().default(""),
  teacherDecision: text("teacher_decision").notNull().default(""),
  teacherNote: text("teacher_note").notNull().default(""),
  correctedContent: text("corrected_content").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatComparisons = sqliteTable("chat_comparisons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  sessionId: integer("session_id").references(() => chatSessions.id, {
    onDelete: "set null",
  }),
  contextType: text("context_type").notNull().default("home"),
  promptText: text("prompt_text").notNull(),
  sourceStatus: text("source_status").notNull().default("unavailable"),
  sourceJson: text("source_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chatComparisonResponses = sqliteTable(
  "chat_comparison_responses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    comparisonId: integer("comparison_id")
      .notNull()
      .references(() => chatComparisons.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    label: text("label").notNull(),
    text: text("text").notNull().default(""),
    source: text("source").notNull().default("AI 補充"),
    citationsJson: text("citations_json"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsdMicros: integer("estimated_cost_usd_micros")
      .notNull()
      .default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
);

export const chatComparisonRatings = sqliteTable("chat_comparison_ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  comparisonId: integer("comparison_id")
    .notNull()
    .references(() => chatComparisons.id, { onDelete: "cascade" }),
  responseId: integer("response_id")
    .notNull()
    .references(() => chatComparisonResponses.id, { onDelete: "cascade" }),
  userKey: text("user_key").notNull(),
  score: integer("score").notNull().default(0),
  feedbackType: text("feedback_type").notNull().default("rated"),
  note: text("note").notNull().default(""),
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
  classification: text("classification").notNull().default(""),
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

export const reviewRuns = sqliteTable("review_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => examQuestions.id, { onDelete: "cascade" }),
  participantMode: text("participant_mode").notNull().default("ai-scholar"),
  teacherModel: text("teacher_model").notNull(),
  scholarModelsJson: text("scholar_models_json").notNull().default("[]"),
  commentatorModel: text("commentator_model").notNull().default("gpt-5.6-sol"),
  stageCount: integer("stage_count").notNull().default(0),
  status: text("status").notNull().default("completed"),
  resultJson: text("result_json").notNull().default("{}"),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
