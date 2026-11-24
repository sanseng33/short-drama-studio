/** 剧本台词解析（PK-03）。确定性本地算法，不写回任何对白字段。 */
import type { Character, ScriptBeat } from '../types'
import { normalizeDialogueKey, normalizeSpeaker } from './consistency/dialogueNormalize'
import { parseDialogue } from './videoExport'

export type DialogueCategory = 'narration' | 'os' | 'inner' | 'spoken'

export interface ParsedDialogueLine {
  speaker: string | null
  speakerNorm: string
  tag: string | null
  category: DialogueCategory
  text: string
  key: string
  raw: string
  occurrence: number
  episode?: number
  shotId?: string
  shotNo?: number
}

export interface ParseScriptResult {
  lines: ParsedDialogueLine[]
  unparseable: { raw: string; evidence: string }[]
}

const RESERVED_LABELS = new Set(['时间', '地点', '场景', '备注', '注', '字幕', '镜头', '音效', 'BGM', '特效', '画面', '动作'])
const BAD_SPEAKER_PUNCT = /[，。！？、]/
const MULTI_SPEAKER = /[、&]|和|与/

export function n1Line(text: string): string {
  return (text ?? '').normalize('NFKC').replace(/\u3000/g, ' ').replace(/：/g, ':').trim()
}

export function dialogueCategory(speaker: string | null, tag: string | null): DialogueCategory {
  const blob = `${speaker || ''} ${tag || ''}`
  if (/旁白|解说|叙述/.test(blob)) return 'narration'
  if (/(?:^|[^A-Za-z])OS(?:$|[^A-Za-z])|ＯＳ|画外音|画外/.test(blob)) return 'os'
  if (/内心|心声|心想/.test(blob)) return 'inner'
  return 'spoken'
}

function splitSpeakers(speaker: string): string[] {
  const parts = speaker.split(MULTI_SPEAKER).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : [speaker]
}

function speakerOk(speaker: string): boolean {
  const core = normalizeSpeaker(speaker)
  if (!core) return false
  if ([...core].length > 8) return false
  if (BAD_SPEAKER_PUNCT.test(core) || BAD_SPEAKER_PUNCT.test(speaker)) return false
  return true
}

export function parseScriptLine(rawLine: string): { kind: 'skip' | 'title' | 'line' | 'unparseable'; lines?: Omit<ParsedDialogueLine, 'occurrence'>[]; evidence?: string } {
  const raw = rawLine.trim()
  if (!raw) return { kind: 'skip' }
  const n1 = n1Line(raw)
  if (!n1) return { kind: 'skip' }
  if (/^场\s*\d/.test(n1)) return { kind: 'title' }
  if (/^△/.test(n1) || /^[（(][^：:]*[）)]$/.test(n1)) return { kind: 'skip' }

  const colon = n1.indexOf(':')
  if (colon <= 0) return { kind: 'skip' }

  const left = n1.slice(0, colon).trim()
  const right = n1.slice(colon + 1)
  const tagMatch = left.match(/^(.*?)(?:\s*[（(]([^）)]{0,12})[）)])\s*$/)
  const speakerRaw = (tagMatch ? tagMatch[1] : left).trim()
  const tag = tagMatch ? (tagMatch[2] || '').trim() || null : null
  const label = normalizeSpeaker(speakerRaw) || speakerRaw

  if (RESERVED_LABELS.has(label) || RESERVED_LABELS.has(speakerRaw)) return { kind: 'skip' }

  // P7 先按顿号/和/与/& 拆开，再对每个人做 P2 校验（避免「小李、小王」被当作含顿号的非法说话人）
  const speakers = splitSpeakers(speakerRaw)
  if (speakers.some((sp) => !speakerOk(sp))) {
    return { kind: 'unparseable', evidence: 'P6 说话人过长或含标点' }
  }

  const unq = (s: string) => s.trim().replace(/^[「“"『‘]([\s\S]*)[」”"』’]$/, '$1').trim()
  const text = unq(right)
  const lines: Omit<ParsedDialogueLine, 'occurrence'>[] = []
  for (const sp of speakers) {
    const key = normalizeDialogueKey(text)
    lines.push({
      speaker: sp,
      speakerNorm: normalizeSpeaker(sp),
      tag,
      category: dialogueCategory(sp, tag),
      text,
      key,
      raw,
      shotId: undefined,
      shotNo: undefined,
    })
  }
  return { kind: 'line', lines }
}

function assignOccurrences(lines: Omit<ParsedDialogueLine, 'occurrence'>[]): ParsedDialogueLine[] {
  const counts = new Map<string, number>()
  return lines.map((l) => {
    const k = `${l.speakerNorm || ''}||${l.key}`
    const n = (counts.get(k) || 0) + 1
    counts.set(k, n)
    return { ...l, occurrence: n }
  })
}

