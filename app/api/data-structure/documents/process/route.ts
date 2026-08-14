import { and,eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { POST as processDocument } from "../../../documents/process/route";
export async function POST(request:Request){const body=await request.json() as {documentId?:number;retry?:boolean;reanalyze?:boolean};const documentId=Number(body.documentId);const db=await getDb();const [row]=await db.select({id:documents.id}).from(documents).where(and(eq(documents.id,documentId),eq(documents.examCategory,"data-structure"))).limit(1);if(!row)return Response.json({error:"找不到資料結構教材"},{status:404});return processDocument(new Request(request.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}))}
