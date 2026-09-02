import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { members } from "../db/schema";

export const ADMIN_ENTRY_OWNER_EMAIL = "iamflashon@gmail.com";
export const ADMIN_ENTRY_COOKIE = "silu_admin_entry";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AdminEntryEnv = {
  ENTRY_ADMIN_EMAIL?: string;
  ENTRY_ADMIN_PASSWORD?: string;
  ENTRY_SESSION_SECRET?: string;
};

function headerEmail(request: Request) {
  const sitesEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (sitesEmail) return sitesEmail;
  const accessEmail = request.headers
    .get("cf-access-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  return accessEmail && request.headers.get("cf-access-jwt-assertion")
    ? accessEmail
    : "";
}

async function runtimeEnv(): Promise<AdminEntryEnv> {
  try {
    const runtime = await import("cloudflare:workers") as { env?: AdminEntryEnv };
    if (runtime.env) return runtime.env;
  } catch {
    // Sites preview and local development do not always expose this module.
  }
  return process.env as AdminEntryEnv;
}

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

async function hmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === ADMIN_ENTRY_COOKIE) return value.join("=");
  }
  return "";
}

export function safeReturnTo(value: unknown, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

export async function isAdminSessionCookie(request: Request, sessionSecret?: string) {
  const token = cookieValue(request);
  if (!token || !sessionSecret) return false;
  const separator = token.lastIndexOf(".");
  const payload = separator > 0 ? token.slice(0, separator) : "";
  const encodedSignature = separator > 0 ? token.slice(separator + 1) : "";
  if (!payload || !encodedSignature) return false;
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  try {
    return constantTimeEqual(fromBase64Url(encodedSignature), await hmac(payload, sessionSecret));
  } catch {
    return false;
  }
}

async function hasChatGPTAdmin(request: Request) {
  const email = headerEmail(request);
  if (!email) return false;
  if (email === ADMIN_ENTRY_OWNER_EMAIL) return true;
  try {
    const db = await getDb();
    const [member] = await db.select({ canAdmin: members.canAdmin, status: members.status }).from(members).where(eq(members.email, email)).limit(1);
    return member?.status === "active" && member.canAdmin === true;
  } catch {
    return false;
  }
}

export async function isPlatformMemberAuthenticated(request: Request) {
  const email = headerEmail(request);
  if (!email) return false;
  try {
    const db = await getDb();
    const [member] = await db.select({ status: members.status }).from(members).where(eq(members.email, email)).limit(1);
    return member?.status === "active";
  } catch {
    return false;
  }
}

export async function isAdminEntryAuthenticated(request: Request) {
  if (request.headers.get("x-silu-admin-entry") === "1") return true;
  if (await hasChatGPTAdmin(request)) return true;
  const env = await runtimeEnv();
  return isAdminSessionCookie(request, env.ENTRY_SESSION_SECRET);
}

export async function isAdminCredentials(email: string, password: string, configuredEnv?: AdminEntryEnv) {
  const env = configuredEnv ?? await runtimeEnv();
  const expectedEmail = (env.ENTRY_ADMIN_EMAIL || ADMIN_ENTRY_OWNER_EMAIL).trim().toLowerCase();
  if (!env.ENTRY_ADMIN_PASSWORD || !expectedEmail) return false;
  const [emailDigest, expectedEmailDigest, passwordDigest, expectedPasswordDigest] = await Promise.all([
    sha256(email.trim().toLowerCase()),
    sha256(expectedEmail),
    sha256(password),
    sha256(env.ENTRY_ADMIN_PASSWORD),
  ]);
  return constantTimeEqual(emailDigest, expectedEmailDigest) && constantTimeEqual(passwordDigest, expectedPasswordDigest);
}

export async function createAdminEntryCookie(configuredEnv?: AdminEntryEnv) {
  const env = configuredEnv ?? await runtimeEnv();
  if (!env.ENTRY_SESSION_SECRET) return "";
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = base64Url(await hmac(payload, env.ENTRY_SESSION_SECRET));
  return `${ADMIN_ENTRY_COOKIE}=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearAdminEntryCookie() {
  return `${ADMIN_ENTRY_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
