import { getJudicialCaseDetail } from "../../../../lib/judicial-search";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jid: string }> },
) {
  try {
    const { jid } = await context.params;
    const result = await getJudicialCaseDetail(decodeURIComponent(jid));
    if (!result) {
      return Response.json({ error: "找不到這筆裁判" }, { status: 404 });
    }
    return Response.json(result, {
      headers: { "cache-control": "private, max-age=60" },
    });
  } catch {
    return Response.json({ error: "裁判全文暫時無法讀取" }, { status: 503 });
  }
}
