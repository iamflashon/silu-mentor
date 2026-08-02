import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { studyPlans, studyRecords, studyTasks } from "../../../db/schema";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? "";
    const validMonth = /^\d{4}-\d{2}$/.test(month) ? month : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    const db = await getDb();
    const tasks = await db.select().from(studyTasks).where(and(gte(studyTasks.taskDate, `${validMonth}-01`), lte(studyTasks.taskDate, `${validMonth}-31`))).orderBy(asc(studyTasks.taskDate), asc(studyTasks.id));
    const plans = await db.select().from(studyPlans).where(eq(studyPlans.active, true));
    return Response.json({ month: validMonth, plans, tasks });
  } catch {
    return Response.json({ error: "讀書計畫資料庫尚未就緒" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { taskId?: number; status?: string };
    const taskId = Number(body.taskId);
    const status = body.status === "completed" ? "completed" : "pending";
    if (!Number.isInteger(taskId) || taskId < 1) return Response.json({ error: "任務編號不正確" }, { status: 400 });
    const db = await getDb();
    const [task] = await db.select().from(studyTasks).where(eq(studyTasks.id, taskId)).limit(1);
    if (!task) return Response.json({ error: "找不到讀書任務" }, { status: 404 });
    await db.update(studyTasks).set({ status }).where(eq(studyTasks.id, taskId));
    if (status === "completed") {
      const [existing] = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, userKey(request)), eq(studyRecords.taskId, taskId))).limit(1);
      if (!existing) await db.insert(studyRecords).values({ userKey: userKey(request), taskId, recordDate: task.taskDate, subject: task.subject, title: task.title, activityType: "讀書任務", plannedMinutes: task.durationMinutes, actualMinutes: task.durationMinutes, nextStep: "由司律導師依完成進度安排下一步" });
    }
    return Response.json({ taskId, status });
  } catch {
    return Response.json({ error: "任務狀態無法更新" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { planId?: number; date?: string; subject?: string; title?: string; durationMinutes?: number; details?: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") || !body.title?.trim()) {
      return Response.json({ error: "請填寫日期與任務名稱" }, { status: 400 });
    }
    const db = await getDb();
    let planId = Number(body.planId);
    if (!Number.isInteger(planId) || planId < 1) {
      const [active] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
      if (active) planId = active.id;
      else {
        const [created] = await db.insert(studyPlans).values({ title: "我的司律讀書計畫", targetLabel: "尚未設定考試日期", dailyMinutes: 120 }).returning();
        planId = created.id;
      }
    }
    const [task] = await db.insert(studyTasks).values({
      planId,
      taskDate: body.date!,
      subject: body.subject?.trim() || "綜合",
      title: body.title.trim(),
      durationMinutes: Math.max(10, Math.min(480, Number(body.durationMinutes) || 30)),
      details: body.details?.trim() ?? "",
    }).returning();
    return Response.json({ task }, { status: 201 });
  } catch {
    return Response.json({ error: "無法新增讀書任務" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { taskId?: number; date?: string; subject?: string; title?: string; durationMinutes?: number; details?: string; status?: string };
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") || !body.title?.trim()) {
      return Response.json({ error: "讀書任務資料不完整" }, { status: 400 });
    }
    const db = await getDb();
    await db.update(studyTasks).set({
      taskDate: body.date!,
      subject: body.subject?.trim() || "綜合",
      title: body.title.trim(),
      durationMinutes: Math.max(10, Math.min(480, Number(body.durationMinutes) || 30)),
      details: body.details?.trim() ?? "",
      status: body.status === "completed" ? "completed" : "pending",
    }).where(eq(studyTasks.id, taskId));
    if (body.status === "completed") {
      const [task] = await db.select().from(studyTasks).where(eq(studyTasks.id, taskId)).limit(1);
      const [existing] = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, userKey(request)), eq(studyRecords.taskId, taskId))).limit(1);
      if (task && !existing) await db.insert(studyRecords).values({ userKey: userKey(request), taskId, recordDate: task.taskDate, subject: task.subject, title: task.title, activityType: "讀書任務", plannedMinutes: task.durationMinutes, actualMinutes: task.durationMinutes, nextStep: "由司律導師依完成進度安排下一步" });
    }
    return Response.json({ taskId });
  } catch {
    return Response.json({ error: "無法更新讀書任務" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const taskId = Number(new URL(request.url).searchParams.get("taskId"));
    if (!Number.isInteger(taskId) || taskId < 1) return Response.json({ error: "任務編號不正確" }, { status: 400 });
    const db = await getDb();
    await db.delete(studyTasks).where(eq(studyTasks.id, taskId));
    return Response.json({ deleted: taskId });
  } catch {
    return Response.json({ error: "無法刪除讀書任務" }, { status: 500 });
  }
}
