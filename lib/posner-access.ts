import { and, eq, gt } from "drizzle-orm";
import { posnerCourseEntitlements } from "../db/schema";

export async function activePosnerEntitlement(db:any, memberId:number, resourceId:number){
 const [row]=await db.select().from(posnerCourseEntitlements).where(and(eq(posnerCourseEntitlements.memberId,memberId),eq(posnerCourseEntitlements.resourceId,resourceId),eq(posnerCourseEntitlements.status,"active"),gt(posnerCourseEntitlements.expiresAt,new Date()))).limit(1);
 return row??null;
}

export async function grantPosnerAccess(db:any,memberId:number,resourceId:number,days:number,source:string,reference:string){
 const now=new Date();const current=await activePosnerEntitlement(db,memberId,resourceId);const base=current?.expiresAt&&current.expiresAt>now?current.expiresAt:now;const expiresAt=new Date(base.getTime()+Math.max(1,days)*86400000);
 await db.insert(posnerCourseEntitlements).values({memberId,resourceId,status:"active",source,startsAt:now,expiresAt,reference,updatedAt:now}).onConflictDoUpdate({target:[posnerCourseEntitlements.memberId,posnerCourseEntitlements.resourceId],set:{status:"active",source,expiresAt,reference,updatedAt:now}});
 return expiresAt;
}
