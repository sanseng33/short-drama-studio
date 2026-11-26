/**
 * Default picture rules for every shot (generate, repair, and export prompt assembly).
 * No show data. Realm parentheticals stay on character / dialogue / state-key metadata;
 * picture prose and the 「限制：」 channel are what the video model actually paints.
 */
import { actionWeight } from './actionDensity'
import {
  LIFE_MOTION_CONSTRAINT,
  appendLimitClause,
  needsLifeMotionConstraint,
  pictureBody,
} from './lifeMotion'

/**
 * Default ban: gold sparks, starbursts, magic particles, glowing particles,
 * colored or red light leaks, decorative spots, and decorative light effects.
 */
export const DECORATIVE_LIGHT_BAN =
  '禁止金色火花、星芒、魔法粒子、发光粒子、彩色或红色光渗漏、装饰性光斑与装饰性光效'

/**
 * Breathing, blinking, shoulder line, and small hand life — a hard 限制 clause,
 * not only an action / timeline description.
 */
export const LIFE_MOTION_HARD_CONSTRAINT =
  '须有呼吸、眨眼，以及肩线与手部的小幅生命感微动，禁止整段静止'

/** Head or body turn, and also 伸手 / 张嘴: smaller amplitude, facial structure and hairline stay stable. */
export const TURN_STABILITY_CONSTRAINT =
  '转头或转身幅度收小，眼睛、鼻子、嘴巴、下颌与发际线保持稳定，禁止面部与头发融化变形'

/** Hidden-face / back-only / over-the-shoulder 限制. The low bun is written 低髻. */
export const HIDDEN_FACE_PARTS = ['面部始终不入画', '只见虚化肩背与低髻', '不露侧颜'] as const

/** Realm label glued to a name. Not a wardrobe variant such as （变帅前） / （之前）. */
const REALM_LABEL = /[（(]\s*(?:梦中|梦里|梦境|回忆中|回忆里|回忆|闪回|现实)\s*[）)]/g

const TURN_ACTION = /转头|回头|扭头|偏头|侧头|转过脸|别过脸|转脸|把头转|头一转|头转向|脸转向|转过身|转身|侧过身|回身|伸手|张嘴|视线越过|目光越过|眼神越过|望向[^，。；\n]{0,10}深处|越过[^，。；\n]{0,8}肩/

/** Explicit hug, or contact only implied (hand leaving a back). Not a prop being held. */
const HUG_COMPOSITION = /拥抱|相拥|搂抱|环抱|拥入|抱住|后背收回|从[^，。\n]{0,12}后背|首帧(?:已是|就是|即为|即)拥抱/

/** Over-the-shoulder framing. Not a generic mention of 肩. */
const OTS_COMPOSITION = /过肩|越肩|从肩后|肩后取景|肩上望/

/** Back-only / hidden face written in picture prose. */
const HIDDEN_FACE_TEXT = /不露正脸|不见正脸|不给正脸|不露脸|背对镜头|背对观众|背影|只露肩背|只见肩背|只露背|只见背|hidden_face|背面朝向/

/** 限制 clauses that still allow a sharp profile. Removed when the strong hidden-face line is required. */
const WEAK_FACE_CLAUSE = /^(?:只|仅)?不露正脸$|可露侧脸|允许侧脸|侧脸可以入画|侧颜可入画|侧脸清晰|清晰侧脸|锐利侧脸|侧颜清晰|侧颜入画|侧脸特写|侧颜特写|侧脸占满/

const SHARP_PROFILE = /(?:锐利|清晰|清楚)的?侧脸|侧脸(?:清晰|锐利|特写)|侧颜(?:清晰|入画|特写)|画边的?(?:清晰|锐利)?侧脸|侧脸占满(?:画边|画面边缘|画框)?|画框边缘的?(?:清晰|锐利)?侧脸/g

const LIFE_AXIS = /呼吸|眨眼|肩线|手指/

