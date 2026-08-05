type UnknownRecord = Record<string, unknown>;

export type YoutubePlaylistItem = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  durationLabel: string;
  index: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function textValue(value: unknown) {
  if (!isRecord(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.runs)) {
    return value.runs
      .filter(isRecord)
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join("");
  }
  return "";
}

function extractJsonObject(source: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  return "";
}

function parseInitialData(html: string) {
  const marker = "var ytInitialData = ";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const json = extractJsonObject(html, markerIndex + marker.length);
  if (!json) return null;
  try {
    return JSON.parse(json) as UnknownRecord;
  } catch {
    return null;
  }
}

function thumbnailUrl(value: unknown) {
  if (!isRecord(value) || !isRecord(value.thumbnailViewModel)) return "";
  const image = value.thumbnailViewModel.image;
  if (!isRecord(image) || !Array.isArray(image.sources)) return "";
  const sources = image.sources.filter(isRecord);
  const last = sources.at(-1);
  return typeof last?.url === "string" ? last.url : "";
}

function findContinuationToken(value: unknown): string {
  if (!isRecord(value)) return "";
  const continuationItem = value.continuationItemViewModel;
  if (isRecord(continuationItem)) {
    const token =
      ((continuationItem.continuationCommand as UnknownRecord | undefined)
        ?.innertubeCommand as UnknownRecord | undefined)
        ?.continuationCommand;
    if (isRecord(token) && typeof token.token === "string") return token.token;
  }
  const legacyItem = value.continuationItemRenderer;
  if (isRecord(legacyItem)) {
    const endpoint = legacyItem.continuationEndpoint;
    const command = isRecord(endpoint) ? endpoint.continuationCommand : null;
    if (isRecord(command) && typeof command.token === "string") return command.token;
  }
  for (const child of Object.values(value)) {
    const token = findContinuationToken(child);
    if (token) return token;
  }
  return "";
}

function collectItems(value: unknown, output: YoutubePlaylistItem[], playlistId: string) {
  if (!isRecord(value)) return;

  const lockup = value.lockupViewModel;
  if (isRecord(lockup) && typeof lockup.contentId === "string") {
    const metadata = isRecord(lockup.metadata) ? lockup.metadata.lockupMetadataViewModel : null;
    const title = isRecord(metadata) ? textValue(metadata.title) : "";
    const endpoint =
      isRecord(lockup.rendererContext) && isRecord(lockup.rendererContext.commandContext)
        ? lockup.rendererContext.commandContext.onTap
        : null;
    const command = isRecord(endpoint) ? endpoint.innertubeCommand : null;
    const watchEndpoint = isRecord(command) ? command.watchEndpoint : null;
    if (!isRecord(watchEndpoint) || watchEndpoint.playlistId !== playlistId) {
      for (const child of Object.values(value)) collectItems(child, output, playlistId);
      return;
    }
    const index = typeof watchEndpoint.index === "number" ? watchEndpoint.index : output.length;
    const accessibility = isRecord(lockup.rendererContext)
      ? lockup.rendererContext.accessibilityContext
      : null;
    const accessibilityLabel = isRecord(accessibility) && typeof accessibility.label === "string" ? accessibility.label : "";
    const durationLabel = accessibilityLabel.replace(title, "").trim();
    output.push({
      videoId: lockup.contentId,
      title: title || `第 ${index + 1} 集`,
      thumbnailUrl: thumbnailUrl(lockup.contentImage),
      durationLabel,
      index,
    });
  }

  const legacy = value.playlistVideoRenderer;
  if (isRecord(legacy) && typeof legacy.videoId === "string") {
    const navigation = isRecord(legacy.navigationEndpoint) ? legacy.navigationEndpoint : null;
    const watchEndpoint = isRecord(navigation) ? navigation.watchEndpoint : null;
    if (!isRecord(watchEndpoint) || watchEndpoint.playlistId !== playlistId) {
      for (const child of Object.values(value)) collectItems(child, output, playlistId);
      return;
    }
    const indexText = textValue(legacy.index);
    const index = Number(indexText.replace(/\D/g, "")) || output.length;
    output.push({
      videoId: legacy.videoId,
      title: textValue(legacy.title) || `第 ${index + 1} 集`,
      thumbnailUrl: isRecord(legacy.thumbnail) && Array.isArray(legacy.thumbnail.thumbnails)
        ? (legacy.thumbnail.thumbnails.filter(isRecord).at(-1)?.url as string | undefined) ?? ""
        : "",
      durationLabel: textValue(legacy.lengthText),
      index,
    });
  }

  for (const child of Object.values(value)) collectItems(child, output, playlistId);
}

function uniqueItems(items: YoutubePlaylistItem[]) {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    })
    .sort((a, b) => a.index - b.index)
    .map((item, index) => ({ ...item, index }));
}

function configValue(html: string, key: string) {
  return html.match(new RegExp(`${key}\\":\\"([^\\"]+)`))?.[1] ?? "";
}

export function playlistIdFromUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const playlistId = url.searchParams.get("list")?.trim() ?? "";
    return /^[A-Za-z0-9_-]{6,}$/.test(playlistId) ? playlistId : "";
  } catch {
    return "";
  }
}

export function videoIdFromUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const id = url.hostname === "youtu.be"
      ? url.pathname.slice(1)
      : url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || "";
    return /^[A-Za-z0-9_-]{6,}$/.test(id.split(/[?&]/)[0]) ? id.split(/[?&]/)[0] : "";
  } catch {
    return "";
  }
}

export async function fetchYoutubePlaylist(playlistId: string) {
  const pageResponse = await fetch(
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; iBrain-OpenCourse/1.0)",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!pageResponse.ok) throw new Error(`YouTube playlist page returned ${pageResponse.status}`);
  const html = await pageResponse.text();
  const initialData = parseInitialData(html);
  if (!initialData) throw new Error("YouTube playlist data is unavailable");

  const items: YoutubePlaylistItem[] = [];
  collectItems(initialData, items, playlistId);

  const apiKey = configValue(html, "INNERTUBE_API_KEY");
  const clientVersion = configValue(html, "INNERTUBE_CLIENT_VERSION");
  const visitorData = configValue(html, "visitorData");
  let continuation = findContinuationToken(initialData);
  let pageCount = 0;
  while (continuation && apiKey && clientVersion && pageCount < 12) {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-youtube-client-name": "1",
          "x-youtube-client-version": clientVersion,
          "user-agent": "Mozilla/5.0 (compatible; iBrain-OpenCourse/1.0)",
        },
        body: JSON.stringify({
          context: {
            client: {
              hl: "zh-TW",
              gl: "TW",
              clientName: "WEB",
              clientVersion,
              visitorData,
            },
          },
          continuation,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) break;
    const data = (await response.json()) as UnknownRecord;
    collectItems(data, items, playlistId);
    continuation = findContinuationToken(data);
    pageCount += 1;
  }
  return uniqueItems(items).slice(0, 500);
}
