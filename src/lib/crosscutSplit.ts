/**
 * Opt-in cross-cut split (video-pipeline@1).
 *
 * A merged segment that shows two characters in facing windows / a cross-cut (对窗/对切, see CROSSCUT_RE) cannot
 * be filmed as one continuous shot. `splitCrossCutShots` turns each such segment into solo shots
 * `<id>a`, `<id>b`, … (beat / visual order), each with one subject, its own beats, `splitFrom`, and the dialogue of
 * the character who speaks in it (the others listen with closed lips).
 *
 * `assignAngleKeys` then sets on EVERY shot:
 *   angleKey        = `${sceneId}_${sorted characterIds joined '+' | 'empty'}`   e.g. villa_bedroom_day_c2
 *   carryFromShotId = most recent earlier shot (output order) with the same angleKey, null for the first one.
 * Runner rule: carryFromShotId string wins; key present + null = start from the character-pack ref; key absent =
 * legacy carryFromPrev. The carried frame is the clean silent pre-LatentSync last frame.
 *
 * Pure functions; default export path never calls this (opt-in via splitCrossCut / repack --split-crosscut).
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import type { DialogueLineOut } from './segmentPost'
import { CARRY_WARDROBE_CONSTRAINT } from './sceneContinuity'
import { clause, CROSSCUT_RE, dedupeClauses, isBeatPrompt, MARK_RE, nameVariants, parseMergedTimeline, SOLO_SPLIT_LIMIT, splitTop } from './beatPrompt'

type Shot = VideoPipelineShot
type Char = VideoPipelineExport['characters'][number]

export interface SplitChildInfo {
  id: string
  characterId: string
  durationSec: number
  speaker: string | null
  speakerName: string | null
  dialogue: string
}
export interface SplitInfo {
  id: string
  durationSec: number
  children: SplitChildInfo[]
  notes: string[]
}

const OTHER_REF = '对面窗口'
/** one clause on purpose (beat mode splits on ，) */
const LISTEN = '嘴唇闭合安静听对面说话'
const BEAT_FIELDS = ['beatMode', 'beatSegments', 'beatRemovedProps', 'beatTodo', 'promptDefault'] as const
const paced = (t: string) => (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100))
const r2 = (x: number) => Math.round(x * 100) / 100
const SUFFIX = 'abcdefghijklmnopqrstuvwxyz'

/** source (non-beat) prompt of a shot */
function sourcePrompt(s: Shot): string {
  return s.promptDefault && isBeatPrompt(s.prompt) ? s.promptDefault : s.prompt || ''
}

/** Same rule as the beat-mode TODO: ≥2 on-screen characters + facing windows / cross-cut wording. */
export function isCrossCutShot(s: Shot): boolean {
  return (s.characterIds || []).length >= 2 && !s.splitFrom && CROSSCUT_RE.test(sourcePrompt(s))
}

// ---------------- names ----------------

interface CastName {
  text: string
  id: string
}
function castNames(chars: Char[], cast: string[]): CastName[] {
  const out: CastName[] = []
  for (const v of nameVariants(chars)) {
    const ids = v.ids?.length ? v.ids : v.id ? [v.id] : []
    const id = ids.find((x) => cast.includes(x))
    if (id && v.text.length >= 2) out.push({ text: v.text, id })
  }
  return out.sort((a, b) => b.text.length - a.text.length)
}
const LEAD = /^(?:随后|然后|同时|接着|紧接着|而|只见|再)\s*/
function clauseSubject(cl: string, names: CastName[]): string | null {
  const t = cl.trim().replace(LEAD, '')
  return names.find((n) => t.startsWith(n.text))?.id ?? null
}
/** first character named as a subject (skips 过X肩 / 越X肩 framing mentions) */
function namedSubject(text: string, names: CastName[]): string | null {
  let best: { i: number; id: string } | null = null
  for (const n of names) {
    let from = 0
    for (;;) {
      const i = text.indexOf(n.text, from)
      if (i < 0) break
      from = i + n.text.length
      const before = text.slice(Math.max(0, i - 1), i)
      const after = text.slice(i + n.text.length).replace(/^[（(][^）)]{0,8}[）)]/, '')
      // framing (过X肩) or a place owned by X (X家 / X的旧楼 / X别墅) is not X on screen
      if (/[过越从]/.test(before) || /^的?肩/.test(after) || /^(家|的(家|旧楼|楼|房|别墅|窗|卧室))|^(家的|别墅|卧室)/.test(after)) continue
      if (!best || i < best.i) best = { i, id: n.id }
      break
    }
  }
  return best?.id ?? null
}
function displayName(c: Char | undefined): string {
  return (c?.baseName || c?.name || '').replace(/[（(][^）)]*[）)]/g, '')
}
/** replace the other cast members' names with a neutral off-screen reference */
function replaceOthers(text: string, owner: string, names: CastName[]): string {
  let t = text
  const ownTexts = new Set(names.filter((n) => n.id === owner).map((n) => n.text))
  for (const n of names) {
    if (n.id === owner || ownTexts.has(n.text)) continue
    t = t.split(`${n.text}家`).join('对面').split(n.text).join(OTHER_REF)
  }
  return t
    .replace(/两人/g, `他与${OTHER_REF}`)
    .replace(new RegExp(`${OTHER_REF}的?(?:[（(][^）)]*[）)])?`, 'g'), OTHER_REF)
    .replace(new RegExp(`(?:${OTHER_REF}){2,}`, 'g'), OTHER_REF)
}

