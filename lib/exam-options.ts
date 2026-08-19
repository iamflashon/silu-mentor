export function normalizeMcqOptions(value: string | null | undefined): Record<string, string> | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const normalized: Record<string, string> = {};
    const add = (rawLabel: unknown, rawText: unknown) => {
      const label = String(rawLabel ?? "").trim().toUpperCase().match(/[ABCD]/)?.[0] ?? "";
      const text = String(rawText ?? "").trim();
      if (label && text && !normalized[label]) normalized[label] = text;
    };
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const option = item as Record<string, unknown>;
          add(option.label ?? option.key ?? option.option, option.text ?? option.value ?? option.content);
        }
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [label, text] of Object.entries(parsed as Record<string, unknown>)) add(label, text);
    }
    return ["A", "B", "C", "D"].every((label) => normalized[label]) ? normalized : null;
  } catch {
    return null;
  }
}
