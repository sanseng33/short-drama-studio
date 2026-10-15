/** 导出给视频流水线：pure builder for short-drama-studio/video-pipeline@1 (additive fields only). */
import type { Character, Project, Shot } from '../types'
import { mapNamesToIds, shotCharacterIds } from './shotCast'
import { cleanField, cleanPrompt } from './placeholder'

export const VIDEO_PIPELINE_SCHEMA = 'short-drama-studio/video-pipeline@1'
/** Dialogue pacing: Chinese chars (CJK + alnum) per second */
export const CHARS_PER_SEC = 4.5
export const MIN_SEG_SEC = 2

export interface VideoPipelineShot {
  episode: number
  shotNo: number
  id: string
  /** onscreen characters only */
  characterIds: string[]
  prompt: string
  visual: string
  action: string
  durationSec: number
  /** '' when none; speaker prefix stripped */
  dialogue: string
  /** character id; null = narration / no dialogue */
  speaker: string | null
  /** display name for subtitles (baseName || name), null when speaker null */
  speakerName: string | null
  /** speakers heard but not onscreen (OS / 画外音 / 电话里 / not in characterIds) */
  voiceOnly: string[]
  sfx: string[]
  /** system UI / on-screen text — render in post, never by the video model */
  overlayText: string[]
  camera: string
  size: string
  emotion: string
  refImage: string | null
  /** present only when an original shot became several segments */
  segment?: { index: number; total: number; parentId: string }
}

export interface VideoPipelineWarning {
  episode: number
  shotId?: string
  characterId?: string
  code: 'dialogue_too_long' | 'segment_duration' | 'speaker_unresolved' | 'character_missing_costume' | 'character_missing_prop'
  message: string
}

export interface VideoPipelineOptions {
  /** max seconds per segment (default 10) */
  maxShotSec?: number
}

export interface VideoPipelineExport {
  schema: typeof VIDEO_PIPELINE_SCHEMA
  project: { id: string; title: string; style: string; platform: string; secondsPerEp: number }
  characters: {
    id: string
    name: string
    baseName?: string
    role: string
    tags: string[]
    visualLock: string
    costume: string
    signatureProp: string
  }[]
  shots: VideoPipelineShot[]
  warnings: VideoPipelineWarning[]
}

// ---------------- text helpers (exported for tests / reuse) ----------------

/** Count paced chars: CJK + latin alnum; punctuation / whitespace ignored. */
export function pacedChars(text: string): number {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
}
/** Seconds needed to speak text at CHARS_PER_SEC */
export function dialogueSec(text: string): number {
  return pacedChars(text) / CHARS_PER_SEC
}

