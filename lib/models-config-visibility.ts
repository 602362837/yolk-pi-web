/**
 * Read-only navigation projection for models.json provider entries.
 *
 * Price-only `modelOverrides` metadata is not an independently configurable
 * provider. This helper deliberately fails visible for malformed or unfamiliar
 * values so a future provider field is never hidden by the UI.
 */
export function isOverrideOnlyProviderEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  try {
    const enumerableKeys = Reflect.ownKeys(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key),
    );
    if (enumerableKeys.length !== 1 || enumerableKeys[0] !== "modelOverrides") return false;

    const modelOverrides = (value as Record<string, unknown>).modelOverrides;
    return typeof modelOverrides === "object" && modelOverrides !== null && !Array.isArray(modelOverrides);
  } catch {
    // Dynamic/untrusted config boundaries must remain visible if inspection fails.
    return false;
  }
}

/**
 * Returns a display-only provider list without mutating the persisted config.
 */
export function visibleModelsConfigProviders<T>(
  providers: Record<string, T>,
): Array<[string, T]> {
  return Object.entries(providers).filter(([, provider]) => !isOverrideOnlyProviderEntry(provider));
}
