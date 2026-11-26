/**
 * Closed-lips shots still need living micro-motion. Shared cue / constraint text, no show data.
 */

/** Appended when a shot already asks for closed lips, or is inner/offscreen. */
export const LIFE_MOTION_CONSTRAINT =
  '闭唇同时须有生命感微动：呼吸、眨眼、肩线、重心或手指仍在动，禁止整段静止'

/** Offscreen / VO listen cue: keep lips closed, never freeze the body. */
export const OFFSCREEN_LISTEN_CUE =
  '画外有人说话，画面人物嘴唇闭合不说话，同时保持呼吸、眨眼、肩线或重心等生命感微动，禁止整段静止'

const LIFE_WORDS = /呼吸|眨眼|肩线|重心|手指|微动|眼神/

export function hasLifeMotionCue(text: string): boolean {
  return Boolean(text) && (text.includes(LIFE_MOTION_CONSTRAINT) || text.includes(OFFSCREEN_LISTEN_CUE) || LIFE_WORDS.test(text))
}

export function mentionsClosedLips(text: string): boolean {
  return /嘴唇闭合/.test(text || '')
}

/** Prompt already asks for closed lips (or is inner/offscreen) and should carry the life-motion constraint. */
export function needsLifeMotionConstraint(text: string, voiceMode?: string | null): boolean {
  const mode = String(voiceMode || '').trim().toLowerCase()
  if (mode === 'inner' || mode === 'offscreen') return true
  return mentionsClosedLips(text)
}

export function ensureLifeMotionConstraint(prompt: string, voiceMode?: string | null): string {
  const p = prompt || ''
  if (!needsLifeMotionConstraint(p, voiceMode)) return p
  if (p.includes(LIFE_MOTION_CONSTRAINT) || p.includes(OFFSCREEN_LISTEN_CUE)) return p
  const trimmed = p.replace(/[。\s]*$/, '')
  return `${trimmed}。${LIFE_MOTION_CONSTRAINT}`
}