// ---------------- places ----------------

interface Home {
  placeKey: string
  sceneId: string
  sceneLabel: string
}
function labelPlace(label: string | undefined): string {
  return (label || '').split('·')[0].trim()
}
function bigramHits(text: string, label: string): number {
  let n = 0
  for (let i = 0; i + 1 < label.length; i++) if (text.includes(label.slice(i, i + 2))) n++
  return n
}

/** Per character: which candidate place (crosscut placeKeys) they usually appear in alone. */
function homesFor(s: Shot, all: Shot[], crossPlaces: Set<string>): Map<string, Home> {
  const cast = s.characterIds
  // candidates: this shot's place, other cross-cut places, and places of the cast's nearby solo shots (±3, same episode)
  const at = all.indexOf(s)
  const near = all
    .filter((x, i) => at >= 0 && Math.abs(i - at) <= 3 && x.episode === s.episode && x.characterIds?.length === 1 && cast.includes(x.characterIds[0]))
    .map((x) => x.placeKey)
  const cands = [...new Set([s.placeKey, ...crossPlaces, ...near].filter(Boolean) as string[])]
  const count = (id: string, pk: string) => all.filter((x) => x.characterIds?.length === 1 && x.characterIds[0] === id && x.placeKey === pk).length
  const pick = new Map<string, string>()
  for (const id of cast) {
    let best = s.placeKey || cands[0] || ''
    let bc = best ? count(id, best) : 0
    for (const pk of cands) {
      const c = count(id, pk)
      if (c > bc) {
        best = pk
        bc = c
      }
    }
    pick.set(id, best)
  }
  // facing windows → two different places when we can tell them apart
  if (cast.length >= 2 && new Set(pick.values()).size === 1 && cands.length > 1) {
    const same = [...pick.values()][0]
    const other = cands.find((x) => x !== same)!
    const weakest = [...cast].sort((a, b) => count(a, same) - count(b, same) || count(b, other) - count(a, other))[0]
    if (count(weakest, other) > 0) pick.set(weakest, other)
  }
  const out = new Map<string, Home>()
  for (const id of cast) {
    const pk = pick.get(id) || s.placeKey || ''
    if (!pk || pk === s.placeKey) {
      out.set(id, { placeKey: s.placeKey || '', sceneId: s.sceneId || '', sceneLabel: s.sceneLabel || '' })
      continue
    }
    const sceneId = s.timeBand ? `${pk}_${s.timeBand}` : pk
    const same = all.find((x) => x.sceneId === sceneId && x.sceneLabel)
    const anyPlace = all.find((x) => x.placeKey === pk && x.sceneLabel)
    const tail = (s.sceneLabel || '').split('·')[1]
    const sceneLabel = same?.sceneLabel || (anyPlace ? `${labelPlace(anyPlace.sceneLabel)}${tail ? `·${tail}` : ''}` : s.sceneLabel || '')
    out.set(id, { placeKey: pk, sceneId, sceneLabel })
  }
  return out
}

