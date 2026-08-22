import { requireAccountingAdmin } from "../../../../lib/member-auth";
import { GET as getQuestions } from "../admin/questions/route";

export async function POST(request:Request){
 const auth=await requireAccountingAdmin(request);if("error" in auth)return auth.error;
 const body=await request.json() as {documentId?:number};const documentId=Number(body.documentId);
 const url=new URL(request.url);url.pathname="/api/data-structure/admin/questions";url.search=`?documentId=${documentId}&limit=100&page=1`;
 const response=await getQuestions(new Request(url,{headers:request.headers}));const data=await response.json() as {total?:number;error?:string};
 if(!response.ok)return Response.json({error:data.error||"資料結構題目載入失敗"},{status:response.status});
 return Response.json({done:true,parsed:Number(data.total??0),imported:Number(data.total??0),nextOffset:Number(data.total??0)});
}
