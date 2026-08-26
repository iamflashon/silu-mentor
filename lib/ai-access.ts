import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { aiAccessEntitlements, aiAccessLedger, appSettings } from "../db/schema";

export const AI_ACCESS_SETTINGS_KEY = "ai_access_admin_v1";
export type Db = Awaited<ReturnType<typeof getDb>>;
export type AiPlan = { enabled:boolean; name:string; price:number; quota:number; durationDays:number; coachRounds:number; autoRenew:false; categories:string[]; notes:string };

export const DEFAULT_AI_PLAN: AiPlan = { enabled:false, name:"AI 試問方案｜30 天 30 次", price:30, quota:30, durationDays:30, coachRounds:5, autoRenew:false, categories:["law","pengli","accounting","medtech","data-structure"], notes:"" };

export async function getAiPlan(db: Db) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AI_ACCESS_SETTINGS_KEY)).limit(1);
  try {
    const parsed = JSON.parse(row?.value ?? "") as { policy?: Partial<AiPlan> };
    return { ...DEFAULT_AI_PLAN, ...(parsed.policy ?? {}), autoRenew:false } as AiPlan;
  } catch { return DEFAULT_AI_PLAN; }
}

export async function getActiveAiEntitlement(db: Db, memberId: number, now = new Date()) {
  const [row] = await db.select().from(aiAccessEntitlements).where(and(eq(aiAccessEntitlements.memberId, memberId), eq(aiAccessEntitlements.status,"active"), gt(aiAccessEntitlements.expiresAt, now), lt(aiAccessEntitlements.quotaUsed, aiAccessEntitlements.quotaTotal))).orderBy(desc(aiAccessEntitlements.expiresAt)).limit(1);
  return row ?? null;
}

export function publicAiAccess(row: typeof aiAccessEntitlements.$inferSelect | null) {
  if (!row) return { active:false, quotaTotal:0, quotaUsed:0, remaining:0, coachRoundsUsed:0, coachWebSearchUsed:0, startsAt:null, expiresAt:null };
  return { active:true, quotaTotal:row.quotaTotal, quotaUsed:row.quotaUsed, remaining:Math.max(0,row.quotaTotal-row.quotaUsed), coachRoundsUsed:row.coachRoundsUsed, coachWebSearchUsed:row.coachWebSearchUsed, startsAt:row.startsAt.toISOString(), expiresAt:row.expiresAt.toISOString(), source:row.source };
}

export async function grantAiAccess(db: Db, input:{memberId:number;quota:number;durationDays:number;source:string;referenceId:string;note:string}) {
  const existing = await getActiveAiEntitlement(db,input.memberId);
  if (existing) throw new Error("ACTIVE_AI_PLAN_EXISTS");
  const now=new Date(),expiresAt=new Date(now.getTime()+input.durationDays*86400000);
  const [created]=await db.insert(aiAccessEntitlements).values({memberId:input.memberId,status:"active",source:input.source,quotaTotal:input.quota,quotaUsed:0,startsAt:now,expiresAt,referenceId:input.referenceId,note:input.note}).returning();
  return created;
}

export async function grantOrExtendAiAccess(db: Db, input:{memberId:number;quota:number;durationDays:number;source:string;referenceId:string;note:string}) {
  const [alreadyGranted] = await db.select().from(aiAccessEntitlements).where(and(eq(aiAccessEntitlements.memberId,input.memberId),eq(aiAccessEntitlements.referenceId,input.referenceId))).limit(1);
  if (alreadyGranted) return alreadyGranted;
  const existing = await getActiveAiEntitlement(db,input.memberId);
  if (!existing) return grantAiAccess(db,input);
  const expiresAt = new Date(existing.expiresAt.getTime()+input.durationDays*86400000);
  const [updated] = await db.update(aiAccessEntitlements).set({quotaTotal:sql`${aiAccessEntitlements.quotaTotal} + ${input.quota}`,expiresAt,source:input.source,referenceId:input.referenceId,note:input.note,updatedAt:new Date()}).where(eq(aiAccessEntitlements.id,existing.id)).returning();
  return updated;
}