export function parseScriptDialogue(
  script: { fullText?: string; beats?: ScriptBeat[]; episode?: number } | string | null | undefined,
): ParseScriptResult {
  const fullText = typeof script === 'string' ? script : script?.fullText
  const beats = typeof script === 'string' ? undefined : script?.beats
  const episode = typeof script === 'string' ? undefined : script?.episode
  const unparseable: { raw: string; evidence: string }[] = []

  const parseBlock = (text: string | undefined): Omit<ParsedDialogueLine, 'occurrence'>[] => {
    if (!text) return []
    const out: Omit<ParsedDialogueLine, 'occurrence'>[] = []
    for (const rawLine of text.split(/\r?\n/)) {
      const r = parseScriptLine(rawLine)
      if (r.kind === 'unparseable') {
        unparseable.push({ raw: rawLine.trim(), evidence: r.evidence || 'P6' })
        continue
      }
      if (r.kind === 'line' && r.lines) {
        for (const line of r.lines) {
          if (!line.key) {
            unparseable.push({ raw: rawLine.trim(), evidence: 'N6 比较键为空' })
            continue
          }
          out.push({ ...line, episode })
        }
      }
    }
    return out
  }

  const fromText = parseBlock(fullText)
  const fromBeats: Omit<ParsedDialogueLine, 'occurrence'>[] = []
  if (Array.isArray(beats)) {
    for (const b of beats) {
      if (typeof b?.dialogue === 'string' && b.dialogue.trim()) {
        fromBeats.push(...parseBlock(b.dialogue))
      }
    }
  }

  let chosen: Omit<ParsedDialogueLine, 'occurrence'>[]
  if (fromText.length >= 1) {
    const bag = new Map<string, number>()
    const bagKey = (l: Omit<ParsedDialogueLine, 'occurrence'>) => `${l.speakerNorm}||${l.key}`
    for (const l of fromText) bag.set(bagKey(l), (bag.get(bagKey(l)) || 0) + 1)
    chosen = [...fromText]
    for (const l of fromBeats) {
      const k = bagKey(l)
      const n = bag.get(k) || 0
      if (n > 0) bag.set(k, n - 1)
      else chosen.push(l)
    }
  } else {
    chosen = fromBeats
  }

  return { lines: assignOccurrences(chosen), unparseable }
}

export function parseShotDialogueLines(
  shots: unknown,
  characters: Character[] | undefined,
): { lines: ParsedDialogueLine[]; unparseable: { shotId?: string; evidence: string }[] } {
  const unparseable: { shotId?: string; evidence: string }[] = []
  if (!Array.isArray(shots)) return { lines: [], unparseable }
  const chars = Array.isArray(characters) ? characters : []
  const rawLines: Omit<ParsedDialogueLine, 'occurrence'>[] = []
  const ordered = shots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const na = typeof (a.s as { shotNo?: number })?.shotNo === 'number' ? (a.s as { shotNo: number }).shotNo : a.i
      const nb = typeof (b.s as { shotNo?: number })?.shotNo === 'number' ? (b.s as { shotNo: number }).shotNo : b.i
      return na - nb
    })
  for (const { s } of ordered) {
    if (!s || typeof s !== 'object') continue
    const shot = s as { id?: string; shotNo?: number; dialogue?: unknown }
    const shotId = typeof shot.id === 'string' ? shot.id : undefined
    const shotNo = typeof shot.shotNo === 'number' ? shot.shotNo : undefined
    if (shot.dialogue == null || shot.dialogue === '') continue
    if (typeof shot.dialogue !== 'string') {
      unparseable.push({ shotId, evidence: '分镜台词为非字符串' })
      continue
    }
    let parsed
    try {
      parsed = parseDialogue(shot.dialogue, chars)
    } catch {
      unparseable.push({ shotId, evidence: '分镜台词解析抛错' })
      continue
    }
    for (const line of parsed) {
      const text = line.text || ''
      const key = normalizeDialogueKey(text)
      if (!key) {
        unparseable.push({ shotId, evidence: 'N6 比较键为空' })
        continue
      }
      rawLines.push({
        speaker: line.name,
        speakerNorm: normalizeSpeaker(line.name),
        tag: line.tag,
        category: dialogueCategory(line.name, line.tag),
        text,
        key,
        raw: shot.dialogue,
        episode: undefined,
        shotId,
        shotNo,
      })
    }
  }
  return { lines: assignOccurrences(rawLines), unparseable }
}