export function stripRealmLabels(text: string): string {
  return (text || '').replace(REALM_LABEL, '')
}

export function textHasTurn(text: string): boolean {
  return TURN_ACTION.test(pictureBody(text || ''))
}

export interface CompositionFields {
  visual?: string
  action?: string
  camera?: string
  seedancePrompt?: string
  prompt?: string
  wardrobeState?: unknown
}

/** Picture prose used to detect hug / OTS / hidden-face. 「限制：」 sentences are ignored. */
export function compositionAxis(s: CompositionFields): string {
  return [s.visual, s.action, s.camera, pictureBody(s.seedancePrompt || ''), pictureBody(s.prompt || '')].filter(Boolean).join('\n')
}

function wardrobeHidden(wardrobeState: unknown): boolean {
  if (!wardrobeState || typeof wardrobeState !== 'object') return false
  return Object.values(wardrobeState as Record<string, unknown>).some((v) => {
    const t = String(v ?? '').trim()
    return t === 'hidden_face' || /hidden[_-]?face/i.test(t)
  })
}

export function axisNeedsVerifiedStartFrame(s: CompositionFields): boolean {
  const axis = compositionAxis(s)
  return HUG_COMPOSITION.test(axis) || OTS_COMPOSITION.test(axis)
}

export function axisNeedsHiddenFaceLimit(s: CompositionFields): boolean {
  if (wardrobeHidden(s.wardrobeState)) return true
  const axis = compositionAxis(s)
  return HIDDEN_FACE_TEXT.test(axis) || OTS_COMPOSITION.test(axis)
}

/** Drop sharp-profile invitations outside 「限制：」. Over-the-shoulder wording itself stays. */
export function softenSharpProfile(text: string): string {
  const chunks = (text || '').split(/(限制\s*[：:][^。\n]*)/g)
  return chunks.map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(SHARP_PROFILE, ''))).join('')
}

/** Remove weak face clauses (不露正脸 / 可露侧脸 / 清晰侧脸) from the 「限制：」 sentence. */
export function stripWeakFaceLimit(prompt: string): string {
  return (prompt || '').replace(/限制\s*[：:]([^。\n]*)/g, (_m, body: string) => {
    const kept = body
      .split(/[，,；;]/)
      .map((s) => s.trim())
      .filter((s) => s && !WEAK_FACE_CLAUSE.test(s))
    return kept.length ? `限制：${kept.join('，')}` : ''
  })
}

export interface PictureConstraintOpts {
  /** Someone is in frame (characters / characterIds / on-screen count). */
  hasPerson?: boolean
  voiceMode?: string | null
  /** Shot audio is inner / offscreen even when voiceMode was not copied onto the prompt. */
  offscreen?: boolean
  action?: string
  camera?: string
  wardrobeState?: unknown
  /** Implied gaze already rewritten away; still attach the stability clause. */
  forceStability?: boolean
  /** Extra picture prose (visual, seedance body). 「限制：」 sentences are ignored for turn / life detection. */
  picture?: string
}

export function pictureConstraintClauses(prompt: string, opts: PictureConstraintOpts = {}): string[] {
  const action = opts.action || ''
  const picture = opts.picture || ''
  const camera = opts.camera || ''
  const axis = `${action}\n${pictureBody(picture)}\n${pictureBody(prompt || '')}\n${camera}`
  const fields: CompositionFields = {
    action,
    camera,
    visual: pictureBody(picture),
    prompt: pictureBody(prompt || ''),
    wardrobeState: opts.wardrobeState,
  }
  const closed =
    Boolean(opts.offscreen) || needsLifeMotionConstraint(`${prompt || ''}\n${action}\n${picture}`, opts.voiceMode)
  const out = [DECORATIVE_LIGHT_BAN]
  if (opts.hasPerson || closed || LIFE_AXIS.test(axis)) out.push(LIFE_MOTION_HARD_CONSTRAINT)
  if (closed) out.push(LIFE_MOTION_CONSTRAINT)
  if (opts.forceStability || TURN_ACTION.test(axis)) out.push(TURN_STABILITY_CONSTRAINT)
  if (axisNeedsHiddenFaceLimit(fields)) for (const c of HIDDEN_FACE_PARTS) out.push(c)
  return out
}

