/**
 * Default picture rules for every shot (generate, repair, and export prompt assembly).
 * No show data. Realm parentheticals stay on character / dialogue / state-key metadata;
 * picture prose and the 「限制：」 channel are what the video model actually paints.
 */
import {
  LIFE_MOTION_CONSTRAINT,
  appendLimitClause,
  needsLifeMotionConstraint,
  pictureBody,
} from './lifeMotion'

/** Default ban: gold sparks, starbursts, magic particles, decorative light effects. */
export const DECORATIVE_LIGHT_BAN = '禁止金色火花、星芒、魔法粒子与装饰性光效'

/**
 * Breathing, blinking, shoulder line, and small hand life — a hard 限制 clause,
 * not only an action / timeline description.
 */
export const LIFE_MOTION_HARD_CONSTRAINT =
  '须有呼吸、眨眼，以及肩线与手部的小幅生命感微动，禁止整段静止'

/** Head or body turn: smaller amplitude, facial structure and hairline stay stable. */
export const TURN_STABILITY_CONSTRAINT =
  '转头或转身幅度收小，眼睛、鼻子、嘴巴、下颌与发际线保持稳定，禁止面部与头发融化变形'

/** Realm label glued to a name. Not a wardrobe variant such as （变帅前） / （之前）. */
const REALM_LABEL = /[（(]\s*(?:梦中|梦里|梦境|回忆中|回忆里|回忆|闪回|现实)\s*[）)]/g

const TURN_ACTION = /转头|回头|扭头|偏头|侧头|转过脸|别过脸|转脸|把头转|头一转|头转向|脸转向|转过身|转身|侧过身|回身/

const LIFE_AXIS = /呼吸|眨眼|肩线|手指/

export function stripRealmLabels(text: string): string {
  return (text || '').replace(REALM_LABEL, '')
}

export function textHasTurn(text: string): boolean {
  return TURN_ACTION.test(pictureBody(text || ''))
}

export interface PictureConstraintOpts {
  /** Someone is in frame (characters / characterIds / on-screen count). */
  hasPerson?: boolean
  voiceMode?: string | null
  /** Shot audio is inner / offscreen even when voiceMode was not copied onto the prompt. */
  offscreen?: boolean
  action?: string
  /** Extra picture prose (visual, seedance body). 「限制：」 sentences are ignored for turn / life detection. */
  picture?: string
}

export function pictureConstraintClauses(prompt: string, opts: PictureConstraintOpts = {}): string[] {
  const action = opts.action || ''
  const picture = opts.picture || ''
  const axis = `${action}\n${pictureBody(picture)}\n${pictureBody(prompt || '')}`
  const closed =
    Boolean(opts.offscreen) || needsLifeMotionConstraint(`${prompt || ''}\n${action}\n${picture}`, opts.voiceMode)
  const out = [DECORATIVE_LIGHT_BAN]
  if (opts.hasPerson || closed || LIFE_AXIS.test(axis)) out.push(LIFE_MOTION_HARD_CONSTRAINT)
  if (closed) out.push(LIFE_MOTION_CONSTRAINT)
  if (TURN_ACTION.test(axis)) out.push(TURN_STABILITY_CONSTRAINT)
  return out
}

/** Strip realm labels from picture text and merge the default clauses into 「限制：」. Idempotent. */
export function applyPictureConstraints(prompt: string, opts: PictureConstraintOpts = {}): string {
  let p = stripRealmLabels(prompt || '')
  const action = stripRealmLabels(opts.action || '')
  const picture = stripRealmLabels(opts.picture || '')
  for (const c of pictureConstraintClauses(p, { ...opts, action, picture })) p = appendLimitClause(p, c)
  return p
}

export interface GeneratorPictureShot {
  visual?: string
  action?: string
  seedancePrompt?: string
  dialogue?: string
  voiceMode?: string
  voiceOnly?: string[]
  characters?: string[]
  characterIds?: string[]
  speakerOffscreen?: boolean
}

/**
 * Generate / repair fix for one raw shot.
 * Strips realm labels from visual, action, and seedance picture prose.
 * Does not touch dialogue, character records, wardrobe keys, or startState / screenPos keys.
 */
export function applyGeneratorPictureRules<T extends GeneratorPictureShot>(shot: T): T {
  const visual = typeof shot.visual === 'string' ? stripRealmLabels(shot.visual) : shot.visual
  const action = typeof shot.action === 'string' ? stripRealmLabels(shot.action) : shot.action
  const hasPerson = Boolean((shot.characters && shot.characters.length) || (shot.characterIds && shot.characterIds.length))
  const mode = String(shot.voiceMode || '').trim().toLowerCase()
  // Explicit onscreen wins. Otherwise inner/offscreen, a VO tag on the line, or speakerOffscreen.
  const offscreen =
    mode !== 'onscreen' &&
    (mode === 'inner' ||
      mode === 'offscreen' ||
      Boolean(shot.speakerOffscreen) ||
      /（(?:内心|OS|画外|旁白)）/.test(shot.dialogue || ''))
  const seedancePrompt = applyPictureConstraints(typeof shot.seedancePrompt === 'string' ? shot.seedancePrompt : '', {
    hasPerson,
    voiceMode: shot.voiceMode,
    offscreen,
    action: typeof action === 'string' ? action : '',
    picture: typeof visual === 'string' ? visual : '',
  })
  return {
    ...shot,
    ...(typeof shot.visual === 'string' ? { visual } : {}),
    ...(typeof shot.action === 'string' ? { action } : {}),
    seedancePrompt,
  }
}
