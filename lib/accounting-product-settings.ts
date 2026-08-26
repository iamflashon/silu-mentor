import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { accountingProducts } from "../db/schema";

export const ACCOUNTING_FIRST_PRODUCT_KEY = "accounting-grad-school-question-bank";
export const ACCOUNTING_FIRST_PRODUCT_TITLE = "會研所中級會計學題庫制霸";
const fallback = { productKey:ACCOUNTING_FIRST_PRODUCT_KEY,title:ACCOUNTING_FIRST_PRODUCT_TITLE,subtitle:"依章節、學校與年度練習研究所中級會計選擇題",descriptionHtml:"<p>收錄會研所中級會計選擇題、完整計算過程與老師解析。</p>",coverStorageKey:null as string|null,listPrice:249,salePrice:null as number|null,saleLabel:"",saleStartsAt:null as Date|null,saleEndsAt:null as Date|null,accessDays:90,trialQuestions:10,renewalMode:"extend",status:"draft",sortOrder:10 };
export async function getAccountingProductSettings(db:Awaited<ReturnType<typeof getDb>>,now=new Date()){
 let [row]=await db.select().from(accountingProducts).where(eq(accountingProducts.productKey,ACCOUNTING_FIRST_PRODUCT_KEY)).limit(1);
 if(!row){[row]=await db.insert(accountingProducts).values(fallback).onConflictDoNothing().returning();if(!row)[row]=await db.select().from(accountingProducts).where(eq(accountingProducts.productKey,ACCOUNTING_FIRST_PRODUCT_KEY)).limit(1)}
 const product=row??fallback,startsOk=!product.saleStartsAt||product.saleStartsAt<=now,endsOk=!product.saleEndsAt||product.saleEndsAt>=now;
 const saleActive=product.salePrice!==null&&product.salePrice>0&&product.salePrice<product.listPrice&&startsOk&&endsOk;
 return {...product,effectivePrice:saleActive?product.salePrice!:product.listPrice,saleActive};
}
