import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb(consistency: "default" | "primary" = "default") {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  // D1 replicas can lag behind a recent multi-request indexing job. Admin
  // counters and resumable writers use a primary-anchored session so a page
  // refresh cannot appear to roll completed work back.
  const client = consistency === "primary" ? env.DB.withSession("first-primary") : env.DB;
  return drizzle(client as unknown as D1Database, { schema });
}
