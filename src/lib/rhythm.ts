/**
 * Rhythm rules for (split) video packs.
 *  (a) no two consecutive shots (same episode) both shorter than `pairMinSec` (default 4.5 s)
 *  (b) every cross-cut split group should be bracketed: the shot right before / after the group (same episode)
 *      ≥ `bracketSec` (default 6 s). We never invent shots: when a neighbour is shorter, the group's longest
 *      child is extended to ≥ bracketSec instead; if that is impossible it is only a warning.
 *  (c) per episode, shots shorter than `shortSec` (default 5 s) ≤ `maxShortRatio` (default 30 %).
 * `fitSplitRhythm` only lengthens split children (never other shots, never above `maxSec`).
 * `checkRhythm` reports violations of (a)/(c) (errors) and unmet brackets (b) (warnings).
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'

type Shot = VideoPipelineShot

export interface RhythmOptions {
  pairMinSec?: number
  bracketSec?: number
  shortSec?: number
  maxShortRatio?: number
  /** children are never extended beyond this (default 9) */
  maxSec?: number
}
const DEF: Required<RhythmOptions> = { pairMinSec: 4.5, bracketSec: 6, shortSec: 5, maxShortRatio: 0.3, maxSec: 9 }
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100))

export interface SplitGroup {
  splitFrom: string
  episode: number
  /** indices into shots */
  idx: number[]
  /** shot right before / after the group in the same episode (null = episode edge) */
  before: number | null
  after: number | null
}

export function splitGroups(shots: Shot[]): SplitGroup[] {
  const out: SplitGroup[] = []
  shots.forEach((s, i) => {
    if (!s.splitFrom) return
    const g = out[out.length - 1]
    if (g && g.splitFrom === s.splitFrom && g.idx[g.idx.length - 1] === i - 1) g.idx.push(i)
    else out.push({ splitFrom: s.splitFrom, episode: s.episode, idx: [i], before: null, after: null })
  })
  for (const g of out) {
    const a = g.idx[0] - 1
    const b = g.idx[g.idx.length - 1] + 1
    g.before = a >= 0 && shots[a].episode === g.episode ? a : null
    g.after = b < shots.length && shots[b].episode === g.episode ? b : null
  }
  return out
}

export interface RhythmReport {
  ok: boolean
  options: Required<RhythmOptions>
  /** (a) */
  consecutiveShort: string[]
  /** (c) */
  episodeShortRatio: { episode: number; shots: number; short: number; ratio: number; ok: boolean }[]
  /** (b) per group */
  brackets: { group: string; before: string | null; after: string | null; longChild: string; ok: boolean; note: string }[]
  /** human-readable: every (a)/(c) violation + unmet (b) brackets */
  warnings: string[]
}

export function checkRhythm(shots: Shot[], opts: RhythmOptions = {}): RhythmReport {
  const o = { ...DEF, ...opts }
  const warnings: string[] = []
  const consecutiveShort: string[] = []
  for (let i = 0; i + 1 < shots.length; i++) {
    const a = shots[i]
    const b = shots[i + 1]
    if (a.episode === b.episode && a.durationSec < o.pairMinSec && b.durationSec < o.pairMinSec)
      consecutiveShort.push(`${a.id}(${fmt(a.durationSec)}s) + ${b.id}(${fmt(b.durationSec)}s) 连续两镜 < ${o.pairMinSec}s`)
  }
  const eps = [...new Set(shots.map((s) => s.episode))].sort((x, y) => x - y)
  const episodeShortRatio = eps.map((ep) => {
    const e = shots.filter((s) => s.episode === ep)
    const short = e.filter((s) => s.durationSec < o.shortSec).length
    const ratio = e.length ? short / e.length : 0
    return { episode: ep, shots: e.length, short, ratio: Math.round(ratio * 1000) / 1000, ok: ratio <= o.maxShortRatio + 1e-9 }
  })
  const brackets = splitGroups(shots).map((g) => {
    const long = g.idx.reduce((m, i) => (shots[i].durationSec > shots[m].durationSec ? i : m), g.idx[0])
    const nb = [g.before, g.after].filter((x): x is number => x !== null)
    const shortNb = nb.filter((i) => shots[i].durationSec < o.bracketSec - 1e-9)
    const longOk = shots[long].durationSec >= o.bracketSec - 1e-9
    const ok = shortNb.length === 0 || longOk
    const note = shortNb.length
      ? `${shortNb.map((i) => `${shots[i].id}(${fmt(shots[i].durationSec)}s)`).join('、')} < ${o.bracketSec}s，${longOk ? `由长子镜 ${shots[long].id}(${fmt(shots[long].durationSec)}s) 补足` : `长子镜 ${shots[long].id} 仅 ${fmt(shots[long].durationSec)}s`}`
      : '前后镜均 ≥ ' + o.bracketSec + 's'
    return {
      group: g.splitFrom,
      before: g.before === null ? null : shots[g.before].id,
      after: g.after === null ? null : shots[g.after].id,
      longChild: shots[long].id,
      ok,
      note,
    }
  })
  for (const x of consecutiveShort) warnings.push(`(a) ${x}`)
  for (const e of episodeShortRatio)
    if (!e.ok) warnings.push(`(c) 第${e.episode}集 <${o.shortSec}s 镜头 ${e.short}/${e.shots} = ${Math.round(e.ratio * 100)}% > ${Math.round(o.maxShortRatio * 100)}%`)
  for (const b of brackets) if (!b.ok) warnings.push(`(b) ${b.group} 拆分组未被长镜包夹：${b.note}`)
  return { ok: consecutiveShort.length === 0 && episodeShortRatio.every((e) => e.ok), options: o, consecutiveShort, episodeShortRatio, brackets, warnings }
}

