import { and, count, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings, documents, examQuestions } from "../db/schema";

export type V2TeacherKey = "pengli" | "kangqing" | "zhenghong";
export type V2ModuleKey = "book" | "coach" | "questionBank" | "grading" | "wrongReview" | "microCourse" | "humanReview" | "legalSearch";
export type V2SpaceStatus = "draft" | "published";
export type V2TeacherConfig = {
  enabled: boolean;
  status: V2SpaceStatus;
  name: string;
  subject: string;
  zoneTitle: string;
  summary: string;
  brands: Array<"get" | "angle">;
  modules: V2ModuleKey[];
};
export type V2Config = {
  brands: Record<"get" | "angle", { enabled: boolean; label: string }>;
  teachers: Record<V2TeacherKey, V2TeacherConfig>;
};

export const defaultV2Config: V2Config = {
  brands: { get: { enabled: true, label: "高點 AI 實戰學習平台" }, angle: { enabled: true, label: "元照 AI 解題室" } },
  teachers: {
    pengli: { enabled: true, status: "published", name: "彭狸", subject: "行政法", zoneTitle: "彭狸行政法 AI 教練", summary: "從教材頁碼、法規查詢到申論批改，建立可追問的行政法學習空間。", brands: ["get", "angle"], modules: ["book", "coach", "questionBank", "grading", "microCourse", "humanReview", "legalSearch"] },
    kangqing: { enabled: true, status: "published", name: "康情", subject: "醫檢師・臨床病毒學", zoneTitle: "康情醫檢 AI 學習室", summary: "整合國考題、完整解析、錯題複習與康情老師微課。", brands: ["get"], modules: ["book", "coach", "questionBank", "wrongReview", "microCourse"] },
    zhenghong: { enabled: true, status: "published", name: "鄭泓", subject: "中級會計", zoneTitle: "鄭泓中會 AI 答疑室", summary: "依教材與解題書檢查計算步驟、分錄與金額。", brands: ["get"], modules: ["book", "coach", "questionBank", "grading", "wrongReview", "microCourse", "humanReview"] },
  },
};

export async function getV2Config() {
  const db = await getDb();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "v2_platform_config")).limit(1);
  if (!row?.value) return defaultV2Config;
  try {
    const saved = JSON.parse(row.value) as Partial<V2Config>;
    return {
      brands: { get: { ...defaultV2Config.brands.get, ...saved.brands?.get }, angle: { ...defaultV2Config.brands.angle, ...saved.brands?.angle } },
      teachers: {
        pengli: { ...defaultV2Config.teachers.pengli, ...saved.teachers?.pengli },
        kangqing: { ...defaultV2Config.teachers.kangqing, ...saved.teachers?.kangqing },
        zhenghong: { ...defaultV2Config.teachers.zhenghong, ...saved.teachers?.zhenghong },
      },
    };
  } catch { return defaultV2Config; }
}

function parseOptions(value: string | null) {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {}; } catch { return {}; }
}

export async function getV2Catalog() {
  const db = await getDb();
  const pengliDocs = await db.select({ id: documents.id }).from(documents).where(or(like(documents.bookTitle, "%行政法考點%"), like(documents.fileName, "%59ML170502%")));
  const pengliDocIds = pengliDocs.map((row) => row.id);
  const [medtechBookCount] = await db.select({ value: count() }).from(documents).where(eq(documents.examCategory, "medtech"));
  const [accountingBookCount] = await db.select({ value: count() }).from(documents).where(eq(documents.examCategory, "accounting"));
  const [pengliQuestionCount] = pengliDocIds.length
    ? await db.select({ value: count() }).from(examQuestions).where(inArray(examQuestions.sourceUrl, pengliDocIds.map((id) => `document:${id}`)))
    : [{ value: 0 }];
  const [medtechQuestionCount] = await db.select({ value: count() }).from(examQuestions).where(eq(examQuestions.examCategory, "medtech"));
  const [accountingQuestionCount] = await db.select({ value: count() }).from(examQuestions).where(eq(examQuestions.examCategory, "accounting"));

  const baseFields = {
    id: examQuestions.id, examType: examQuestions.examType, year: examQuestions.year, examName: examQuestions.examName,
    subject: examQuestions.subject, questionNumber: examQuestions.questionNumber, stem: examQuestions.stem,
    optionsJson: examQuestions.optionsJson, correctAnswer: examQuestions.correctAnswer, teacherAnswer: examQuestions.teacherAnswer,
    teacherCompleteExplanation: examQuestions.teacherCompleteExplanation, completeExplanation: examQuestions.completeExplanation,
    rubricJson: examQuestions.rubricJson,
  };
  const pengliWhere = pengliDocIds.length
    ? inArray(examQuestions.sourceUrl, pengliDocIds.map((id) => `document:${id}`))
    : and(eq(examQuestions.examCategory, "law"), like(examQuestions.subject, "%行政%"));
  const [pengliSample] = await db.select(baseFields).from(examQuestions).where(pengliWhere).limit(1);
  const [medtechSample] = await db.select(baseFields).from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.examType, "mcq"))).limit(1);
  const [accountingSample] = await db.select(baseFields).from(examQuestions).where(eq(examQuestions.examCategory, "accounting")).limit(1);
  const shape = (row: typeof pengliSample | undefined) => row ? { ...row, options: parseOptions(row.optionsJson) } : null;

  return {
    teachers: {
      pengli: { key: "pengli" as const, name: "彭狸", subject: "行政法", brandNote: "高點訓練／元照內容", bookCount: Math.max(1, pengliDocs.length), questionCount: pengliQuestionCount.value, sample: shape(pengliSample) },
      kangqing: { key: "kangqing" as const, name: "康情", subject: "醫檢師・臨床病毒學", brandNote: "高點醫檢", bookCount: medtechBookCount.value, questionCount: medtechQuestionCount.value, sample: shape(medtechSample) },
      zhenghong: { key: "zhenghong" as const, name: "鄭泓", subject: "中級會計", brandNote: "高點會計", bookCount: accountingBookCount.value, questionCount: accountingQuestionCount.value, sample: shape(accountingSample) },
    },
  };
}