const NONE_RE = /^[\s「」“”"']*(无台词|无对白|无|——|—|-|——无|none|n\/a)?[\s「」“”"'。.]*$/i
export function isNoDialogue(s: string | undefined | null): boolean {
  return !s || NONE_RE.test(s.trim())
}

/** Extract sfx markers; returns cleaned text + sfx list. */
export function extractSfx(text: string): { text: string; sfx: string[] } {
  const sfx: string[] = []
  const push = (v: string) => {
    const t = v.trim().replace(/^[：:\s]+|[，。；;、\s]+$/g, '')
    if (t && !sfx.includes(t)) sfx.push(t)
    return ''
  }
  let t = text || ''
  t = t.replace(/【\s*(?:音效|SFX)\s*[：:]\s*([^】]+)】/gi, (_m, v) => push(v))
  t = t.replace(/【\s*(?:音效|SFX)\s*】\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/[（(]\s*SFX\s*[）)]\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/(?:音效|SFX)\s*[：:]\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/[，、；;]{2,}/g, '，').replace(/^[，、；;\s]+|[，、；;\s]+$/g, '')
  return { text: t, sfx }
}

const UI_RE = /(系统视窗|系统提示|系统面板|系统界面|系统弹窗|界面|转盘|弹窗|屏幕文字|提示框|悬浮窗|全息屏|光幕|面板文字)/
export const INDIRECT_UI_CUE = '蓝光映在角色脸上，神情专注'

/** Pull UI/on-screen text descriptions out of a free-text field. */
export function extractOverlay(text: string): string[] {
  const out: string[] = []
  for (const m of (text || '').matchAll(/『([^』]+)』/g)) out.push(m[1].trim())
  for (const clause of (text || '').split(/[，。；;！!？?\n]/)) {
    const c = clause.replace(/『[^』]*』/g, (m) => m).trim()
    if (c && UI_RE.test(c) && !out.includes(c)) out.push(c)
  }
  return out.filter(Boolean)
}

/** Replace explicit UI rendering descriptions in a prompt with one indirect light/expression cue. */
export function indirectUiCue(prompt: string, cue = INDIRECT_UI_CUE): string {
  let used = false
  const hadQuote = /『[^』]*』/.test(prompt || '')
  const stripped = (prompt || '').replace(/[，,]?\s*(?:显示|写着|浮现|出现)?\s*『[^』]*』/g, '')
  const parts = (hadQuote && !UI_RE.test(stripped) ? `${INDIRECT_UI_CUE}，${stripped}` : stripped).split(/([，。；;\n])/)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i]
    const sep = parts[i + 1] ?? ''
    if (UI_RE.test(clause) && !clause.includes(cue) && !/^(限制|风格)[：:]/.test(clause.trim())) {
      // keep a field label like 主体： / 画面：
      const label = clause.match(/^\s*([^：:]{1,6}[：:])/)?.[1] ?? ''
      if (!used) {
        out.push(label + cue + sep)
        used = true
      } else if (label) out.push(label + sep)
      continue
    }
    out.push(clause + sep)
  }
  return out.join('').replace(/[，、]{2,}/g, '，').replace(/，。/g, '。')
}

const ACTION_SPLIT = /\s*[，,。；;]?\s*(?:紧接着|随后|然后|接着|同时)\s*[，,]?\s*/
export function splitActions(action: string): string[] {
  const parts = (action || '').split(ACTION_SPLIT).map((s) => s.replace(/^[，,。；;\s]+|[，,；;\s]+$/g, '')).filter(Boolean)
  return parts.length ? parts : [action || '']
}

const VOICE_TAG = /^(OS|O\.S\.?|画外音|画外|V\.?O\.?|电话里|电话|内心|心声|广播)$/i
const NARRATOR = /^(旁白|画外音|解说|narrator)$/i
const SYSTEM = /^(系统|系统音|系统提示|系统声音)$/

export interface DialogueLine {
  name: string | null
  tag: string | null
  text: string
}
/** Split dialogue into lines and parse `名字：` / `名字（情绪）：` / `名字(OS)：` prefixes. */
export function parseDialogue(dialogue: string): DialogueLine[] {
  if (isNoDialogue(dialogue)) return []
  const PREFIX = '[^\\s：:（()）「」“”，。！？!?、]{1,12}(?:\\s*[（(][^）)]{0,12}[）)])?\\s*[：:]'
  const broken = dialogue.replace(new RegExp(`([」”。！？!?…~])\\s*(?=${PREFIX})`, 'g'), '$1\n')
  const lines: DialogueLine[] = []
  for (const raw of broken.split(/\n+/)) {
    const l = raw.trim()
    if (!l || isNoDialogue(l)) continue
    const m = l.match(/^([^\s：:（()）「」“”，。！？!?、]{1,12})\s*(?:[（(]([^）)]{0,12})[）)])?\s*[：:]\s*([\s\S]*)$/)
    const unq = (s: string) => s.trim().replace(/^[「“"]([\s\S]*)[」”"]$/, '$1').trim()
    if (m) {
      const text = unq(m[3])
      if (!isNoDialogue(text)) lines.push({ name: m[1], tag: m[2]?.trim() || null, text })
    } else lines.push({ name: null, tag: null, text: unq(l) })
  }
  return lines
}