// ---------------- splitting one shot ----------------

interface Sub {
  owner: string
  act: string[]
  perf: string[]
  speak: boolean
  voice: boolean
  dur: number
  beatIdx: number
}

/** map item j of m items onto beat buckets 0..n-1 (and back) */
function bucketOf(j: number, m: number, n: number): number {
  return Math.min(n - 1, Math.floor((j * n) / m))
}
function itemsForBeat(i: number, m: number, n: number): number[] {
  if (!m) return []
  if (m < n) return [Math.min(m - 1, Math.floor((i * m) / n))]
  const out: number[] = []
  for (let j = 0; j < m; j++) if (bucketOf(j, m, n) === i) out.push(j)
  return out
}

/** Durations for n children: total ≈ original (never below 3 s each, 5 s each when the original allows), 0.5 s grid. */
export function allocateSplitDurations(raw: number[], orig: number, minSec: number[] = []): number[] {
  const n = raw.length
  const lo = orig >= 5 * n ? 5 : 3
  // per-child floor: ≥3 s (5 s when the original allows), and enough for that child's dialogue
  const mins = raw.map((_, i) => Math.min(9, Math.max(lo, Math.ceil((minSec[i] || 0) * 2) / 2)))
  const T = Math.max(Math.round(orig * 2) / 2, mins.reduce((a, b) => a + b, 0))
  const sum = raw.reduce((a, b) => a + Math.max(b, 0.01), 0)
  let d = raw.map((r) => (Math.max(r, 0.01) * T) / sum)
  // raise short children to their floor, taking time from the longer ones (proportional to their excess)
  const deficit = d.reduce((a, x, i) => a + Math.max(0, mins[i] - x), 0)
  if (deficit > 0) {
    const excess = d.reduce((a, x, i) => a + Math.max(0, x - mins[i]), 0)
    d = d.map((x, i) => (x < mins[i] ? mins[i] : x - (excess > 0 ? ((x - mins[i]) / excess) * deficit : 0)))
  }
  // prefer ≤9 s: move overflow to children with room
  const over = d.reduce((a, x) => a + Math.max(0, x - 9), 0)
  if (over > 0) {
    const room = d.reduce((a, x) => a + Math.max(0, 9 - x), 0)
    if (room > 0) {
      const mv = Math.min(over, room)
      d = d.map((x) => (x > 9 ? x - ((x - 9) / over) * mv : x + ((9 - x) / room) * mv))
    }
  }
  // 0.5 grid, exact total, largest remainder
  const units = Math.round(T * 2)
  const fl = d.map((x, i) => Math.max(mins[i] * 2, Math.floor(x * 2 + 1e-9)))
  let left = units - fl.reduce((a, b) => a + b, 0)
  const order = d.map((x, i) => ({ i, r: x * 2 - Math.floor(x * 2 + 1e-9) })).sort((a, b) => b.r - a.r)
  for (let k = 0; left > 0; k = (k + 1) % n, left--) fl[order[k].i]++
  for (let k = n - 1; left < 0; k = (k - 1 + n) % n) {
    const i = order[k].i
    if (fl[i] > mins[i] * 2) {
      fl[i]--
      left++
    }
  }
  return fl.map((u) => u / 2)
}

/** cumulative 0.5-grid boundaries inside a child (each beat ≥0.5 s; exact total) */
function childTimes(durs: number[], D: number): number[] {
  const n = durs.length
  const sum = durs.reduce((a, b) => a + b, 0) || 1
  const bounds: number[] = [0]
  let acc = 0
  for (let k = 0; k < n - 1; k++) {
    acc += (durs[k] * D) / sum
    let b = Math.round(acc * 2) / 2
    b = Math.max(b, bounds[k] + 0.5)
    b = Math.min(b, D - 0.5 * (n - 1 - k))
    bounds.push(b)
  }
  bounds.push(D)
  return bounds
}

const CAM_TWO = /过肩|越.{0,10}肩|正反打|同框|双窗|对切|切换|两窗/
const LIGHT = /(晨光|天光|日光|灯光|光从|光线|逆光|侧光|柔光|暖光|冷光|阳光|月光|斜阳|斜射|光照|映亮|打亮|照亮|灯火)/
const CONT = /^(背景|身后|旁边|窗台|他|她|两窗|玻璃|画面|墙|屋里|房间)/

