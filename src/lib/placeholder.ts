/** Detect / strip template & fallback placeholders (待补充…, 待定, TODO, 请描述…). */
const TOKEN = /(待补充[^，。；;,、）)\s]*|待定|TODO|TBD|请描述[^，。；;,、）)\s]*)/gi

export function isPlaceholder(s: string | undefined | null): boolean {
  if (!s) return true
  const rest = s.replace(TOKEN, '').replace(/[\s，。；;,、:：\-_.…]+/g, '')
  return rest.length === 0
}

/** Clean a free-text field: '' if it is only a placeholder, else text with placeholder tokens removed. */
export function cleanField(s: string | undefined | null): string {
  if (!s || isPlaceholder(s)) return ''
  return s
    .replace(TOKEN, '')
    .replace(/[，、；;,]{2,}/g, '，')
    .replace(/^[，、；;,\s]+|[，、；;,\s]+$/g, '')
}

/** Clean a seedance-style prompt: drop placeholder / empty （视觉锁定：…） fragments and stray tokens. */
export function cleanPrompt(p: string): string {
  return p
    .replace(/[（(]视觉锁定[:：]([^）)]*)[）)]/g, (_m, lock: string) => {
      const c = cleanField(lock)
      return c ? `（视觉锁定：${c}）` : ''
    })
    .replace(TOKEN, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[，、]{2,}/g, '，')
    .trim()
}
