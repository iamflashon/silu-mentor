import { fetchYoutubePlaylist, playlistIdFromUrl } from "../../../lib/youtube-playlist";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playlistUrl = url.searchParams.get("url") ?? "";
  const playlistId = playlistIdFromUrl(playlistUrl);
  if (!playlistId) return Response.json({ error: "這不是有效的 YouTube 播放清單網址" }, { status: 400 });

  try {
    const items = await fetchYoutubePlaylist(playlistId);
    return Response.json(
      { playlistId, items, count: items.length },
      { headers: { "cache-control": "public, max-age=300, s-maxage=300" } },
    );
  } catch (error) {
    console.error("course playlist sync failed", error);
    return Response.json({ error: "目前無法讀取 YouTube 播放清單，請稍後再試" }, { status: 502 });
  }
}