/** Split one cross-cut segment into solo children (pure). Returns null when the beats cannot be read. */
export function splitCrossCutShot(s: Shot, chars: Char[], all: Shot[], crossPlaces: Set<string>): { children: Shot[]; info: SplitInfo } | null {
  const src = sourcePrompt(s)
  const cast = s.characterIds || []
  const names = castNames(chars, cast)
  const byId = new Map(chars.map((c) => [c.id, c]))
  const notes: string[] = []
  const homes = homesFor(s, all, crossPlaces)
  const primary = cast.find((id) => homes.get(id)?.placeKey === s.placeKey) || cast[0]

  // ---- visual parts → owners
  const vparts = splitTop(s.visual || '', '；;').map((x) => x.trim()).filter(Boolean)
  const vOwner: (string | null)[] = vparts.map((p) => namedSubject(p, names))
  for (let j = 0; j < vparts.length; j++) {
    if (vOwner[j]) continue
    const scores = cast.map((id) => ({ id, n: bigramHits(vparts[j], labelPlace(homes.get(id)?.sceneLabel)) }))
    const top = Math.max(...scores.map((x) => x.n))
    const tops = scores.filter((x) => x.n === top)
    if (top > 0 && tops.length === 1) vOwner[j] = tops[0].id
  }
  const filled = vOwner.slice()
  for (let j = 0; j < vparts.length; j++) {
    if (filled[j]) continue
    const prev = filled.slice(0, j).reverse().find(Boolean) || null
    const next = vOwner.slice(j + 1).find(Boolean) || null
    filled[j] = (CONT.test(vparts[j]) ? prev || next : next || prev) || primary
  }

  // ---- beats
  let beats = parseMergedTimeline(src)
  if (!beats?.length) {
    const t = s.action || clause(src, /动作/) || ''
    if (!t) return null
    beats = [{ text: t, start: 0, end: s.durationSec, speech: Boolean(s.dialogue), voice: false, speakers: [] }]
  }
  const nb = beats.length
  const camParts = (s.camera || '').split(/[，,]?\s*随后\s*/).map((x) => x.trim()).filter(Boolean)
  const emoParts = (s.emotion || '').split(/→|->/).map((x) => x.trim()).filter(Boolean)
  const lines: DialogueLineOut[] = s.dialogueLines?.length
    ? s.dialogueLines
    : s.dialogue
      ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue, ...(s.speakerOffscreen ? { voiceOnly: true } : {}) }]
      : []
  const idOfName = (nm: string): string | null => names.find((n) => n.text === nm || n.text.startsWith(nm))?.id ?? (lines.find((l) => l.speakerName === nm && l.speaker && cast.includes(l.speaker))?.speaker || null)

  const subs: Sub[] = []
  let prevOwner: string | null = null
  beats.forEach((b, i) => {
    const raw = b.text.replace(MARK_RE, '')
    const k = raw.search(/表演[：:]/)
    const actTxt = (k >= 0 ? raw.slice(0, k) : raw).replace(/^(?:随后)\s*/, '')
    const perfTxt = k >= 0 ? raw.slice(k).replace(/^表演[：:]/, '') : ''
    const actCls = splitTop(actTxt, '，,；;').map((x) => x.trim()).filter((x) => paced(x) > 0)
    const perfCls = splitTop(perfTxt, '，,；;').map((x) => x.trim()).filter((x) => paced(x) > 0)
    const spk = b.speakers.map(idOfName).filter(Boolean) as string[]
    // default owner of this beat
    const vis = itemsForBeat(i, vparts.length, nb).map((j) => filled[j]).filter(Boolean) as string[]
    const visOwner = vis.length ? [...vis].sort((a, c) => vis.filter((x) => x === c).length - vis.filter((x) => x === a).length)[0] : null
    const owner0 =
      (spk.length === 1 ? spk[0] : null) ||
      actCls.map((c) => clauseSubject(c, names)).find(Boolean) ||
      perfCls.map((c) => clauseSubject(c, names)).find(Boolean) ||
      visOwner ||
      prevOwner ||
      primary
    // subject tracking → per-owner clause sets
    const per = new Map<string, { act: string[]; perf: string[] }>()
    const put = (id: string, part: 'act' | 'perf', c: string) => {
      if (!per.has(id)) per.set(id, { act: [], perf: [] })
      per.get(id)![part].push(c)
    }
    let cur = owner0
    for (const c of actCls) {
      cur = clauseSubject(c, names) || cur
      put(cur, 'act', c)
    }
    cur = owner0
    for (const c of perfCls) {
      cur = clauseSubject(c, names) || cur
      put(cur, 'perf', c)
    }
    if (!per.size) per.set(owner0, { act: [], perf: [] })
    let ids = [...per.keys()]
    if (ids.length > 1) {
      // keep runs short: previous owner first, the next beat's likely owner last
      const nextB = beats![i + 1]
      const nextOwner = nextB ? (nextB.speakers.map(idOfName).find(Boolean) as string | undefined) || clauseSubject(nextB.text, names) : null
      ids.sort((a, c) => {
        const w = (x: string) => (x === prevOwner ? -2 : 0) + (x === nextOwner ? 2 : 0)
        return w(a) - w(c)
      })
      notes.push(`${fmt(b.start)}–${fmt(b.end)}s 节拍含两人动作，按主语拆给 ${ids.join(' / ')}`)
    }
    ids = ids.filter((id) => per.get(id)!.act.length + per.get(id)!.perf.length > 0 || ids.length === 1)
    const W = ids.reduce((a, id) => a + Math.max(2, paced([...per.get(id)!.act, ...per.get(id)!.perf].join(''))), 0)
    for (const id of ids) {
      const p = per.get(id)!
      const w = Math.max(2, paced([...p.act, ...p.perf].join('')))
      const speak = b.speech && (spk.length ? spk.includes(id) : id === owner0)
      subs.push({ owner: id, act: p.act, perf: p.perf, speak, voice: b.voice && id === owner0, dur: ((b.end - b.start) * w) / W, beatIdx: i })
    }
    prevOwner = ids[ids.length - 1]
  })

  if (subs.some((x) => /无人物|空镜/.test([...x.act, ...x.perf].join('')))) notes.push('含无人物空镜节拍，已并入相邻单人镜开头')
  // ---- runs
  const runs: Sub[][] = []
  for (const sb of subs) {
    const last = runs[runs.length - 1]
    if (last && last[0].owner === sb.owner) last.push(sb)
    else runs.push([sb])
  }
  // ---- dialogue lines → children
  const lineChild = lines.map((l) => {
    const own = runs.map((r, ri) => ({ r, ri })).filter((x) => l.speaker && x.r[0].owner === l.speaker)
    const speaking = own.find((x) => x.r.some((sb) => sb.speak))
    if (speaking) return speaking.ri
    if (own.length) return own[0].ri
    const voice = runs.findIndex((r) => r.some((sb) => sb.voice))
    if (voice >= 0) return voice
    const any = runs.findIndex((r) => r.some((sb) => sb.speak))
    return any >= 0 ? any : 0
  })

  // dialogue needs ~4.5 chars/s plus ~1 s of action around it
  const needSec = runs.map((_, ri) => {
    const t = lines.filter((_, li) => lineChild[li] === ri).reduce((a, l) => a + paced(l.text || '') / 4.5, 0)
    return t > 0 ? t + 1 : 0
  })
  const durs = allocateSplitDurations(
    runs.map((r) => r.reduce((a, x) => a + x.dur, 0)),
    s.durationSec,
    needSec,
  )
  const total = durs.reduce((a, b) => a + b, 0)
  if (Math.abs(total - s.durationSec) > 0.01) notes.push(`总时长 ${fmt(s.durationSec)}s → ${fmt(total)}s（每个单人镜 ≥3s，台词镜按语速留足时长）`)
  const absent = cast.filter((id) => !runs.some((r) => r[0].owner === id))
  if (absent.length) notes.push(`角色 ${absent.join('、')} 在节拍中没有可拍的动作，未单独成镜`)

  // ---- header pieces
  const origHead = (() => {
    const p = src.replace(/竖屏9:16[，,。；;]?/g, '')
    const k = p.search(/(主体|构图)\s*[：:]/)
    return (k >= 0 ? p.slice(0, k) : '')
      .split(/[。\n]/)
      .map((x) => x.trim())
      .filter((x) => x && !CROSSCUT_RE.test(x))[0]
      ?.replace(/[，,；;\s]+$/, '') || ''
  })()
  const subjPieces = splitTop(clause(src, /主体/), '；;').map((x) => x.trim()).filter(Boolean)
  const styleCl = clause(src, /风格/)
  const lightCl = clause(src, /光线/)
  const limitCl = dedupeClauses(
    splitTop(clause(src, /限制/).split(CARRY_WARDROBE_CONSTRAINT).join(''), '，,')
      .map((x) => x.trim())
      .filter((x) => x && !/^服装无任何标志、样$/.test(x) && !/^(不出现人物|无人物|空镜)$/.test(x) && !/^(保持与上一镜末帧一致|禁止换装|禁止换回定妆静帧服装)/.test(x)),
  ).join('，')

  const children: Shot[] = runs.map((run, ri) => {
    const owner = run[0].owner
    const c = byId.get(owner)
    const home = homes.get(owner)!
    const D = durs[ri]
    const id = `${s.id}${SUFFIX[ri]}`
    const myLines = lines.filter((_, li) => lineChild[li] === ri)
    const beatIdx = [...new Set(run.map((x) => x.beatIdx))]
    // timeline
    const bounds = childTimes(
      run.map((x) => x.dur),
      D,
    )
    const listen = lines.length > 0 && myLines.length === 0
    const beatTexts = run.map((sb, k) => {
      const act = replaceOthers(sb.act.join('，'), owner, names)
      const perf = replaceOthers(sb.perf.join('，'), owner, names)
      let body = act || perf || '保持姿态，呼吸与眼神有细微变化'
      if (listen && k === run.length - 1) body += `，${LISTEN}`
      const mark = sb.speak && myLines.length ? `（${displayName(c)}开口说台词）` : sb.voice && myLines.length ? '（画外人声）' : ''
      const tail = act && perf ? `，表演：${perf}` : ''
      return `${fmt(bounds[k])}–${fmt(bounds[k + 1])}s${k ? '随后' : ''}${body}${mark}${tail}`.replace(/。/g, '，')
    })
    // subject
    const own = names.filter((n) => n.id === owner).map((n) => n.text)
    const mine = subjPieces.filter((p) => own.some((n) => p.includes(n)) && !/背影|剪影|与对窗/.test(p))
    const subj =
      mine.sort((a, b) => (b.match(/岁|发|眉|校服|夹克|卫衣|衬衫|裤|外套/g) || []).length - (a.match(/岁|发|眉|校服|夹克|卫衣|衬衫|裤|外套/g) || []).length)[0] ||
      [`${c?.age ? `${c.age}岁` : ''}东亚少年${c?.name || ''}`, (c?.visualLock || '').split(/[，,；;]/).slice(0, 3).join('，'), (c?.costumePrompt || c?.costume || '').split(/[，,；;]/)[0]]
        .filter(Boolean)
        .join('，')
    // camera / visual / light
    const cams = [...new Set(beatIdx.flatMap((i) => itemsForBeat(i, camParts.length, nb).map((j) => camParts[j])))]
      .map((x) => (CAM_TWO.test(x) ? s.size || '近景' : x))
      .filter((x, i, a) => i === 0 || x !== a[i - 1])
    const camera = cams.join('，随后') || s.size || '近景'
    const myV = vparts.filter((_, j) => filled[j] === owner).map((p) => replaceOthers(p, owner, names))
    const vlight = myV
      .flatMap((p) => splitTop(p.replace(/^[^：:]{0,14}[：:]/, ''), '，,'))
      .filter((x) => LIGHT.test(x) && !own.some((n) => x.startsWith(n)))
      .join('，')
    const light = home.placeKey === s.placeKey ? lightCl || vlight : vlight || lightCl
    const head =
      home.placeKey === s.placeKey && origHead
        ? origHead
        : [s.timeOfDay?.trim(), `${labelPlace(home.sceneLabel)}${/窗/.test(labelPlace(home.sceneLabel)) ? '前' : '窗前'}`].filter(Boolean).join('，')
    const prompt = [
      `竖屏9:16。${head}。`,
      `主体：${subj}。`,
      `时间轴（一镜${fmt(D)}秒，小节拍）：${beatTexts.join('；')}。`,
      `镜头：${camera}。`,
      myV.length ? `画面：${myV.join('；').replace(/。/g, '，')}。` : '',
      styleCl ? `风格：${styleCl}。` : '',
      light ? `光线：${light}。` : '',
      `限制：${[limitCl, SOLO_SPLIT_LIMIT].filter(Boolean).join('，')}。`,
    ].join('')
    const emo = [...new Set(beatIdx.flatMap((i) => itemsForBeat(i, emoParts.length, nb).map((j) => emoParts[j])))].join('→')
    const first = myLines[0]
    const child: Shot = {
      ...s,
      id,
      characterIds: [owner],
      prompt,
      visual: myV.join('；'),
      action: run.map((sb) => replaceOthers(sb.act.join('，') || sb.perf.join('，'), owner, names)).join('；'),
      durationSec: D,
      camera,
      emotion: emo || s.emotion,
      dialogue: first?.text || '',
      speaker: first?.speaker ?? null,
      speakerName: first?.speakerName ?? null,
      voiceOnly: (s.voiceOnly || []).filter((v) => myLines.some((l) => l.speaker === v)),
      sfx: ri === 0 ? s.sfx : [],
      overlayText: ri === 0 ? s.overlayText : [],
      sceneId: home.sceneId || s.sceneId,
      sceneLabel: home.sceneLabel || s.sceneLabel,
      placeKey: home.placeKey || s.placeKey,
      timeBand: s.timeBand,
      splitFrom: s.id,
    }
    if (s.mergedFrom && s.mergedFrom.length === nb) child.mergedFrom = beatIdx.map((i) => s.mergedFrom![i])
    if (myLines.length > 1) child.dialogueLines = myLines
    else delete child.dialogueLines
    if (first?.voiceOnly) child.speakerOffscreen = true
    else delete child.speakerOffscreen
    for (const f of BEAT_FIELDS) delete (child as Partial<Shot>)[f]
    delete child.angleKey
    delete child.carryFromShotId
    return child
  })
  // children after the first never chain from the previous (other-character) shot; assignAngleKeys refines this
  children.forEach((c, i) => {
    c.carryFromPrev = i === 0 ? Boolean(s.carryFromPrev) : false
  })
  return {
    children,
    info: {
      id: s.id,
      durationSec: s.durationSec,
      children: children.map((c) => ({ id: c.id, characterId: c.characterIds[0], durationSec: c.durationSec, speaker: c.speaker, speakerName: c.speakerName, dialogue: c.dialogue })),
      notes,
    },
  }
}