/** Split long text at sentence punctuation into chunks of ≤2 sentences and ≤maxSec speech each. */
export function splitDialogueChunks(text: string, maxSec: number): string[] {
  const sentences = text.split(/(?<=[。！？!?；;…~])/).map((s) => s.trim()).filter(Boolean)
  const atoms: string[] = []
  for (const s of sentences) {
    if (dialogueSec(s) <= maxSec) {
      atoms.push(s)
      continue
    }
    let cur = ''
    for (const c of s.split(/(?<=[，,、])/)) {
      if (cur && dialogueSec(cur + c) > maxSec) {
        atoms.push(cur)
        cur = ''
      }
      cur += c
    }
    // hard cut if a comma-free run is still too long
    while (dialogueSec(cur) > maxSec) {
      const arr = Array.from(cur)
      let n = 0
      let k = 0
      while (k < arr.length && n < Math.floor(maxSec * CHARS_PER_SEC)) {
        if (pacedChars(arr[k])) n++
        k++
      }
      atoms.push(arr.slice(0, k).join(''))
      cur = arr.slice(k).join('')
    }
    if (cur) atoms.push(cur)
  }
  const chunks: string[] = []
  let cur: string[] = []
  for (const a of atoms) {
    if (cur.length && (cur.length >= 2 || dialogueSec(cur.join('') + a) > maxSec)) {
      chunks.push(cur.join(''))
      cur = []
    }
    cur.push(a)
  }
  if (cur.length) chunks.push(cur.join(''))
  return chunks.length ? chunks : [text]
}

// ---------------- speaker resolution ----------------

function displayName(c: Character): string {
  return c.baseName?.trim() || c.name
}

/** Resolve a prefix name to a character id; matches name, `名字（变体）` and baseName (picks onscreen / current variant). */
export function resolveSpeaker(
  name: string,
  tag: string | null,
  chars: Character[],
  prefer: string[] = [],
  current: Map<string, string> = new Map(),
): string | undefined {
  const full = tag ? [`${name}（${tag}）`, `${name}(${tag})`] : []
  for (const f of full) {
    const hit = chars.find((c) => c.name === f)
    if (hit) return hit.id
  }
  const exact = chars.find((c) => c.name === name)
  if (exact) return exact.id
  const variants = chars.filter(
    (c) => c.baseName?.trim() === name || (c.name.startsWith(name) && /^[（(]/.test(c.name.slice(name.length))),
  )
  if (variants.length) {
    return (
      variants.find((v) => prefer.includes(v.id))?.id ||
      variants.find((v) => current.get(name) === v.id)?.id ||
      variants[0].id
    )
  }
  return chars.find((c) => c.name && (name.includes(c.name) || c.name.includes(name)))?.id
}

// ---------------- segment model ----------------

interface Seg {
  ep: number
  shot: Shot
  parentId: string
  action: string
  actionSplit: boolean
  dialogue: string
  speaker: string | null
  narration: boolean
  onscreen: string[]
  voice: string[]
  sfx: string[]
  overlay: string[]
  /** 0.1s units */
  u: number
  need: number
}

const uniq = <T,>(a: T[]) => [...new Set(a)]
const needUnits = (s: Seg) => Math.ceil((dialogueSec(s.dialogue) * 10) - 1e-9)
const lower = (s: Seg, max: number) => Math.max(MIN_SEG_SEC * 10, Math.min(s.need, max))

/** Move time inside an episode so every seg is within [lower, max]; prefers dialogue-free nearest donors. */
function allocate(segs: Seg[], max: number) {
  for (let i = 0; i < segs.length; i++) {
    let def = lower(segs[i], max) - segs[i].u
    if (def <= 0) continue
    const order = segs.map((_, j) => j).filter((j) => j !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))
    for (const pass of [0, 1]) {
      for (const j of order) {
        if (def <= 0) break
        const d = segs[j]
        if (pass === 0 && d.dialogue) continue
        const slack = d.u - lower(d, max)
        if (slack <= 0) continue
        const t = Math.min(slack, def)
        d.u -= t
        segs[i].u += t
        def -= t
      }
    }
  }
  for (let i = 0; i < segs.length; i++) {
    let sur = segs[i].u - max
    if (sur <= 0) continue
    const order = segs.map((_, j) => j).filter((j) => j !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))
    for (const j of order) {
      if (sur <= 0) break
      const room = max - segs[j].u
      if (room <= 0) continue
      const t = Math.min(room, sur)
      segs[j].u += t
      segs[i].u -= t
      sur -= t
    }
  }
}

