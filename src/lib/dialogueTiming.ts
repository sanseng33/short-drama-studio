/**
 * Spoken-duration estimate of a dialogue line vs the time the shot gives it (warning only).
 * estimate = spoken chars / charsPerSec + pauses (…… / —— long, ，、 short, 。？！ sentence end).
 * Defaults calibrated on a TTS run: 10 chars + …… + 。 ≈ 3.4 s.
 */
import type { VideoPipelineShot } from './videoExport'

export interface SpeechRate {
  charsPerSec: number
  longPauseSec: number
  shortPauseSec: number
  stopPauseSec: number
}
export const DEFAULT_SPEECH_RATE: SpeechRate = { charsPerSec: 4, longPauseSec: 0.6, shortPauseSec: 0.25, stopPauseSec: 0.3 }
export const SHOT_TARGET_SEC = { min: 5, max: 9 }
/** silence the dialogue segment keeps before / after the spoken line */
export interface DialoguePad {
  headSec: number
  tailSec: number
}
export const DEFAULT_DIALOGUE_PAD: DialoguePad = { headSec: 0.3, tailSec: 0.4 }

export function speechSec(text: string, r: Partial<SpeechRate> = {}): number {
  const o = { ...DEFAULT_SPEECH_RATE, ...r }
  const t = text || ''
  const chars = (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
  const long = (t.match(/…+|—+|\.{3,}/g) || []).length
  const short = (t.match(/[，,、；;：:]/g) || []).length
  const stop = (t.match(/[。！？!?]+/g) || []).length
  return chars / o.charsPerSec + long * o.longPauseSec + short * o.shortPauseSec + stop * o.stopPauseSec
}

/** time a shot's dialogue segment needs: Σ estimated speech of its lines + head / tail pad (0 without lines) */
export function dialogueNeedSec(texts: string[], r: Partial<SpeechRate> = {}, pad: Partial<DialoguePad> = {}): number {
  const t = texts.filter((x) => x && x.trim())
  if (!t.length) return 0
  const p = { ...DEFAULT_DIALOGUE_PAD, ...pad }
  return t.reduce((a, x) => a + speechSec(x, r), 0) + p.headSec + p.tailSec
}

/** per dialogue segment (lines go to the dialogue segments in order, the rest to the last — as timedDialogueLines):
 *  Σ estimated speech of its lines + head / tail pad; 0 for a segment without a line */
export function dialogueSegmentNeeds(texts: string[], segments: number, r: Partial<SpeechRate> = {}, pad: Partial<DialoguePad> = {}): number[] {
  const t = texts.filter((x) => x && x.trim())
  const by: string[][] = Array.from({ length: Math.max(0, segments) }, () => [])
  t.forEach((x, i) => by.length && by[Math.min(i, by.length - 1)].push(x))
  return by.map((g) => dialogueNeedSec(g, r, pad))
}

export interface DialogueOverrun {
  id: string
  episode: number
  text: string
  speaker: string | null
  startSec: number
  endSec: number
  /** time the line has: endSec − startSec */
  availableSec: number
  estimatedSec: number
  overrunSec: number
  durationSec: number
  remedy: string
}
const r2 = (n: number) => Math.round(n * 100) / 100

/** every dialogue line whose estimated speech is longer than its slot (endSec − startSec) */
export function dialogueOverruns(shots: VideoPipelineShot[], rate: Partial<SpeechRate> = {}): DialogueOverrun[] {
  const out: DialogueOverrun[] = []
  for (const s of shots)
    for (const l of s.dialogueLines || []) {
      if (l.startSec == null || l.endSec == null) continue
      const est = speechSec(l.text, rate)
      const avail = l.endSec - l.startSec
      const over = est - avail
      if (over <= 1e-9) continue
      const ext = Math.ceil((s.durationSec + over) * 2) / 2
      // at the cap (beat mode already lengthened what it could): split / shorten, never longer
      const remedy = ext <= SHOT_TARGET_SEC.max && s.durationSec < SHOT_TARGET_SEC.max - 1e-9
        ? `延长镜头至 ${ext} 秒（${ext >= SHOT_TARGET_SEC.min ? `${SHOT_TARGET_SEC.min}–${SHOT_TARGET_SEC.max} 秒目标内` : `仍短于 ${SHOT_TARGET_SEC.min} 秒目标，可延长至 ${SHOT_TARGET_SEC.min} 秒`}），台词段加长 ${r2(over)} 秒`
        : `已达 ${SHOT_TARGET_SEC.max} 秒上限：拆分镜头或缩短台词（split shot or shorten line）`
      out.push({ id: s.id, episode: s.episode, text: l.text, speaker: l.speaker, startSec: l.startSec, endSec: l.endSec, availableSec: r2(avail), estimatedSec: r2(est), overrunSec: r2(over), durationSec: s.durationSec, remedy })
    }
  return out
}