export async function consumeAiAccess(db: Db, input:{memberId:number;action:string;description:string;requestKey?:string}) {
  const requestKey=(input.requestKey||crypto.randomUUID()).slice(0,120);
  const [existingLedger]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1);
  if(existingLedger)return { charged:false,remaining:existingLedger.balanceAfter,idempotent:true };
  const entitlement=await getActiveAiEntitlement(db,input.memberId);
  if(!entitlement)return { charged:false,remaining:0,idempotent:false };
  const [reservation]=await db.insert(aiAccessLedger).values({entitlementId:entitlement.id,memberId:input.memberId,delta:0,balanceAfter:Math.max(0,entitlement.quotaTotal-entitlement.quotaUsed),action:"reserved",requestKey,description:input.description}).onConflictDoNothing().returning();
  if(!reservation){const [winner]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1);return {charged:false,remaining:winner?.balanceAfter??0,idempotent:true}}
  const [updated]=await db.update(aiAccessEntitlements).set({quotaUsed:sql`${aiAccessEntitlements.quotaUsed} + 1`,updatedAt:new Date()}).where(and(eq(aiAccessEntitlements.id,entitlement.id),eq(aiAccessEntitlements.status,"active"),lt(aiAccessEntitlements.quotaUsed,aiAccessEntitlements.quotaTotal),gt(aiAccessEntitlements.expiresAt,new Date()))).returning();
  if(!updated){await db.delete(aiAccessLedger).where(eq(aiAccessLedger.id,reservation.id));return { charged:false,remaining:0,idempotent:false }}
  const remaining=Math.max(0,updated.quotaTotal-updated.quotaUsed);
  await db.update(aiAccessLedger).set({delta:-1,balanceAfter:remaining,action:input.action,description:input.description}).where(eq(aiAccessLedger.id,reservation.id));
  return { charged:true,remaining,idempotent:false };
}

export async function progressAiCoach(db:Db,input:{memberId:number;roundTarget:number;action:string;description:string;requestKey?:string}){
  const requestKey=(input.requestKey||crypto.randomUUID()).slice(0,120),roundTarget=Math.max(1,Math.min(20,input.roundTarget));
  const [existing]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1);
  if(existing){const entitlement=await getActiveAiEntitlement(db,input.memberId);return{charged:existing.delta<0,remaining:existing.balanceAfter,idempotent:true,coachRoundsUsed:entitlement?.coachRoundsUsed??0,coachWebSearchUsed:entitlement?.coachWebSearchUsed??0,coachRoundsTarget:roundTarget}}
  const entitlement=await getActiveAiEntitlement(db,input.memberId);if(!entitlement)return{charged:false,remaining:0,idempotent:false,coachRoundsUsed:0,coachWebSearchUsed:0,coachRoundsTarget:roundTarget};
  const[reservation]=await db.insert(aiAccessLedger).values({entitlementId:entitlement.id,memberId:input.memberId,delta:0,balanceAfter:Math.max(0,entitlement.quotaTotal-entitlement.quotaUsed),action:"coach_round_reserved",requestKey,description:input.description}).onConflictDoNothing().returning();
  if(!reservation){const[winner]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1),current=await getActiveAiEntitlement(db,input.memberId);return{charged:(winner?.delta??0)<0,remaining:winner?.balanceAfter??0,idempotent:true,coachRoundsUsed:current?.coachRoundsUsed??0,coachWebSearchUsed:current?.coachWebSearchUsed??0,coachRoundsTarget:roundTarget}}
  const[updated]=await db.update(aiAccessEntitlements).set({coachRoundsUsed:sql`case when ${aiAccessEntitlements.coachRoundsUsed} + 1 >= ${roundTarget} then 0 else ${aiAccessEntitlements.coachRoundsUsed} + 1 end`,coachWebSearchUsed:sql`case when ${aiAccessEntitlements.coachRoundsUsed} + 1 >= ${roundTarget} then 0 else ${aiAccessEntitlements.coachWebSearchUsed} end`,quotaUsed:sql`${aiAccessEntitlements.quotaUsed} + case when ${aiAccessEntitlements.coachRoundsUsed} + 1 >= ${roundTarget} then 1 else 0 end`,updatedAt:new Date()}).where(and(eq(aiAccessEntitlements.id,entitlement.id),eq(aiAccessEntitlements.status,"active"),lt(aiAccessEntitlements.quotaUsed,aiAccessEntitlements.quotaTotal),gt(aiAccessEntitlements.expiresAt,new Date()))).returning();
  if(!updated){await db.delete(aiAccessLedger).where(eq(aiAccessLedger.id,reservation.id));return{charged:false,remaining:0,idempotent:false,coachRoundsUsed:0,coachWebSearchUsed:0,coachRoundsTarget:roundTarget}}
  const charged=updated.coachRoundsUsed===0,remaining=Math.max(0,updated.quotaTotal-updated.quotaUsed);
  await db.update(aiAccessLedger).set({delta:charged?-1:0,balanceAfter:remaining,action:charged?input.action:"coach_round",description:input.description}).where(eq(aiAccessLedger.id,reservation.id));
  return{charged,remaining,idempotent:false,coachRoundsUsed:updated.coachRoundsUsed,coachWebSearchUsed:updated.coachWebSearchUsed,coachRoundsTarget:roundTarget};
}

export async function canUseCoachWebSearch(db:Db,memberId:number){const entitlement=await getActiveAiEntitlement(db,memberId);return Boolean(entitlement&&entitlement.coachWebSearchUsed<1)}
export async function recordCoachWebSearch(db:Db,memberId:number){const entitlement=await getActiveAiEntitlement(db,memberId);if(!entitlement)return;await db.update(aiAccessEntitlements).set({coachWebSearchUsed:1,updatedAt:new Date()}).where(eq(aiAccessEntitlements.id,entitlement.id))}