/** Split every cross-cut segment of a pack into solo shots (no angle keys yet). */
export function splitCrossCutShots(exp: VideoPipelineExport): { exp: VideoPipelineExport; splits: SplitInfo[] } {
  const crossPlaces = new Set(exp.shots.filter(isCrossCutShot).map((s) => s.placeKey).filter(Boolean) as string[])
  const splits: SplitInfo[] = []
  const shots: Shot[] = []
  for (const s of exp.shots) {
    if (!isCrossCutShot(s)) {
      shots.push(s)
      continue
    }
    const r = splitCrossCutShot(s, exp.characters, exp.shots, crossPlaces)
    if (!r) {
      shots.push(s)
      continue
    }
    shots.push(...r.children)
    splits.push(r.info)
  }
  return { exp: { ...exp, shots }, splits }
}

// ---------------- angle keys ----------------

export function angleKeyOf(s: Pick<Shot, 'sceneId' | 'placeKey' | 'timeBand' | 'characterIds'>): string {
  const scene = s.sceneId || [s.placeKey, s.timeBand].filter(Boolean).join('_') || 'scene'
  const who = [...(s.characterIds || [])].sort().join('+') || 'empty'
  return `${scene}_${who}`
}

/** Set angleKey + carryFromShotId on every shot (output order). carryFromPrev is untouched except on split children. */
export function assignAngleKeys(exp: VideoPipelineExport): VideoPipelineExport {
  const last = new Map<string, string>()
  const shots = exp.shots.map((s0, i) => {
    const s: Shot = { ...s0 }
    s.angleKey = angleKeyOf(s)
    s.carryFromShotId = last.get(s.angleKey) ?? null
    last.set(s.angleKey, s.id)
    if (s.splitFrom) {
      const prevId = i ? exp.shots[i - 1].id : null
      s.carryFromPrev = Boolean(s.carryFromShotId) && s.carryFromShotId === prevId
      if (s.carryFromShotId && !isBeatPrompt(s.prompt) && !s.prompt.includes(CARRY_WARDROBE_CONSTRAINT)) {
        s.prompt = s.prompt.replace(/(限制[：:][^。]*)。/, `$1，${CARRY_WARDROBE_CONSTRAINT}。`)
      }
    }
    return s
  })
  return { ...exp, shots }
}

