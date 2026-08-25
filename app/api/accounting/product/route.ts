import { getAccountingProductSettings } from "../../../../lib/accounting-product-settings";
import { requireMember } from "../../../../lib/member-auth";
export async function GET(request:Request){const auth=await requireMember(request);if("error" in auth)return auth.error;return Response.json({product:await getAccountingProductSettings(auth.db)},{headers:{"cache-control":"no-store"}})}