/** Strip realm labels from picture text and merge the default clauses into 「限制：」. Idempotent. */
export function applyPictureConstraints(prompt: string, opts: PictureConstraintOpts = {}): string {
  let p = stripRealmLabels(prompt || '')
  const action = stripRealmLabels(opts.action || '')
  const picture = stripRealmLabels(opts.picture || '')
  const camera = opts.camera || ''
  const hidden = axisNeedsHiddenFaceLimit({
    action,
    camera,
    visual: picture,
    prompt: p,
    wardrobeState: opts.wardrobeState,
  })
  if (hidden) {
    p = softenSharpProfile(p)
    p = stripWeakFaceLimit(p)
  }
  for (const c of pictureConstraintClauses(p, { ...opts, action, picture, camera })) p = appendLimitClause(p, c)
  return p
}

export interface GeneratorPictureShot {
  visual?: string
  action?: string
  camera?: string
  seedancePrompt?: string
  dialogue?: string
  size?: string
  durationSec?: number
  voiceMode?: string
  voiceOnly?: string[]
  characters?: string[]
  characterIds?: string[]
  speakerOffscreen?: boolean
  wardrobeState?: unknown
}

/**
 * Generate / repair fix for one raw shot.
 * Strips realm labels from visual, action, and seedance picture prose.
 * Does not touch dialogue, character records, wardrobe keys, or startState / screenPos keys.
 */
const CLOSE_FACE = /中近景|近景|特写|大特写/
const WIDE_FACE = /全景|远景|中全景|大全景|中景/
const SHORT_SHOT_SEC = 6
const SHORT_MOTION_CAP = 3

function isCloseOrMediumClose(shot: { size?: string; camera?: string; seedancePrompt?: string }): boolean {
  const size = shot.size || ''
  const face = `${size} ${shot.camera || ''}`
  if (CLOSE_FACE.test(face)) return true
  if (WIDE_FACE.test(size)) return false
  if (!size && CLOSE_FACE.test(pictureBody(shot.seedancePrompt || ''))) return true
  return false
}

/** Large implied head turns become a small eye move. Explicit 转头/转身 stay for the stability clause. */
export function calmImpliedHeadTurn(text: string): string {
  const chunks = (text || '').split(/(限制\s*[：:][^。\n]*)/g)
  return chunks
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk
      return chunk
        .replace(/视线越过[^，。；\n]{0,18}/g, '眼睛小幅侧看，头基本不动')
        .replace(/目光越过[^，。；\n]{0,18}/g, '眼睛小幅侧看，头基本不动')
        .replace(/眼神越过[^，。；\n]{0,18}/g, '眼睛小幅侧看，头基本不动')
        .replace(/越过[^，。；\n]{0,8}肩(?:膀)?(?:望向[^，。；\n]{0,12})?/g, '眼睛小幅看向肩旁，头基本不动')
        .replace(/望向[^，。；\n]{0,10}深处/g, '目光停在近处，头基本不动')
    })
    .join('')
}

function isMainMotion(clause: string): boolean {
  return actionWeight(clause) > 0 || /转头|转身|拥抱|伸手|张嘴|回头|扭头/.test(clause)
}

/** Short shots keep at most three motions: the first larger action, then smaller ones, in original order. */
export function thinShortShotMotions(text: string, max = SHORT_MOTION_CAP): string {
  const clauses = (text || '').split(/[，,；;]/).map((s) => s.trim()).filter(Boolean)
  if (clauses.length <= max) return text || ''
  const main = clauses.find(isMainMotion)
  const chosen: string[] = []
  for (const c of clauses) {
    if (chosen.length >= max) break
    if (main && isMainMotion(c) && c !== main) continue
    chosen.push(c)
  }
  return chosen.join('，')
}

