import { and,eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";
export async function GET(request:Request){
 const auth=await requireMedtechAdmin(request);if("error" in auth)return auth.error;
 const url=new URL(request.url);const id=Number(url.searchParams.get("id"));const variant=url.searchParams.get("variant")||"";const db=await getDb("primary");const [doc]=await db.select().from(documents).where(and(eq(documents.id,id),eq(documents.examCategory,"medtech"))).limit(1);if(!doc)return new Response("Not found",{status:404});
 let storageKey=doc.storageKey;let fileName=doc.fileName;let contentType=doc.contentType;
 if(variant){try{const result=JSON.parse(doc.processingResultJson) as {sourceVariants?:Array<{kind?:string;storageKey?:string;fileName?:string;contentType?:string}>};const selected=(result.sourceVariants??[]).filter(item=>item.kind===variant).at(-1);if(selected?.storageKey){storageKey=selected.storageKey;fileName=selected.fileName||fileName;contentType=selected.contentType||contentType}}catch{/* use primary source */}}
 const {env}=await import("cloudflare:workers");const object=await env.BUCKET.get(storageKey);if(!object)return new Response("Not found",{status:404});
 return new Response(object.body,{headers:{"content-type":contentType||"application/octet-stream","content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,"cache-control":"private, max-age=300"}})
}
