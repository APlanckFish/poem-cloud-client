/**
 * 避免使用部分真机 JavaScript 引擎不支持的 Unicode 属性正则
 *（例如 /\p{Script=Han}/u）。
 */
export function isHanCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return false
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
    || (codePoint >= 0x30000 && codePoint <= 0x3134f)
  )
}
