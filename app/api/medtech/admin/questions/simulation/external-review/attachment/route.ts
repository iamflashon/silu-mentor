import { desc, eq } from "drizzle-orm";
import { medtechQuestionEvidenceReviews } from "../../../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../../../lib/member-auth";

type StoredAttachment = { id?: string; storageKey?: string };

function storedAttachments(value: string) {
  try {
    const parsed = JSON.parse(value) as { attachments?: StoredAttachment[] };
    return Array.isArray(parsed.attachments) ? parsed.attachments : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const questionId = Number(url.searchParams.get("questionId"));
  const attachmentId = String(url.searchParams.get("attachmentId") || "");
  if (!Number.isInteger(questionId) || questionId < 1 || !attachmentId) return new Response("not found", { status: 404 });

  const rows = await auth.db.select({ resultJson: medtechQuestionEvidenceReviews.resultJson })
    .from(medtechQuestionEvidenceReviews)
    .where(eq(medtechQuestionEvidenceReviews.questionId, questionId))
    .orderBy(desc(medtechQuestionEvidenceReviews.createdAt))
    .limit(50);
  const attachment = rows.flatMap((row) => storedAttachments(row.resultJson)).find((item) => item.id === attachmentId && item.storageKey);
  if (!attachment?.storageKey) return new Response("not found", { status: 404 });

  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(attachment.storageKey);
  if (!object) return new Response("not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=86400",
      "content-disposition": "inline",
    },
  });
}
