import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { requireAccountingAdmin } from "../../../../../lib/member-auth";

export async function GET(request:Request){
 const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
 const id=Number(new URL(request.url).searchParams.get("id")),db=await getDb();
 const [doc]=await db.select().from(documents).where(and(eq(documents.id,id),eq(documents.examCategory,"data-structure"))).limit(1);
 if(!doc)return new Response("Not found",{status:404});
 const {env}=await import("cloudflare:workers"),object=await env.BUCKET.get(doc.storageKey);if(!object)return new Response("Not found",{status:404});
 return new Response(object.body,{headers:{"content-type":doc.contentType||"application/octet-stream","content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,"cache-control":"private, max-age=300"}});
}
