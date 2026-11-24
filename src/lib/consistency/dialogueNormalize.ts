import { sha1Hex } from '../hash'

const QUOTE_PAIRS: [string, string][] = [
  ['「', '」'],
  ['“', '”'],
  ['"', '"'],
  ['『', '』'],
  ['‘', '’'],
]

/** N1 + N2：比较键。空键（只剩标点）返回 ''，由调用方按 N6 处理。 */
export function normalizeDialogueKey(text: string): string {
  let s = (text ?? '').normalize('NFKC').replace(/\u3000/g, ' ').replace(/：/g, ':')
  s = s.replace(/\s+/g, '')
  s = stripOuterQuotes(s)
  s = s.replace(/[\p{P}\p{S}]/gu, '').toLowerCase()
  return s
}

export function stripOuterQuotes(text: string): string {
  for (const [l, r] of QUOTE_PAIRS) {
    if (text.length >= l.length + r.length && text.startsWith(l) && text.endsWith(r)) {
      return text.slice(l.length, text.length - r.length)
    }
  }
  return text
}

/** N3：说话人比较前去掉语气括号并去首尾空白。 */
export function normalizeSpeaker(name: string | null | undefined): string {
  if (!name) return ''
  return name.replace(/[（(][^）)]*[）)]/g, '').trim()
}

export function findingTargetKey(code: string, episode: number, lineKey: string, occurrence: number): string {
  return sha1Hex(`${code}|${episode}|${lineKey}|${occurrence}`)
}

/** 字符二元组 Dice 系数。空串或单字与自身为 1，与非空不同串为 0。 */
export function diceBigram(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    if (s.length === 1) {
      m.set(s, 1)
      return m
    }
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) || 0) + 1)
    }
    return m
  }
  const A = grams(a)
  const B = grams(b)
  let inter = 0
  let sizeA = 0
  let sizeB = 0
  for (const n of A.values()) sizeA += n
  for (const n of B.values()) sizeB += n
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0)
  if (sizeA + sizeB === 0) return 0
  return (2 * inter) / (sizeA + sizeB)
}