/** Rescale a split child's default-format timeline (一镜Ds秒 + a–bs beats) to a new duration. */
export function retimeChild(s: Shot, D: number): Shot {
  const old = s.durationSec
  if (Math.abs(D - old) < 1e-9) return s
  const k = s.prompt.search(/时间轴（一镜/)
  let prompt = s.prompt
  if (k >= 0) {
    const end = prompt.indexOf('。', k)
    const seg = prompt.slice(k, end < 0 ? undefined : end)
    const snap = (x: number) => Math.round(((x * D) / old) * 2) / 2
    let last = 0
    const re = seg
      .replace(/一镜[\d.]+秒/, `一镜${fmt(D)}秒`)
      .replace(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)s/g, (_m, a: string, b: string) => {
        const A = last
        let B = Number(b) >= old - 1e-9 ? D : Math.max(A + 0.5, snap(Number(b)))
        if (B > D) B = D
        last = B
        void a
        return `${fmt(A)}–${fmt(B)}s`
      })
    prompt = prompt.slice(0, k) + re + (end < 0 ? '' : prompt.slice(end))
  }
  return { ...s, durationSec: D, prompt }
}

/**
 * Lengthen split children so the pack meets (b) where possible, then (a), then (c). Returns notes per change.
 * Shots without splitFrom are never touched.
 */
export function fitSplitRhythm(exp: VideoPipelineExport, opts: RhythmOptions = {}): { exp: VideoPipelineExport; notes: string[] } {
  const o = { ...DEF, ...opts }
  const D = exp.shots.map((s) => s.durationSec)
  const notes: string[] = []
  const raise = (i: number, to: number, why: string) => {
    const t = Math.min(o.maxSec, Math.ceil(to * 2) / 2)
    if (t > D[i] + 1e-9) {
      notes.push(`${exp.shots[i].id} ${fmt(D[i])}s → ${fmt(t)}s（${why}）`)
      D[i] = t
    }
  }
  const groups = splitGroups(exp.shots)
  if (!groups.length) return { exp, notes }
  // (b) bracket: short neighbour → longest child ≥ bracketSec
  for (const g of groups) {
    const nb = [g.before, g.after].filter((x): x is number => x !== null)
    const shortNb = nb.filter((i) => D[i] < o.bracketSec - 1e-9)
    if (!shortNb.length) continue
    // longest child; ties → the child closest to a short neighbour
    const dist = (i: number) => Math.min(...shortNb.map((j) => Math.abs(i - j)))
    const long = g.idx.reduce((m, i) => (D[i] > D[m] + 1e-9 || (Math.abs(D[i] - D[m]) < 1e-9 && dist(i) < dist(m)) ? i : m), g.idx[0])
    raise(long, o.bracketSec, `前后镜 < ${o.bracketSec}s，长子镜补足包夹`)
  }
  // (a) consecutive shorts: raise a split child of the pair (the one already longer = cheaper)
  for (let i = 0; i + 1 < D.length; i++) {
    const a = exp.shots[i]
    const b = exp.shots[i + 1]
    if (a.episode !== b.episode || D[i] >= o.pairMinSec || D[i + 1] >= o.pairMinSec) continue
    // prefer the child that fixes the most short pairs (e.g. the middle of 3 short children), then the longer one
    const bad = (x: number, y: number) =>
      x >= 0 && y < D.length && exp.shots[x].episode === exp.shots[y].episode && D[x] < o.pairMinSec && D[y] < o.pairMinSec ? 1 : 0
    const fixes = (j: number) => bad(j - 1, j) + bad(j, j + 1)
    const cand = [i, i + 1].filter((j) => exp.shots[j].splitFrom).sort((x, y) => fixes(y) - fixes(x) || D[y] - D[x])
    if (cand.length) raise(cand[0], o.pairMinSec, `避免连续两镜 < ${o.pairMinSec}s`)
  }
  // (c) per-episode short ratio: raise the cheapest short split children to shortSec
  for (const ep of [...new Set(exp.shots.map((s) => s.episode))]) {
    const ids = exp.shots.map((s, i) => (s.episode === ep ? i : -1)).filter((i) => i >= 0)
    const cap = Math.floor(ids.length * o.maxShortRatio + 1e-9)
    let short = ids.filter((i) => D[i] < o.shortSec).length
    const pool = ids.filter((i) => exp.shots[i].splitFrom && D[i] < o.shortSec).sort((x, y) => D[y] - D[x] || x - y)
    for (const i of pool) {
      if (short <= cap) break
      raise(i, o.shortSec, `第${ep}集 <${o.shortSec}s 镜头超过 ${Math.round(o.maxShortRatio * 100)}%`)
      short--
    }
  }
  if (!notes.length) return { exp, notes }
  return { exp: { ...exp, shots: exp.shots.map((s, i) => retimeChild(s, D[i])) }, notes }
}
