export type UsageNumbers = {
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
};

function ratesForModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus")) return { input: 5, cached: 0, output: 25 };
  if (normalized.includes("sonnet-5")) return { input: 2, cached: 0, output: 10 };
  if (normalized.includes("haiku")) return { input: 1, cached: 0, output: 5 };
  if (normalized.includes("deepseek")) return { input: 0.435, cached: 0.003625, output: 0.87 };
  if (normalized.includes("terra")) return { input: 2, cached: 0.2, output: 12 };
  if (normalized.includes("sol")) return { input: 5, cached: 0.5, output: 30 };
  return { input: 0.2, cached: 0.02, output: 1.2 };
}

/** Prices are USD per one million tokens; the result is stored as USD micros. */
export function estimateCostUsdMicros(model: string, usage: UsageNumbers) {
  const cachedTokens = Math.max(0, Number(usage.cachedTokens ?? 0));
  const inputTokens = Math.max(0, Number(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.outputTokens ?? 0));
  const rates = ratesForModel(model);
  return Math.round(((Math.max(0, inputTokens - cachedTokens) * rates.input + cachedTokens * rates.cached + outputTokens * rates.output) / 1_000_000) * 1_000_000);
}

export function estimateCostUsd(model: string, usage: UsageNumbers) {
  return estimateCostUsdMicros(model, usage) / 1_000_000;
}
