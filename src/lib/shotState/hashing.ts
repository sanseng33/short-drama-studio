/** 集合语义的规范化与 hash（纯函数）。 */
import { sha1Hex } from '../hash'
import type { ShotStateSource } from './types'

const uniq = (xs: string[]): string[] => [...new Set(xs)]
const sortedUniq = (xs: string[]): string[] => uniq(xs).sort()

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size !== B.size) return false
  for (const x of A) if (!B.has(x)) return false
  return true
}

export function setDiff(a: readonly string[], b: readonly string[]): string[] {
  const B = new Set(b)
  return uniq([...a]).filter((x) => !B.has(x))
}

/** 规范形：集合类字段排序去重，events 保留时序，displayOrder 不参与。 */
export function canonicalSource(s: ShotStateSource) {
  return {
    cast: sortedUniq(s.cast),
    firstFrame: s.firstFrame
      .map((e) => ({ id: e.id, kind: e.kind, parts: e.parts && e.parts.length ? sortedUniq(e.parts) : undefined }))
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    speech: s.speech
      .map((e) => ({ id: e.id, mode: e.mode }))
      .sort((x, y) => (x.id + '|' + x.mode < y.id + '|' + y.mode ? -1 : x.id + '|' + x.mode > y.id + '|' + y.mode ? 1 : 0)),
    events: s.events.map((e) => ({ id: e.id, kind: e.kind, atSec: e.atSec })),
    costume: (s.costume || [])
      .map((e) => ({ id: e.id, state: e.state }))
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
  }
}

export const hashSource = (s: ShotStateSource): string => sha1Hex(JSON.stringify(canonicalSource(s)))
export const hashText = (text: string): string => sha1Hex(text)

/** 由任意顺序的 cast 建立规范 source：cast 排序去重，displayOrder 保留原顺序。 */
export function normalizeSource(input: Partial<ShotStateSource> & { cast: string[] }): ShotStateSource {
  const order = uniq(input.displayOrder && input.displayOrder.length ? input.displayOrder : input.cast)
  const rest = uniq(input.cast).filter((x) => !order.includes(x))
  return {
    cast: sortedUniq(input.cast),
    displayOrder: [...order.filter((x) => input.cast.includes(x)), ...rest],
    firstFrame: input.firstFrame ? input.firstFrame.map((e) => ({ ...e })) : [],
    speech: input.speech ? input.speech.map((e) => ({ ...e })) : [],
    events: input.events ? input.events.map((e) => ({ ...e })) : [],
    ...(input.costume ? { costume: input.costume.map((e) => ({ ...e })) } : {}),
  }
}
