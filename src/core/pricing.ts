export type ModelPricing = {
  input: number;
  output: number;
  cachedInput?: number;
};

export type UsageSummary = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cost?: number;
};

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // GPT-5.x
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-chat-latest": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5.1-chat-latest": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-pro": { input: 15, output: 120 },

  // GPT-4o
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },

  // GPT-4.1
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 }
};

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

export function resolvePricing(
  model: string,
  overrides?: Record<string, ModelPricing>
): ModelPricing | null {
  const normalized = normalizeModel(model);
  if (overrides) {
    const direct = overrides[model] ?? overrides[normalized];
    if (direct) return direct;
  }
  if (DEFAULT_PRICING[normalized]) return DEFAULT_PRICING[normalized];
  const prefixMatch = [
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5-pro",
    "gpt-5.2-pro",
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4.1",
  ].find((prefix) => normalized.startsWith(`${prefix}-`));
  return prefixMatch ? DEFAULT_PRICING[prefixMatch] ?? null : null;
}

export function summarizeUsage(
  model: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null | undefined,
  overrides?: Record<string, ModelPricing>
): UsageSummary | null {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

  const pricing = resolvePricing(model, overrides);
  if (!pricing) {
    return { model, promptTokens, completionTokens, totalTokens, cachedTokens };
  }

  const cached = Math.min(cachedTokens, promptTokens);
  const billableInput = Math.max(0, promptTokens - cached);
  const cachedRate = pricing.cachedInput ?? pricing.input;
  const cost =
    (billableInput * pricing.input) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (completionTokens * pricing.output) / 1_000_000;

  return { model, promptTokens, completionTokens, totalTokens, cachedTokens, cost };
}