/** Every carryFromShotId must point to an EARLIER shot with the same angleKey; no cycles; unique ids. */
export function validateCarryChain(shots: Pick<Shot, 'id' | 'angleKey' | 'carryFromShotId'>[]): string[] {
  const errs: string[] = []
  const idx = new Map<string, number>()
  shots.forEach((s, i) => {
    if (idx.has(s.id)) errs.push(`重复 id ${s.id}`)
    idx.set(s.id, i)
  })
  shots.forEach((s, i) => {
    if (s.angleKey === undefined) errs.push(`${s.id} 缺少 angleKey`)
    if (s.carryFromShotId === undefined) errs.push(`${s.id} 缺少 carryFromShotId`)
    if (!s.carryFromShotId) return
    const j = idx.get(s.carryFromShotId)
    if (j === undefined) errs.push(`${s.id} → ${s.carryFromShotId} 不存在`)
    else if (j >= i) errs.push(`${s.id} → ${s.carryFromShotId} 不是更早的镜头`)
    else if (shots[j].angleKey !== s.angleKey) errs.push(`${s.id} → ${s.carryFromShotId} angleKey 不一致 (${s.angleKey} ≠ ${shots[j].angleKey})`)
  })
  // cycle check (independent of the ordering rule)
  const byId = new Map(shots.map((s) => [s.id, s]))
  for (const s of shots) {
    const seen = new Set<string>([s.id])
    let cur = s.carryFromShotId
    while (cur) {
      if (seen.has(cur)) {
        errs.push(`${s.id} 的 carry 链存在环`)
        break
      }
      seen.add(cur)
      cur = byId.get(cur)?.carryFromShotId ?? null
    }
  }
  return errs
}