/** Split units of one total into n parts proportional to weights (each ≥1). */
function splitUnits(total: number, weights: number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0) || weights.length
  const out = weights.map((w) => Math.max(1, Math.floor((total * (w || 1)) / W)))
  let diff = total - out.reduce((a, b) => a + b, 0)
  for (let i = 0; diff !== 0; i = (i + 1) % out.length) {
    if (diff > 0) {
      out[i]++
      diff--
    } else if (out[i] > 1) {
      out[i]--
      diff++
    } else if (out.every((x) => x <= 1)) break
  }
  return out
}

function buildShotSegs(
  ep: number,
  s: Shot,
  chars: Character[],
  current: Map<string, string>,
): Seg[] {
  const onscreen0 = shotCharacterIds(s, chars)
  const shotVoice = mapNamesToIds(s.voiceOnly, chars)
  const actionX = extractSfx(cleanField(s.action))
  const actions = splitActions(actionX.text)
  const overlay: string[] = [...(s.overlayText || []).map((x) => x.trim()).filter(Boolean)]
  for (const o of [...extractOverlay(cleanField(s.visual)), ...extractOverlay(s.seedancePrompt || '')]) if (!overlay.includes(o)) overlay.push(o)
  const shotSfx = uniq([...(s.sfx || []).map((x) => x.trim()).filter(Boolean), ...actionX.sfx])

  // dialogue → groups of consecutive lines with the same speaker
  type Group = { speaker: string | null; narration: boolean; voice: boolean; lines: string[]; sfx: string[] }
  const groups: Group[] = []
  const dx = extractSfx((s.dialogue || '').replace(/\r/g, ''))
  const dsfx = dx.sfx
  for (const line of parseDialogue(dx.text)) {
    const lx = extractSfx(line.text)
    dsfx.push(...lx.sfx)
    if (!lx.text) continue
    if (line.name && SYSTEM.test(line.name)) {
      overlay.push(lx.text)
      continue
    }
    for (const o of extractOverlay(lx.text)) if (!overlay.includes(o) && /『/.test(lx.text)) overlay.push(o)
    let speaker: string | null = null
    let narration = false
    let voice = false
    if (line.name && NARRATOR.test(line.name) && !line.tag) narration = true
    else if (line.name) {
      speaker = resolveSpeaker(line.name, line.tag, chars, [...onscreen0, ...shotVoice], current) ?? null
      voice = Boolean(line.tag && VOICE_TAG.test(line.tag))
      if (speaker) current.set(displayName(chars.find((c) => c.id === speaker)!), speaker)
    } else {
      const cands = uniq([...onscreen0, ...shotVoice])
      if (cands.length === 1) speaker = cands[0]
    }
    const last = groups[groups.length - 1]
    if (last && last.speaker === speaker && last.narration === narration && last.voice === voice) last.lines.push(lx.text)
    else groups.push({ speaker, narration, voice, lines: [lx.text], sfx: [] })
    groups[groups.length - 1].sfx.push(...lx.sfx)
  }

  const voiceIds = uniq([
    ...shotVoice,
    ...groups.filter((g) => g.speaker && (g.voice || !onscreen0.includes(g.speaker))).map((g) => g.speaker!),
  ])
  const onscreen = onscreen0.filter((id) => !shotVoice.includes(id) && !groups.some((g) => g.speaker === id && g.voice))
  const voice = voiceIds.filter((id) => !onscreen.includes(id))

  const n = Math.max(actions.length, groups.length, 1)
  const segs: Seg[] = []
  for (let i = 0; i < n; i++) {
    const g = groups[i]
    segs.push({
      ep,
      shot: s,
      parentId: s.id,
      action: actions[Math.min(i, actions.length - 1)],
      actionSplit: actions.length > 1,
      dialogue: g ? g.lines.join('\n') : '',
      speaker: g ? g.speaker : null,
      narration: g ? g.narration : false,
      onscreen,
      voice,
      sfx: i === 0 ? uniq([...shotSfx, ...dsfx.filter((x) => !g || !g.sfx.includes(x)), ...(g?.sfx || [])]) : uniq(g?.sfx || []),
      overlay: i === 0 ? uniq(overlay) : [],
      u: 0,
      need: 0,
    })
  }
  for (const sg of segs) sg.need = needUnits(sg)
  const total = Math.round((Number(s.durationSec) || 0) * 10)
  // long shot with too few segments: time-split continuation segments (no dialogue)
  const k = Math.max(segs.length, Math.ceil(total / 100))
  while (segs.length < k) {
    const last = segs[segs.length - 1]
    segs.push({ ...last, dialogue: '', speaker: null, narration: false, sfx: [], overlay: [], need: 0 })
  }
  const us = splitUnits(Math.max(total, 1), segs.map((x) => Math.max(x.need, 20)))
  segs.forEach((x, i) => (x.u = total ? us[i] : 0))
  return segs
}

