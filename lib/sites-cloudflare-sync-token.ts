type SyncTokenPayload = {
  v: 1;
  purpose: "sites-cloudflare-r2-sync";
  exp: number;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function equal(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function secret() {
  const { env } = await import("cloudflare:workers") as { env: { MEMBER_SESSION_SECRET?: string; ENTRY_SESSION_SECRET?: string } };
  const value = env.MEMBER_SESSION_SECRET?.trim() || env.ENTRY_SESSION_SECRET?.trim() || "";
  if (!value) throw new Error("同步簽章密鑰尚未設定");
  return value;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function createSitesCloudflareSyncToken(ttlSeconds = 2 * 60 * 60) {
  const payload: SyncTokenPayload = { v: 1, purpose: "sites-cloudflare-r2-sync", exp: Date.now() + ttlSeconds * 1000 };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await signature(encoded))}`;
}

export async function verifySitesCloudflareSyncToken(token: string) {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const encoded = token.slice(0, separator);
  try {
    if (!equal(fromBase64Url(token.slice(separator + 1)), await signature(encoded))) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as Partial<SyncTokenPayload>;
    return payload.v === 1 && payload.purpose === "sites-cloudflare-r2-sync" && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