/** Chains worth a human look (not errors). */
export function reviewCarryChains(shots: Shot[]): { crossEpisode: string[]; legacyMismatch: string[]; longGap: string[] } {
  const idx = new Map(shots.map((s, i) => [s.id, i]))
  const crossEpisode: string[] = []
  const legacyMismatch: string[] = []
  const longGap: string[] = []
  shots.forEach((s, i) => {
    const prev = i ? shots[i - 1] : null
    if (s.carryFromShotId) {
      const t = shots[idx.get(s.carryFromShotId)!]
      if (t.episode !== s.episode) crossEpisode.push(`${s.id} ← ${t.id} (${s.angleKey})`)
      else if (i - idx.get(s.carryFromShotId)! > 4) longGap.push(`${s.id} ← ${t.id} (+${i - idx.get(s.carryFromShotId)!} 镜)`)
    }
    if (s.carryFromPrev && prev && s.carryFromShotId !== prev.id)
      legacyMismatch.push(`${s.id}: carryFromPrev=true 但上一镜 ${prev.id}(${prev.angleKey}) ≠ carryFromShotId ${s.carryFromShotId ?? 'null'}`)
  })
  return { crossEpisode, legacyMismatch, longGap }
}

/** split + angle keys (the opt-in pass used by postProcess / repack). */
export function applyCrossCutSplit(exp: VideoPipelineExport): { exp: VideoPipelineExport; splits: SplitInfo[] } {
  const r = splitCrossCutShots(exp)
  return { exp: assignAngleKeys(r.exp), splits: r.splits }
}
