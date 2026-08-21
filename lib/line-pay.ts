type LinePayEnv = Record<string, unknown>;

async function runtimeEnv(): Promise<LinePayEnv> {
  try {
    const runtime = (await import("cloudflare:workers")) as {
      env?: LinePayEnv;
    };
    return runtime.env ?? {};
  } catch {
    return {};
  }
}

export async function linePayConfig() {
  const runtime = await runtimeEnv();
  const channelId = String(
    runtime.LINE_PAY_CHANNEL_ID ?? process.env.LINE_PAY_CHANNEL_ID ?? "",
  ).trim();
  const channelSecret = String(
    runtime.LINE_PAY_CHANNEL_SECRET ??
      process.env.LINE_PAY_CHANNEL_SECRET ??
      "",
  ).trim();
  const environment = String(
    runtime.LINE_PAY_ENV ?? process.env.LINE_PAY_ENV ?? "sandbox",
  )
    .trim()
    .toLowerCase();
  return {
    channelId,
    channelSecret,
    environment: environment === "production" ? "production" : "sandbox",
    baseUrl:
      environment === "production"
        ? "https://api-pay.line.me"
        : "https://sandbox-api-pay.line.me",
  } as const;
}

function base64(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signature(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function parseLinePayResponse(text: string) {
  return JSON.parse(text.replace(/:\s*(\d{16,})\b/g, ': "$1"')) as {
    returnCode?: string;
    returnMessage?: string;
    info?: Record<string, unknown>;
  };
}

export async function linePayPost(
  apiPath: string,
  data: Record<string, unknown>,
) {
  const config = await linePayConfig();
  if (!config.channelId || !config.channelSecret)
    throw new Error("LINE_PAY_NOT_CONFIGURED");
  const body = JSON.stringify(data);
  const nonce = crypto.randomUUID();
  const authorization = await signature(
    config.channelSecret,
    config.channelSecret + apiPath + body + nonce,
  );
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-LINE-ChannelId": config.channelId,
      "X-LINE-Authorization": authorization,
      "X-LINE-Authorization-Nonce": nonce,
    },
    body,
  });
  return parseLinePayResponse(await response.text());
}
