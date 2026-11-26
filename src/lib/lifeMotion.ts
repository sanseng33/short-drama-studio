/**
 * Closed-lips shots still need living micro-motion. Shared cue / constraint text, no show data.
 *
 * The hard constraint has to sit in the 「限制：」 sentence. Words in action / the timeline,
 * or this sentence tacked on after the picture, do not count: the video model treats 限制 as
 * the negative channel and ignores micro-motion that only appears on the action axis.
 * `hasLifeMotionCue` is a detector only — it must not be used to skip writing 限制.
 */

/** Written into 「限制：」 when a shot already asks for closed lips, or is inner/offscreen. */
export const LIFE_MOTION_CONSTRAINT =
  '闭唇同时须有生命感微动：呼吸、眨眼、肩线、重心或手指仍在动，禁止整段静止'

/** Offscreen / VO listen cue: keep lips closed, never freeze the body. Timeline wording, not a substitute for 限制. */
export const OFFSCREEN_LISTEN_CUE =
  '画外有人说话，画面人物嘴唇闭合不说话，同时保持呼吸、眨眼、肩线或重心等生命感微动，禁止整段静止'

const LIFE_WORDS = /呼吸|眨眼|肩线|重心|手指|微动|眼神/

/** True when text already mentions life motion anywhere (action, timeline, or 限制). Not a 限制-channel check. */
export function hasLifeMotionCue(text: string): boolean {
  return Boolean(text) && (text.includes(LIFE_MOTION_CONSTRAINT) || text.includes(OFFSCREEN_LISTEN_CUE) || LIFE_WORDS.test(text))
}

export function mentionsClosedLips(text: string): boolean {
  return /嘴唇闭合/.test(text || '')
}

/** The 「限制：」 sentence, or '' when the prompt has none. */
export function limitClause(prompt: string): string {
  const m = (prompt || '').match(/限制\s*[：:][^。\n]*/)
  return m ? m[0] : ''
}

/** Picture / action text with 「限制：」 sentences removed, so a constraint cannot re-trigger itself. */
export function pictureBody(text: string): string {
  return (text || '').replace(/限制\s*[：:][^。\n]*/g, '')
}

/** True when this exact clause is already inside 「限制：」 (a copy on the action axis does not count). */
export function limitHas(prompt: string, clause: string): boolean {
  const c = (clause || '').trim()
  return Boolean(c) && limitClause(prompt).includes(c)
}

/**
 * Insert one clause into the 「限制：」 sentence (create the sentence at the end if missing).
 * Skips only when that sentence already contains the clause.
 */
export function appendLimitClause(prompt: string, clause: string): string {
  const c = (clause || '').trim()
  if (!c) return prompt || ''
  if (limitHas(prompt, c)) return prompt || ''
  const m = (prompt || '').match(/限制\s*[：:][^。\n]*/)
  if (m && m.index != null) {
    const end = m.index + m[0].length
    return `${(prompt || '').slice(0, end).replace(/[，、,；;]+$/, '')}，${c}${(prompt || '').slice(end)}`
  }
  const base = prompt || ''
  return `${base}${base && !/[。.]$/.test(base) ? '。' : ''}限制：${c}。`
}

/** Prompt already asks for closed lips (or is inner/offscreen) and should carry the life-motion constraint. */
export function needsLifeMotionConstraint(text: string, voiceMode?: string | null): boolean {
  const mode = String(voiceMode || '').trim().toLowerCase()
  if (mode === 'inner' || mode === 'offscreen') return true
  return mentionsClosedLips(text)
}

/** Put the closed-lips life-motion sentence into 「限制：」, even if the timeline already says 呼吸/眨眼. */
export function ensureLifeMotionConstraint(prompt: string, voiceMode?: string | null): string {
  const p = prompt || ''
  if (!needsLifeMotionConstraint(p, voiceMode)) return p
  return appendLimitClause(p, LIFE_MOTION_CONSTRAINT)
}
