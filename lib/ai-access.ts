import { and, desc, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { aiAccessEntitlements, aiAccessLedger, appSettings } from "../db/schema";

export const AI_ACCESS_SETTINGS_KEY = "ai_access_admin_v1";
export type Db = Awaited<ReturnType<typeof getDb>>;
export type AiPlan = { enabled:boolean; lawScholarReflectionEnabled:boolean; pengliScholarReflectionEnabled:boolean; scholarAssistEnabled:boolean; pengliBookVerificationEnabled:boolean; name:string; price:number; quota:number; durationDays:number; coachRounds:number; promoEnabled:boolean; promoBonusQuota:number; promoStartsAt:string; promoEndsAt:string; promoFirstPurchaseOnly:boolean; autoRenew:false; categories:string[]; notes:string };

export const DEFAULT_AI_PLAN: AiPlan = { enabled:false, lawScholarReflectionEnabled:true, pengliScholarReflectionEnabled:true, scholarAssistEnabled:true, pengliBookVerificationEnabled:true, name:"AI 使用方案｜30 天 30 次", price:30, quota:30, durationDays:30, coachRounds:1, promoEnabled:true, promoBonusQuota:20, promoStartsAt:"2026-08-27T00:00:00+08:00", promoEndsAt:"2026-09-26T23:59:59+08:00", promoFirstPurchaseOnly:true, autoRenew:false, categories:["law","pengli","accounting","medtech","data-structure"], notes:"" };

export function aiPurchaseOffer(plan:AiPlan,hasPurchased:boolean,now=new Date()){
  const starts=plan.promoStartsAt?new Date(plan.promoStartsAt):null,ends=plan.promoEndsAt?new Date(plan.promoEndsAt):null;
  const promoActive=plan.promoEnabled&&(!starts||starts<=now)&&(!ends||ends>=now)&&(!plan.promoFirstPurchaseOnly||!hasPurchased);
  const bonusQuota=promoActive?Math.max(0,plan.promoBonusQuota):0;
  return{...plan,standardQuota:plan.quota,quota:plan.quota+bonusQuota,bonusQuota,promoActive};
}

export async function getAiPlan(db: Db) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AI_ACCESS_SETTINGS_KEY)).limit(1);
  try {
    const parsed = JSON.parse(row?.value ?? "") as { policy?: Partial<AiPlan> };
    const stored = parsed.policy ?? {};
    const legacy = stored.scholarAssistEnabled !== false;
    // The legacy plan stored one charge per five coaching rounds. AI usage is
    // now unified platform-wide, so a successful coach reply always consumes
    // one unit even when an older database row still contains coachRounds: 5.
    return { ...DEFAULT_AI_PLAN, ...stored, coachRounds:1, lawScholarReflectionEnabled: stored.lawScholarReflectionEnabled ?? legacy, pengliScholarReflectionEnabled: stored.pengliScholarReflectionEnabled ?? legacy, autoRenew:false } as AiPlan;
  } catch { return DEFAULT_AI_PLAN; }
}

export const PENGLI_FREE_TRIAL_QUOTA = 10;
export const PENGLI_FREE_TRIAL_SOURCE = "pengli_free_trial";

export async function getPengliFreeTrial(db: Db, memberId: number) {
  const [row] = await db.select().from(aiAccessEntitlements)
    .where(and(eq(aiAccessEntitlements.memberId, memberId), eq(aiAccessEntitlements.source, PENGLI_FREE_TRIAL_SOURCE)))
    .orderBy(desc(aiAccessEntitlements.createdAt))
    .limit(1);
  return row ?? null;
}

