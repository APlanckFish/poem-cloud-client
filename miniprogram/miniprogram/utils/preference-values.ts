const PREFERENCE_VALUE_SEPARATOR = /[，,、；;\r\n]+/

/** 将一次输入拆成独立标签，并保持输入顺序去重。 */
export function parseCustomPreferenceValues(input: string): string[] {
  return [...new Set(
    input
      .split(PREFERENCE_VALUE_SEPARATOR)
      .map((value) => value.trim())
      .filter(Boolean),
  )]
}
