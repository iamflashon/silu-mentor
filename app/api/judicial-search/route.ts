import { searchJudicialCases } from "../../../lib/judicial-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    return Response.json(await searchJudicialCases({
      query: url.searchParams.get("q") ?? "",
      court: url.searchParams.get("court") ?? "",
      year: url.searchParams.get("year") ?? "",
      limit: Number(url.searchParams.get("limit") ?? 12),
    }));
  } catch {
    return Response.json({ error: "裁判資料尚未就緒，請稍後再搜尋" }, { status: 503 });
  }
}
