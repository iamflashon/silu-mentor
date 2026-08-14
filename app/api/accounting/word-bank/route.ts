import { getDb } from "../../../../db";
import { requireAdmin } from "../../../../lib/member-auth";
import { ACCOUNTING_WORD_BANK_SIZE, ACCOUNTING_WORD_BANK_SOURCE, countAccountingWordBank, importAccountingWordBank } from "../../../../lib/accounting-word-bank";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb();
  const current = await countAccountingWordBank(db);
  return Response.json({ available: ACCOUNTING_WORD_BANK_SIZE, imported: current, source: ACCOUNTING_WORD_BANK_SOURCE });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const db = await getDb();
  const result = await importAccountingWordBank(db, true);
  return Response.json({ ...result, source: ACCOUNTING_WORD_BANK_SOURCE, status: "published" });
}