export async function ensurePengliFreeTrial(db: Db, memberId: number) {
  const plan = await getAiPlan(db);
  if (!plan.enabled || !plan.categories.includes("pengli")) return null;
  const active = await getActiveAiEntitlement(db, memberId);
  if (active) return active;
  const previous = await getPengliFreeTrial(db, memberId);
  if (previous) return null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 86_400_000);
  const [created] = await db.insert(aiAccessEntitlements).values({
    memberId,
    status: "active",
    source: PENGLI_FREE_TRIAL_SOURCE,
    quotaTotal: PENGLI_FREE_TRIAL_QUOTA,
    quotaUsed: 0,
    startsAt: now,
    expiresAt,
    referenceId: "pengli-any-topic-10",
    note: "彭狸老師專區：八大主題任選，免費提問 10 次",
  }).returning();
  return created ?? null;
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
  const now=new Date();
  const quota=Math.max(1,Math.floor(input.quota));
  const durationDays=Math.max(1,Math.floor(input.durationDays));
  const [existing]=await db.select().from(aiAccessEntitlements).where(and(eq(aiAccessEntitlements.memberId,input.memberId),eq(aiAccessEntitlements.status,"active"),gt(aiAccessEntitlements.expiresAt,now))).orderBy(desc(aiAccessEntitlements.expiresAt)).limit(1);
  if(existing){
    const expiresAt=new Date(existing.expiresAt.getTime()+durationDays*86400000);
    const [updated]=await db.update(aiAccessEntitlements).set({quotaTotal:sql`${aiAccessEntitlements.quotaTotal} + ${quota}`,expiresAt,source:input.source,referenceId:input.referenceId,note:input.note,updatedAt:now}).where(eq(aiAccessEntitlements.id,existing.id)).returning();
    return updated;
  }
  const expiresAt=new Date(now.getTime()+durationDays*86400000);
  const [created]=await db.insert(aiAccessEntitlements).values({memberId:input.memberId,status:"active",source:input.source,quotaTotal:quota,quotaUsed:0,startsAt:now,expiresAt,referenceId:input.referenceId,note:input.note}).returning();
  return created;
}

export async function consumeAiAccess(db: Db, input:{memberId:number;action:string;description:string;requestKey?:string;quantity?:number}) {
  const requestKey=(input.requestKey||crypto.randomUUID()).slice(0,120);
  const quantity=Math.max(1,Math.min(20,Math.floor(input.quantity??1)));
  const [existingLedger]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1);
  if(existingLedger)return { charged:false,remaining:existingLedger.balanceAfter,idempotent:true };
  const entitlement=await getActiveAiEntitlement(db,input.memberId);
  if(!entitlement)return { charged:false,remaining:0,idempotent:false };
  const [reservation]=await db.insert(aiAccessLedger).values({entitlementId:entitlement.id,memberId:input.memberId,delta:0,balanceAfter:Math.max(0,entitlement.quotaTotal-entitlement.quotaUsed),action:"reserved",requestKey,description:input.description}).onConflictDoNothing().returning();
  if(!reservation){const [winner]=await db.select().from(aiAccessLedger).where(and(eq(aiAccessLedger.memberId,input.memberId),eq(aiAccessLedger.requestKey,requestKey))).limit(1);return {charged:false,remaining:winner?.balanceAfter??0,idempotent:true}}
  const [updated]=await db.update(aiAccessEntitlements).set({quotaUsed:sql`${aiAccessEntitlements.quotaUsed} + ${quantity}`,updatedAt:new Date()}).where(and(eq(aiAccessEntitlements.id,entitlement.id),eq(aiAccessEntitlements.status,"active"),lte(aiAccessEntitlements.quotaUsed,sql`${aiAccessEntitlements.quotaTotal} - ${quantity}`),gt(aiAccessEntitlements.expiresAt,new Date()))).returning();
  if(!updated){await db.delete(aiAccessLedger).where(eq(aiAccessLedger.id,reservation.id));return { charged:false,remaining:0,idempotent:false }}
  const remaining=Math.max(0,updated.quotaTotal-updated.quotaUsed);
  await db.update(aiAccessLedger).set({delta:-quantity,balanceAfter:remaining,action:input.action,description:input.description}).where(eq(aiAccessLedger.id,reservation.id));
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
