export type PlatformUsageInput = {
  memberId?: number | null;
  userKey?: string;
  category: "model" | "mcp";
  provider?: string;
  resource: string;
  source?: string;
  requestKey?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  callCount?: number;
  creditDelta?: number;
  estimatedCostUsdMicros?: number;
  durationMs?: number;
  status?: "success" | "failed" | "blocked";
  errorCode?: string;
};

function safeInteger(value: number | undefined, minimum = 0) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.round(value ?? minimum));
}

export async function recordPlatformUsage(input: PlatformUsageInput) {
  try {
    const { env } = await import("cloudflare:workers");
    const database = (env as unknown as { DB?: D1Database }).DB;
    if (!database) return false;
    const now = Math.floor(Date.now() / 1000);
    await database.prepare(`
      INSERT INTO platform_usage_events (
        id, member_id, user_key, category, provider, resource, source, request_key,
        input_tokens, cached_tokens, output_tokens, call_count, credit_delta,
        estimated_cost_usd_micros, duration_ms, status, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.memberId ?? null,
      input.userKey?.trim().toLowerCase() || "anonymous",
      input.category,
      input.provider?.trim() || "",
      input.resource.trim(),
      input.source?.trim() || "",
      input.requestKey?.trim() || "",
      safeInteger(input.inputTokens),
      safeInteger(input.cachedTokens),
      safeInteger(input.outputTokens),
      safeInteger(input.callCount, 1),
      Math.round(input.creditDelta ?? 0),
      safeInteger(input.estimatedCostUsdMicros),
      safeInteger(input.durationMs),
      input.status ?? "success",
      input.errorCode?.trim().slice(0, 120) || "",
      now,
    ).run();
    return true;
  } catch {
    // Metering must never make a completed learner response fail. The legacy
    // usage log remains the billing reconciliation fallback during rollout.
    return false;
  }
}
