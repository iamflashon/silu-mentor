import { requireMedtechAdmin } from "../../../../../lib/member-auth";

const allowed=/^image\/(?:png|jpeg|webp|gif)$/;
export async function POST(request:Request){
  const auth=await requireMedtechAdmin(request);if("error" in auth)return auth.error;
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File)||!allowed.test(file.type))return Response.json({error:"請上傳 PNG、JPG、WebP 或 GIF 圖片"},{status:400});
  if(file.size>8*1024*1024)return Response.json({error:"圖片不可超過 8MB"},{status:413});
  const extension=file.type.split("/")[1].replace("jpeg","jpg");const key=`medtech/question-assets/${crypto.randomUUID()}.${extension}`;
  const {env}=await import("cloudflare:workers");await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
  return Response.json({url:`/api/medtech/admin/question-assets?key=${encodeURIComponent(key)}`});
}
export async function GET(request:Request){
  const key=new URL(request.url).searchParams.get("key")||"";if(!/^medtech\/question-assets\/[a-f0-9-]{36}\.(?:png|jpg|webp|gif)$/.test(key))return new Response("Not found",{status:404});
  const {env}=await import("cloudflare:workers");const object=await env.BUCKET.get(key);if(!object)return new Response("Not found",{status:404});
  return new Response(object.body,{headers:{"content-type":object.httpMetadata?.contentType||"image/png","cache-control":"public, max-age=31536000, immutable"}});
}
