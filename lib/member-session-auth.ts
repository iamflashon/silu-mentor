export const MEMBER_SESSION_COOKIE = "silu_member_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;

export type MemberSessionEnv = {
  MEMBER_SESSION_SECRET?: string;
  ENTRY_SESSION_SECRET?: string;
};

export type MemberSession = {
  memberId: number;
  email: string;
  expiresAt: number;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function runtimeEnv(): Promise<MemberSessionEnv> {
  try {
    const runtime = await import("cloudflare:workers") as { env?: MemberSessionEnv };
    if (runtime.env) return runtime.env;
  } catch {
    // Preview and local development may not expose this module.
  }
  return process.env as MemberSessionEnv;
}

function sessionSecret(configuredEnv?: MemberSessionEnv) {
  return configuredEnv?.MEMBER_SESSION_SECRET?.trim() || configuredEnv?.ENTRY_SESSION_SECRET?.trim() || "";
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === MEMBER_SESSION_COOKIE) return value.join("=");
  }
  return "";
}

export async function hashMemberPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256));
  return `pbkdf2$sha256$${PASSWORD_ITERATIONS}$${base64Url(salt)}$${base64Url(derived)}`;
}

export async function verifyMemberPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isSafeInteger(iterations) || iterations < 80_000 || iterations > 300_000) return false;
  try {
    const salt = fromBase64Url(parts[3]);
    const expected = fromBase64Url(parts[4]);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, expected.length * 8));
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function createMemberSessionCookie(member: Pick<MemberSession, "memberId" | "email">, configuredEnv?: MemberSessionEnv) {
  const env = configuredEnv ?? await runtimeEnv();
  const secret = sessionSecret(env);
  if (!secret) return "";
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ v: 1, id: member.memberId, email: member.email, exp: expiresAt })));
  const signature = base64Url(await hmac(payload, secret));
  return `${MEMBER_SESSION_COOKIE}=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearMemberSessionCookie() {
  return `${MEMBER_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function getMemberSession(request: Request, configuredEnv?: MemberSessionEnv): Promise<MemberSession | null> {
  const token = cookieValue(request);
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const encodedSignature = token.slice(separator + 1);
  const secret = sessionSecret(configuredEnv ?? await runtimeEnv());
  if (!secret || !payload || !encodedSignature) return null;
  try {
    if (!constantTimeEqual(fromBase64Url(encodedSignature), await hmac(payload, secret))) return null;
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { v?: unknown; id?: unknown; email?: unknown; exp?: unknown };
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.id) || typeof parsed.email !== "string" || !Number.isSafeInteger(parsed.exp) || (parsed.exp as number) <= Date.now()) return null;
    return { memberId: parsed.id as number, email: parsed.email.trim().toLowerCase(), expiresAt: parsed.exp as number };
  } catch {
    return null;
  }
}