function thinSeedanceActions(prompt: string): string {
  return (prompt || '').replace(/动作\s*[：:]([^。\n]*)/g, (_m, body: string) => `动作：${thinShortShotMotions(body)}`)
}

export function applyGeneratorPictureRules<T extends GeneratorPictureShot>(shot: T): T {
  let visual = typeof shot.visual === 'string' ? stripRealmLabels(shot.visual) : shot.visual
  let action = typeof shot.action === 'string' ? stripRealmLabels(shot.action) : shot.action
  let camera = typeof shot.camera === 'string' ? shot.camera : shot.camera
  let seedance = typeof shot.seedancePrompt === 'string' ? shot.seedancePrompt : shot.seedancePrompt
  const impliedTurn = TURN_ACTION.test(
    pictureBody([typeof visual === 'string' ? visual : '', typeof action === 'string' ? action : '', typeof seedance === 'string' ? seedance : ''].join('\n')),
  )
  if (impliedTurn && isCloseOrMediumClose({ size: shot.size, camera: typeof camera === 'string' ? camera : '', seedancePrompt: typeof seedance === 'string' ? seedance : '' })) {
    if (typeof visual === 'string') visual = calmImpliedHeadTurn(visual)
    if (typeof action === 'string') action = calmImpliedHeadTurn(action)
    if (typeof seedance === 'string') seedance = calmImpliedHeadTurn(seedance)
  }
  const dur = Number(shot.durationSec)
  if (Number.isFinite(dur) && dur > 0 && dur <= SHORT_SHOT_SEC) {
    if (typeof action === 'string') action = thinShortShotMotions(action)
    if (typeof seedance === 'string') seedance = thinSeedanceActions(seedance)
  }
  const hidden = axisNeedsHiddenFaceLimit({
    visual: typeof visual === 'string' ? visual : '',
    action: typeof action === 'string' ? action : '',
    camera: typeof camera === 'string' ? camera : '',
    seedancePrompt: typeof seedance === 'string' ? seedance : '',
    wardrobeState: shot.wardrobeState,
  })
  if (hidden) {
    if (typeof visual === 'string') visual = softenSharpProfile(visual)
    if (typeof action === 'string') action = softenSharpProfile(action)
    if (typeof camera === 'string') camera = softenSharpProfile(camera)
  }
  const hasPerson = Boolean((shot.characters && shot.characters.length) || (shot.characterIds && shot.characterIds.length))
  const mode = String(shot.voiceMode || '').trim().toLowerCase()
  // Explicit onscreen wins. Otherwise inner/offscreen, a VO tag on the line, or speakerOffscreen.
  const offscreen =
    mode !== 'onscreen' &&
    (mode === 'inner' ||
      mode === 'offscreen' ||
      Boolean(shot.speakerOffscreen) ||
      /（(?:内心|OS|画外|旁白)）/.test(shot.dialogue || ''))
  const seedancePrompt = applyPictureConstraints(typeof seedance === 'string' ? seedance : '', {
    hasPerson,
    voiceMode: shot.voiceMode,
    offscreen,
    forceStability: impliedTurn,
    action: typeof action === 'string' ? action : '',
    camera: typeof camera === 'string' ? camera : '',
    picture: typeof visual === 'string' ? visual : '',
    wardrobeState: shot.wardrobeState,
  })
  return {
    ...shot,
    ...(typeof shot.visual === 'string' ? { visual } : {}),
    ...(typeof shot.action === 'string' ? { action } : {}),
    ...(typeof shot.camera === 'string' ? { camera } : {}),
    seedancePrompt,
  }
}