function partPrompt(base: string, origAction: string, sg: Seg, changedTime: boolean): string {
  let p = extractSfx(base).text
  if (sg.actionSplit) {
    if (origAction && p.includes(origAction)) p = p.split(origAction).join(sg.action)
    else if (/动作[：:][^。]*。/.test(p)) p = p.replace(/动作[：:][^。]*。/, `动作：${sg.action}（单主动作）。`)
    else p = `${p}${p && !/[。.]$/.test(p) ? '。' : ''}动作：${sg.action}。`
  }
  if (changedTime) p = p.replace(/时间轴[：:][^。]*。/g, '')
  return indirectUiCue(p).trim()
}

export function buildVideoPipelineExport(project: Project, opts: VideoPipelineOptions = {}): VideoPipelineExport {
  const maxSec = Math.max(MIN_SEG_SEC, opts.maxShotSec ?? 10)
  const max = Math.round(maxSec * 10)
  const chars = project.characters
  const warnings: VideoPipelineWarning[] = []
  const eps = Object.keys(project.storyboards || {})
    .map(Number)
    .filter((n) => project.storyboards[n]?.length)
    .sort((a, b) => a - b)
  const shots: VideoPipelineShot[] = []
  for (const ep of eps) {
    const list = [...project.storyboards[ep]].sort((a, b) => a.shotNo - b.shotNo)
    const current = new Map<string, string>()
    let segs: Seg[] = list.flatMap((s) => buildShotSegs(ep, s, chars, current))
    const T = segs.reduce((a, b) => a + b.u, 0)
    allocate(segs, max)
    // still too long and > max: split dialogue at sentence punctuation into new segments
    segs = segs.flatMap((sg) => {
      if (sg.need <= sg.u || sg.need <= max) return [sg]
      const chunks = splitDialogueChunks(sg.dialogue, maxSec)
      if (chunks.length < 2) return [sg]
      const us = splitUnits(sg.u, chunks.map((c) => Math.max(1, dialogueSec(c))))
      return chunks.map((c, i) => {
        const x: Seg = { ...sg, dialogue: c, u: us[i], sfx: i ? [] : sg.sfx, overlay: i ? [] : sg.overlay }
        x.need = needUnits(x)
        return x
      })
    })
    // too many segments for min 2s: merge dialogue-free neighbours of the same parent, then any dialogue-free pair
    const sumL = () => segs.reduce((a, s) => a + lower(s, max), 0)
    while (sumL() > T && segs.length > 1) {
      let best = -1
      for (const sameParent of [true, false]) {
        for (let i = 0; i + 1 < segs.length && best < 0; i++) {
          const a = segs[i]
          const b = segs[i + 1]
          if (sameParent && a.parentId !== b.parentId) continue
          if (a.dialogue && b.dialogue) continue
          best = i
        }
        if (best >= 0) break
      }
      if (best < 0) break
      const a = segs[best]
      const b = segs[best + 1]
      const keep = a.dialogue ? a : b.dialogue ? b : a
      const m: Seg = {
        ...keep,
        action: a.parentId === b.parentId && a.action === b.action ? a.action : uniq([a.action, b.action]).filter(Boolean).join('，'),
        actionSplit: a.actionSplit || b.actionSplit || a.parentId !== b.parentId,
        onscreen: uniq([...a.onscreen, ...b.onscreen]),
        voice: uniq([...a.voice, ...b.voice]),
        sfx: uniq([...a.sfx, ...b.sfx]),
        overlay: uniq([...a.overlay, ...b.overlay]),
        u: a.u + b.u,
      }
      segs.splice(best, 2, m)
    }
    allocate(segs, max)

    // number + emit
    const byParent = new Map<string, Seg[]>()
    for (const sg of segs) byParent.set(sg.parentId, [...(byParent.get(sg.parentId) || []), sg])
    for (const sg of segs) {
      const s = sg.shot
      const group = byParent.get(sg.parentId)!
      const idx = group.indexOf(sg)
      const multi = group.length > 1
      const basePrompt =
        cleanPrompt(s.seedancePrompt?.trim() || '') || [cleanField(s.visual), cleanField(s.action)].filter(Boolean).join('，')
      const durationSec = sg.u / 10
      const sp = sg.speaker ? chars.find((c) => c.id === sg.speaker) : undefined
      const id = multi ? `${s.id}-${String.fromCharCode(97 + idx)}` : s.id
      shots.push({
        episode: ep,
        shotNo: s.shotNo,
        id,
        characterIds: [...sg.onscreen],
        prompt: partPrompt(basePrompt, extractSfx(cleanField(s.action)).text, sg, durationSec !== Number(s.durationSec)),
        visual: cleanField(s.visual),
        action: sg.action,
        durationSec,
        dialogue: sg.dialogue,
        speaker: sg.dialogue ? sg.speaker : null,
        speakerName: sg.dialogue && sp ? displayName(sp) : null,
        voiceOnly: [...sg.voice],
        sfx: [...sg.sfx],
        overlayText: [...sg.overlay],
        camera: s.camera,
        size: s.size,
        emotion: s.emotion || '',
        refImage: s.refImage || null,
        ...(multi ? { segment: { index: idx, total: group.length, parentId: s.id } } : {}),
      })
      if (sg.dialogue && sg.need > sg.u)
        warnings.push({
          episode: ep,
          shotId: id,
          code: 'dialogue_too_long',
          message: `台词需 ${(sg.need / 10).toFixed(1)}s（${pacedChars(sg.dialogue)}字 @${CHARS_PER_SEC}字/秒），仅分配到 ${durationSec}s，无法在本集内借到时长`,
        })
      if (sg.u < MIN_SEG_SEC * 10 || sg.u > max)
        warnings.push({ episode: ep, shotId: id, code: 'segment_duration', message: `段时长 ${durationSec}s 超出 ${MIN_SEG_SEC}–${maxSec}s` })
      if (sg.dialogue && !sg.speaker && !sg.narration)
        warnings.push({ episode: ep, shotId: id, code: 'speaker_unresolved', message: `台词无法确定说话人：${sg.dialogue.slice(0, 20)}` })
    }
  }
  for (const c of chars) {
    if (!cleanField(c.costume))
      warnings.push({ episode: 0, characterId: c.id, code: 'character_missing_costume', message: `角色「${c.name}」缺少服装 costume` })
    if (!cleanField(c.signatureProp))
      warnings.push({ episode: 0, characterId: c.id, code: 'character_missing_prop', message: `角色「${c.name}」缺少标志道具 signatureProp` })
  }
  return {
    schema: VIDEO_PIPELINE_SCHEMA,
    project: {
      id: project.id,
      title: project.title,
      style: project.style,
      platform: project.platform,
      secondsPerEp: project.secondsPerEp,
    },
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.baseName?.trim() ? { baseName: c.baseName.trim() } : {}),
      role: c.role,
      tags: c.tags || [],
      visualLock: cleanField(c.visualLock),
      costume: cleanField(c.costume),
      signatureProp: cleanField(c.signatureProp),
    })),
    shots,
    warnings,
  }
}

export function videoPipelineFilename(project: Project): string {
  return `${project.title || 'project'}-video-pipeline.json`
}
