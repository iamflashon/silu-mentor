import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { studyPlans, studyRecords, studyTasks } from "../../../db/schema";
import { taipeiMonth } from "../../../lib/taipei-time";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

function taskKey(date: string, subject: string, title: string) {
  const clean = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。,、:：·・\-_—]/g, "");
  return `${date}|${clean(subject)}|${clean(title)}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? "";
    const validMonth = /^\d{4}-\d{2}$/.test(month) ? month : taipeiMonth();
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
      if (!existing) await db.insert(studyRecords).values({ userKey: userKey(request), taskId, recordDate: task.taskDate, subject: task.subject, title: task.title, activityType: "讀書任務", plannedMinutes: task.durationMinutes, actualMinutes: task.durationMinutes, nextStep: "由司律備考依完成進度安排下一步" });
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
    const subject = body.subject?.trim() || "綜合";
    const title = body.title.trim();
    const sameDay = await db.select().from(studyTasks).where(and(eq(studyTasks.planId, planId), eq(studyTasks.taskDate, body.date!)));
    const duplicate = sameDay.find((task) => taskKey(task.taskDate, task.subject, task.title) === taskKey(body.date!, subject, title));
    if (duplicate) return Response.json({ error: `這天已經有相同任務：「${duplicate.title}」，沒有重複新增。`, duplicateTaskId: duplicate.id }, { status: 409 });
    const [task] = await db.insert(studyTasks).values({
      planId,
      taskDate: body.date!,
      subject,
      title,
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
    const [current] = await db.select().from(studyTasks).where(eq(studyTasks.id, taskId)).limit(1);
    if (!current) return Response.json({ error: "找不到讀書任務" }, { status: 404 });
    const subject = body.subject?.trim() || "綜合";
    const title = body.title.trim();
    const sameDay = await db.select().from(studyTasks).where(and(eq(studyTasks.planId, current.planId), eq(studyTasks.taskDate, body.date!)));
    const duplicate = sameDay.find((task) => task.id !== taskId && taskKey(task.taskDate, task.subject, task.title) === taskKey(body.date!, subject, title));
    if (duplicate) return Response.json({ error: `這天已經有相同任務：「${duplicate.title}」，沒有覆蓋成重複任務。`, duplicateTaskId: duplicate.id }, { status: 409 });
    await db.update(studyTasks).set({
      taskDate: body.date!,
      subject,
      title,
      durationMinutes: Math.max(10, Math.min(480, Number(body.durationMinutes) || 30)),
      details: body.details?.trim() ?? "",
      status: body.status === "completed" ? "completed" : "pending",
    }).where(eq(studyTasks.id, taskId));
    if (body.status === "completed") {
      const [task] = await db.select().from(studyTasks).where(eq(studyTasks.id, taskId)).limit(1);
      const [existing] = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, userKey(request)), eq(studyRecords.taskId, taskId))).limit(1);
      if (task && !existing) await db.insert(studyRecords).values({ userKey: userKey(request), taskId, recordDate: task.taskDate, subject: task.subject, title: task.title, activityType: "讀書任務", plannedMinutes: task.durationMinutes, actualMinutes: task.durationMinutes, nextStep: "由司律備考依完成進度安排下一步" });
    }
    return Response.json({ taskId });
  } catch {
    return Response.json({ error: "無法更新讀書任務" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const taskId = Number(params.get("taskId"));
    const db = await getDb();
    if (params.get("clear") === "1") {
      const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
      if (!plan) return Response.json({ deleted: 0 });
      const subject = params.get("subject")?.trim();
      const allowedSubjects = new Set(["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法"]);
      if (subject && !allowedSubjects.has(subject)) return Response.json({ error: "指定科目不正確" }, { status: 400 });
      const condition = subject ? and(eq(studyTasks.planId, plan.id), eq(studyTasks.subject, subject)) : eq(studyTasks.planId, plan.id);
      const tasks = await db.select().from(studyTasks).where(condition);
      await db.delete(studyTasks).where(condition);
      return Response.json({ deleted: tasks.length, subject: subject ?? null });
    }
    if (params.get("duplicates") === "1") {
      const tasks = await db.select().from(studyTasks).orderBy(asc(studyTasks.id));
      const seen = new Set<string>(); const duplicateIds: number[] = [];
      for (const task of tasks) { const key = taskKey(task.taskDate, task.subject, task.title); if (seen.has(key)) duplicateIds.push(task.id); else seen.add(key); }
      for (const id of duplicateIds) await db.delete(studyTasks).where(eq(studyTasks.id, id));
      return Response.json({ deleted: duplicateIds });
    }
    if (!Number.isInteger(taskId) || taskId < 1) return Response.json({ error: "任務編號不正確" }, { status: 400 });
    await db.delete(studyTasks).where(eq(studyTasks.id, taskId));
    return Response.json({ deleted: taskId });
  } catch {
    return Response.json({ error: "無法刪除讀書任務" }, { status: 500 });
  }
}
