import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { studentMemos, studyPlans, studyRecords, studyTasks } from "../../../db/schema";
import { taipeiDate } from "../../../lib/taipei-time";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function todayTaipei() { return taipeiDate(); }

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const today = todayTaipei();
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
    const tasks = plan ? await db.select().from(studyTasks).where(eq(studyTasks.planId, plan.id)).orderBy(asc(studyTasks.taskDate)) : [];
    const todayTasks = tasks.filter((task) => task.taskDate === today);
    const completed = tasks.filter((task) => task.status === "completed");
    const overdue = tasks.filter((task) => task.status !== "completed" && task.taskDate < today);
    const records = await db.select().from(studyRecords).where(eq(studyRecords.userKey, userKey(request))).orderBy(asc(studyRecords.recordDate));
    const weaknessCounts = records.reduce<Record<string, number>>((acc, record) => {
      if (record.weakness.trim()) acc[record.weakness.trim()] = (acc[record.weakness.trim()] ?? 0) + 1;
      return acc;
    }, {});
    for (const task of overdue) weaknessCounts[task.subject] = (weaknessCounts[task.subject] ?? 0) + 1;
    const priorities = Object.entries(weaknessCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic, count]) => ({ topic, count, reason: records.some((record) => record.weakness === topic) ? "依學習紀錄判定" : `${count} 項逾期任務` }));
    const [memo] = await db.select().from(studentMemos).where(eq(studentMemos.userKey, userKey(request))).limit(1);
    const target = new Date("2027-08-01T00:00:00+08:00");
    const now = new Date();
    const monthsRemaining = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    const todayCompleted = todayTasks.filter((task) => task.status === "completed").length;
    const todayRecords = records.filter((record) => record.recordDate === today);
    const answeredToday = todayRecords.filter((record) => record.correct !== null);
    const correctToday = answeredToday.filter((record) => record.correct).length;
    return Response.json({
      today,
      targetLabel: plan?.targetLabel || "2027 年 8 月司律考試",
      monthsRemaining,
      officialDatePending: true,
      todayProgress: { completed: todayCompleted, total: todayTasks.length, delayed: overdue.length, records: todayRecords.length, correct: correctToday, answered: answeredToday.length },
      record: { completedTasks: completed.length, completedMinutes: completed.reduce((sum, task) => sum + task.durationMinutes, 0), totalTasks: tasks.length },
      priorities,
      hasRecords: records.length > 0,
      memo: memo?.content ?? "",
      encouragement: todayCompleted > 0 ? "今天已經前進了，完成比完美更重要。" : todayTasks.length ? "先完成今天第一項，節奏就會開始。" : "把方向交給計畫，把專注留給今天。",
    });
  } catch {
    return Response.json({ error: "作戰資料暫時無法讀取" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { memo?: string };
    const content = String(body.memo ?? "").slice(0, 500);
    const db = await getDb();
    const key = userKey(request);
    await db.insert(studentMemos).values({ userKey: key, content }).onConflictDoUpdate({ target: studentMemos.userKey, set: { content, updatedAt: new Date() } });
    return Response.json({ memo: content });
  } catch {
    return Response.json({ error: "MEMO 無法儲存" }, { status: 500 });
  }
}
