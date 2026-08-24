type PurchaseMember = {
  id: number;
  email: string;
  passwordHash: string;
};

const PURPOSE = "medtech-line-pay-v1";
const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function memberSecret(member: PurchaseMember) {
  // This server-only random value is stored in D1 and never sent to the browser.
  return [
    PURPOSE,
    member.id,
    member.email.toLowerCase(),
    member.passwordHash,
  ].join(":");
}

async function signature(member: PurchaseMember, expiresAt: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(memberSecret(member)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${PURPOSE}:${member.email.toLowerCase()}:${expiresAt}`;
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function createMedtechPurchaseProof(member: PurchaseMember) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  return {
    memberEmail: member.email.toLowerCase(),
    purchaseExpiresAt: expiresAt,
    purchaseProof: await signature(member, expiresAt),
  };
}

export async function verifyMedtechPurchaseProof(
  member: PurchaseMember,
  expiresAt: number,
  proof: string,
) {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || expiresAt > Date.now() + 11 * 60 * 1000)
    return false;
  const expected = await signature(member, expiresAt);
  if (expected.length !== proof.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1)
    difference |= expected.charCodeAt(index) ^ proof.charCodeAt(index);
  return difference === 0;
}
