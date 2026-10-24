/**
 * Parse / match / apply h3-character-pack@1 定妆包 (pure functions).
 *
 * ## Schema: h3-character-pack@1
 *
 * Required per character: `displayName`, `refImage`.
 * Optional look fields: age, background, appearance, costume, props, negative,
 * sourcePrompt, characterKey, images (dir + front/sideA/back/sideB/halfBody/orbit).
 *
 * ### Training-only fields (LoRA / Omni multi-ref) — OPTIONAL, backward compatible
 *
 * These are **never** injected into visual prompts, `characterBrief`, or
 * video-pipeline `inject_character_meta`. Consumers must keep them under
 * training / LoRA pipelines only.
 *
 * | Field | Shape | Notes |
 * |---|---|---|
 * | multiAngleStills | `{ front?, side?, threeQuarter?, extras?[] }` and/or `slots[]` | Named angles + extras; slots hold ≥8 paths (正/侧/3/4/extra) |
 * | wardrobeVariants | `[{ id, label, costumePrompt?, refImages[] }]` | e.g. jacket vs hoodie |
 * | voiceSamples | `[{ path?, url?, label? }]` | TTS wav attached to character (need path or url) |
 * | dialogueClips | `[{ text, sourceShotId? }]` | Typically 10–14 lines; **LoRA text only — never inject into visual prompts** |
 * | loraStrengthDefault | number (default 0.8) | Suggested LoRA strength |
 * | trainingNotes | string | Should mention 参考图勿强继承光照 |
 *
 * Old packs without these fields still parse and apply normally.
 */
import type { Character, CharacterTrainingAssets } from '../types'
import { blankCharacter } from './templates/cast'

export const CHARACTER_PACK_SCHEMA = 'h3-character-pack@1'

/** Keys that must never enter visual prompts / inject_character_meta. */
export const PACK_TRAINING_FIELD_KEYS = [
  'multiAngleStills',
  'wardrobeVariants',
  'voiceSamples',
  'dialogueClips',
  'loraStrengthDefault',
  'trainingNotes',
] as const

export type PackTrainingFieldKey = (typeof PACK_TRAINING_FIELD_KEYS)[number]

export const DEFAULT_LORA_STRENGTH = 0.8
export const DEFAULT_TRAINING_NOTES =
  '参考图勿强继承光照；多角度静帧与服装变体仅作身份/外形参考，勿把参考图灯光写进画面 prompt。'

export type MultiAngleSlotKind = 'front' | 'side' | 'threeQuarter' | 'extra'

export interface MultiAngleStillSlot {
  kind: MultiAngleSlotKind
  path: string
  label?: string
}

/**
 * Multi-angle stills for Omni / LoRA identity.
 * Prefer named slots + extras[]; `slots` is an alternate list form (正/侧/3/4).
 * Combined capacity should allow ≥8 stills.
 */
export interface MultiAngleStills {
  front?: string
  side?: string
  threeQuarter?: string
  extras?: string[]
  slots?: MultiAngleStillSlot[]
}

export interface WardrobeVariant {
  id: string
  label: string
  costumePrompt?: string
  refImages: string[]
}

/** TTS wav sample; at least one of path / url required. */
export interface VoiceSample {
  path?: string
  url?: string
  label?: string
}

/**
 * Dialogue line for LoRA text training only.
 * NEVER inject `text` into visual prompts or inject_character_meta.
 */
export interface DialogueClip {
  text: string
  sourceShotId?: string
}

export interface PackImages {
  dir: string
  front?: string
  sideA?: string
  back?: string
  sideB?: string
  halfBody?: string
  orbit?: string
  [k: string]: string | undefined
}

export interface PackCharacter {
  refImage: string
  characterKey?: string
  displayName: string
  age?: number | string | null
  background?: string
  appearance?: string
  costume?: string
  props?: string[]
  negative?: string
  sourcePrompt?: string
  images?: PackImages
  /** Training-only — not for visual prompts / inject_character_meta */
  multiAngleStills?: MultiAngleStills
  wardrobeVariants?: WardrobeVariant[]
  voiceSamples?: VoiceSample[]
  dialogueClips?: DialogueClip[]
  loraStrengthDefault?: number
  trainingNotes?: string
}

export interface CharacterPack {
  schema: typeof CHARACTER_PACK_SCHEMA
  project?: string
  generatedAt?: string
  assetRoot?: string
  characters: PackCharacter[]
}

/** Per-row mapping chosen in the confirmation UI. */
export type PackMatchAction =
  | { kind: 'apply'; targetId: string }
  | { kind: 'create' }
  | { kind: 'skip' }

export interface PackMatchRow {
  packIndex: number
  pack: PackCharacter
  /** Auto-suggested action before user rematch */
  suggested: PackMatchAction
}

export interface ApplyPackResult {
  characters: Character[]
  updated: number
  created: number
  skipped: number
}

/** Strip trailing （变体）/ (variant) from a display name → Chinese base. */
export function stripVariantParen(name: string): string {
  return (name || '').replace(/\s*[（(][^）)]*[）)]\s*$/u, '').trim()
}

export function joinProps(props: string[] | undefined | null): string {
  if (!props?.length) return ''
  return props.map((p) => String(p).trim()).filter(Boolean).join('、')
}

function asOptionalString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s || undefined
}

function parseMultiAngleStills(raw: unknown, index: number): MultiAngleStills | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'object') throw new Error(`characters[${index}].multiAngleStills 须为对象`)
  const o = raw as Record<string, unknown>
  const out: MultiAngleStills = {}
  const front = asOptionalString(o.front)
  const side = asOptionalString(o.side)
  const threeQuarter = asOptionalString(o.threeQuarter)
  if (front) out.front = front
  if (side) out.side = side
  if (threeQuarter) out.threeQuarter = threeQuarter
  if (Array.isArray(o.extras)) {
    out.extras = o.extras.map((p) => String(p).trim()).filter(Boolean)
  }
  if (Array.isArray(o.slots)) {
    out.slots = o.slots.map((s, j) => {
      if (!s || typeof s !== 'object') throw new Error(`characters[${index}].multiAngleStills.slots[${j}] 无效`)
      const row = s as Record<string, unknown>
      const kindRaw = String(row.kind ?? 'extra').trim()
      const kind: MultiAngleSlotKind =
        kindRaw === 'front' || kindRaw === 'side' || kindRaw === 'threeQuarter' || kindRaw === 'extra'
          ? kindRaw
          : 'extra'
      const path = String(row.path ?? '').trim()
      if (!path) throw new Error(`characters[${index}].multiAngleStills.slots[${j}] 缺少 path`)
      const label = asOptionalString(row.label)
      return label ? { kind, path, label } : { kind, path }
    })
  }
  const named = [out.front, out.side, out.threeQuarter].filter(Boolean).length
  const extras = out.extras?.length ?? 0
  const slots = out.slots?.length ?? 0
  if (named + extras + slots === 0) return undefined
  return out
}

function parseWardrobeVariants(raw: unknown, index: number): WardrobeVariant[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new Error(`characters[${index}].wardrobeVariants 须为数组`)
  if (raw.length === 0) return []
  return raw.map((v, j) => {
    if (!v || typeof v !== 'object') throw new Error(`characters[${index}].wardrobeVariants[${j}] 无效`)
    const row = v as Record<string, unknown>
    const id = String(row.id ?? '').trim()
    const label = String(row.label ?? '').trim()
    if (!id) throw new Error(`characters[${index}].wardrobeVariants[${j}] 缺少 id`)
    if (!label) throw new Error(`characters[${index}].wardrobeVariants[${j}] 缺少 label`)
    const costumePrompt = asOptionalString(row.costumePrompt)
    const refImages = Array.isArray(row.refImages)
      ? row.refImages.map((p) => String(p).trim()).filter(Boolean)
      : []
    return costumePrompt ? { id, label, costumePrompt, refImages } : { id, label, refImages }
  })
}

function parseVoiceSamples(raw: unknown, index: number): VoiceSample[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new Error(`characters[${index}].voiceSamples 须为数组`)
  if (raw.length === 0) return []
  return raw.map((v, j) => {
    if (!v || typeof v !== 'object') throw new Error(`characters[${index}].voiceSamples[${j}] 无效`)
    const row = v as Record<string, unknown>
    const path = asOptionalString(row.path)
    const url = asOptionalString(row.url)
    if (!path && !url) throw new Error(`characters[${index}].voiceSamples[${j}] 须有 path 或 url`)
    const label = asOptionalString(row.label)
    const out: VoiceSample = {}
    if (path) out.path = path
    if (url) out.url = url
    if (label) out.label = label
    return out
  })
}

function parseDialogueClips(raw: unknown, index: number): DialogueClip[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new Error(`characters[${index}].dialogueClips 须为数组`)
  if (raw.length === 0) return []
  return raw.map((v, j) => {
    if (!v || typeof v !== 'object') throw new Error(`characters[${index}].dialogueClips[${j}] 无效`)
    const row = v as Record<string, unknown>
    const text = String(row.text ?? '').trim()
    if (!text) throw new Error(`characters[${index}].dialogueClips[${j}] 缺少 text`)
    const sourceShotId = asOptionalString(row.sourceShotId)
    return sourceShotId ? { text, sourceShotId } : { text }
  })
}

/** Count still paths across named + extras + slots (for UI / capacity checks). */
export function countMultiAngleStills(stills: MultiAngleStills | undefined): number {
  if (!stills) return 0
  const named = [stills.front, stills.side, stills.threeQuarter].filter(Boolean).length
  return named + (stills.extras?.length ?? 0) + (stills.slots?.length ?? 0)
}

/** Build Character.trainingAssets from pack training fields (undefined if none). */
export function trainingAssetsFromPack(pack: PackCharacter): CharacterTrainingAssets | undefined {
  const has =
    pack.multiAngleStills ||
    (pack.wardrobeVariants && pack.wardrobeVariants.length > 0) ||
    (pack.voiceSamples && pack.voiceSamples.length > 0) ||
    (pack.dialogueClips && pack.dialogueClips.length > 0) ||
    pack.loraStrengthDefault != null ||
    (pack.trainingNotes && pack.trainingNotes.trim())
  if (!has) return undefined
  const assets: CharacterTrainingAssets = {
    // Explicit: never feed these into visual prompts / inject_character_meta
    neverInjectIntoVisualPrompts: true,
  }
  if (pack.multiAngleStills) assets.multiAngleStills = pack.multiAngleStills
  if (pack.wardrobeVariants) assets.wardrobeVariants = pack.wardrobeVariants
  if (pack.voiceSamples) assets.voiceSamples = pack.voiceSamples
  if (pack.dialogueClips) assets.dialogueClips = pack.dialogueClips
  assets.loraStrengthDefault =
    typeof pack.loraStrengthDefault === 'number' && Number.isFinite(pack.loraStrengthDefault)
      ? pack.loraStrengthDefault
      : DEFAULT_LORA_STRENGTH
  assets.trainingNotes = pack.trainingNotes?.trim() || DEFAULT_TRAINING_NOTES
  return assets
}

/** Short summary for import UI. */
export function summarizeTrainingAssets(pack: PackCharacter): string | null {
  const stills = countMultiAngleStills(pack.multiAngleStills)
  const wardrobe = pack.wardrobeVariants?.length ?? 0
  const voice = pack.voiceSamples?.length ?? 0
  const clips = pack.dialogueClips?.length ?? 0
  if (!stills && !wardrobe && !voice && !clips && pack.loraStrengthDefault == null && !pack.trainingNotes) {
    return null
  }
  const parts: string[] = []
  if (stills) parts.push(`多角度 ${stills}`)
  if (wardrobe) parts.push(`服装变体 ${wardrobe}`)
  if (voice) parts.push(`语音 ${voice}`)
  if (clips) parts.push(`对白训条 ${clips}`)
  if (pack.loraStrengthDefault != null) parts.push(`LoRA ${pack.loraStrengthDefault}`)
  return parts.length ? `训练素材（不进画面 prompt）：${parts.join(' · ')}` : null
}

export function parseCharacterPack(raw: unknown): CharacterPack {
  if (!raw || typeof raw !== 'object') throw new Error('定妆包不是有效的 JSON 对象')
  const o = raw as Record<string, unknown>
  if (o.schema !== CHARACTER_PACK_SCHEMA) {
    throw new Error(`定妆包 schema 须为 ${CHARACTER_PACK_SCHEMA}，实际为 ${String(o.schema ?? '(缺失)')}`)
  }
  if (!Array.isArray(o.characters) || o.characters.length === 0) {
    throw new Error('定妆包 characters 不能为空')
  }
  const characters: PackCharacter[] = o.characters.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`characters[${i}] 无效`)
    const row = c as Record<string, unknown>
    const displayName = String(row.displayName ?? '').trim()
    const refImage = String(row.refImage ?? '').trim()
    if (!displayName) throw new Error(`characters[${i}] 缺少 displayName`)
    if (!refImage) throw new Error(`characters[${i}] 缺少 refImage`)
    const images =
      row.images && typeof row.images === 'object'
        ? ({ ...(row.images as PackImages) } as PackImages)
        : undefined

    let loraStrengthDefault: number | undefined
    if (row.loraStrengthDefault != null && row.loraStrengthDefault !== '') {
      const n = Number(row.loraStrengthDefault)
      if (!Number.isFinite(n)) throw new Error(`characters[${i}].loraStrengthDefault 须为数字`)
      loraStrengthDefault = n
    }

    const pc: PackCharacter = {
      refImage,
      characterKey: row.characterKey != null ? String(row.characterKey) : undefined,
      displayName,
      age: row.age as number | string | null | undefined,
      background: row.background != null ? String(row.background) : undefined,
      appearance: row.appearance != null ? String(row.appearance) : undefined,
      costume: row.costume != null ? String(row.costume) : undefined,
      props: Array.isArray(row.props) ? row.props.map((p) => String(p)) : [],
      negative: row.negative != null ? String(row.negative) : undefined,
      sourcePrompt: row.sourcePrompt != null ? String(row.sourcePrompt) : undefined,
      images,
    }

    const multiAngleStills = parseMultiAngleStills(row.multiAngleStills, i)
    if (multiAngleStills) pc.multiAngleStills = multiAngleStills
    const wardrobeVariants = parseWardrobeVariants(row.wardrobeVariants, i)
    if (wardrobeVariants) pc.wardrobeVariants = wardrobeVariants
    const voiceSamples = parseVoiceSamples(row.voiceSamples, i)
    if (voiceSamples) pc.voiceSamples = voiceSamples
    const dialogueClips = parseDialogueClips(row.dialogueClips, i)
    if (dialogueClips) pc.dialogueClips = dialogueClips
    if (loraStrengthDefault != null) pc.loraStrengthDefault = loraStrengthDefault
    const trainingNotes = asOptionalString(row.trainingNotes)
    if (trainingNotes) pc.trainingNotes = trainingNotes

    return pc
  })
  return {
    schema: CHARACTER_PACK_SCHEMA,
    project: o.project != null ? String(o.project) : undefined,
    generatedAt: o.generatedAt != null ? String(o.generatedAt) : undefined,
    assetRoot: o.assetRoot != null ? String(o.assetRoot) : undefined,
    characters,
  }
}

function usedIdsFrom(suggestions: PackMatchAction[]): Set<string> {
  const used = new Set<string>()
  for (const s of suggestions) if (s.kind === 'apply') used.add(s.targetId)
  return used
}

/**
 * Auto-match one pack entry against remaining (unused) project characters.
 * Order: exact displayName↔name → exact refImage↔refImage → fuzzy baseName/prefix → characterKey.
 */
export function matchPackCharacter(
  pack: PackCharacter,
  existing: Character[],
  usedIds: Set<string> = new Set(),
): string | null {
  const free = existing.filter((c) => !usedIds.has(c.id))
  const byName = free.find((c) => c.name === pack.displayName)
  if (byName) return byName.id

  if (pack.refImage) {
    const byRef = free.find((c) => c.refImage?.trim() === pack.refImage)
    if (byRef) return byRef.id
  }

  const base = stripVariantParen(pack.displayName)
  if (base) {
    // Prefer exact variant-style name match among free: name starts with base + paren
    const byPrefix = free.find(
      (c) =>
        c.name === base ||
        c.baseName?.trim() === base ||
        stripVariantParen(c.name) === base ||
        (c.name.startsWith(base) && /^[（(]/.test(c.name.slice(base.length))),
    )
    if (byPrefix) return byPrefix.id
  }

  if (pack.characterKey) {
    const byKey = free.find((c) => c.characterKey === pack.characterKey)
    if (byKey) return byKey.id
  }

  return null
}

/** Build confirmation rows with default auto-match suggestions (greedy, no double-assign). */
export function buildMatchRows(pack: CharacterPack, existing: Character[]): PackMatchRow[] {
  const used = new Set<string>()
  return pack.characters.map((pc, packIndex) => {
    const id = matchPackCharacter(pc, existing, used)
    let suggested: PackMatchAction
    if (id) {
      used.add(id)
      suggested = { kind: 'apply', targetId: id }
    } else {
      suggested = { kind: 'skip' }
    }
    return { packIndex, pack: pc, suggested }
  })
}

/** Patch fields from a pack row onto a Character (does not change id). */
export function applyPackToCharacter(target: Character, pack: PackCharacter): Character {
  const base = stripVariantParen(pack.displayName)
  const propsJoined = joinProps(pack.props)
  const age =
    pack.age != null && pack.age !== ''
      ? String(pack.age)
      : undefined
  const next: Character = {
    ...target,
    name: pack.displayName,
    refImage: pack.refImage,
    visualLock: pack.appearance?.trim() || target.visualLock,
    costume: pack.costume?.trim() || target.costume,
    signatureProp: propsJoined,
    locked: true,
  }
  if (age !== undefined) next.age = age
  else delete next.age

  if (pack.background?.trim()) next.background = pack.background.trim()
  // empty background in pack → leave existing

  if (pack.negative != null) {
    const n = pack.negative.trim()
    if (n) next.negative = n
    else delete next.negative
  }

  if (pack.characterKey) next.characterKey = pack.characterKey
  if (base && base !== pack.displayName) next.baseName = base
  else if (pack.characterKey && !next.baseName) {
    // keep existing baseName if any
  }

  const dir = pack.images?.dir?.trim()
  if (dir) next.imagesDir = dir
  else delete next.imagesDir

  // Training assets stay on Character for LoRA/Omni pipelines; never used by characterBrief / video export.
  const training = trainingAssetsFromPack(pack)
  if (training) next.trainingAssets = training
  else delete next.trainingAssets

  return next
}

/** Create a new Character from a pack row (appended after existing). */
export function createCharacterFromPack(pack: PackCharacter, existing: Character[]): Character {
  const blank = blankCharacter(existing, {
    name: pack.displayName,
    role: '角色',
    tags: ['support'],
    visualLock: pack.appearance?.trim() || '待补充外貌与气质',
    costume: pack.costume?.trim() || '待补充服装',
    signatureProp: joinProps(pack.props),
  })
  return applyPackToCharacter(blank, pack)
}

/**
 * Apply confirmed match actions to the cast.
 * `actions` is parallel to pack.characters (or keyed by packIndex via rows).
 */
export function applyCharacterPack(
  existing: Character[],
  pack: CharacterPack,
  actions: PackMatchAction[],
): ApplyPackResult {
  if (actions.length !== pack.characters.length) {
    throw new Error(`匹配结果数量 (${actions.length}) 与定妆包角色数 (${pack.characters.length}) 不一致`)
  }
  let chars = [...existing]
  let updated = 0
  let created = 0
  let skipped = 0
  // Track assign targets to avoid double-apply; creations append sequentially
  const claimed = new Set<string>()

  for (let i = 0; i < pack.characters.length; i++) {
    const pc = pack.characters[i]
    const act = actions[i]
    if (act.kind === 'skip') {
      skipped++
      continue
    }
    if (act.kind === 'create') {
      const neu = createCharacterFromPack(pc, chars)
      chars = [...chars, neu]
      created++
      continue
    }
    // apply
    if (claimed.has(act.targetId)) {
      skipped++
      continue
    }
    const idx = chars.findIndex((c) => c.id === act.targetId)
    if (idx < 0) {
      skipped++
      continue
    }
    claimed.add(act.targetId)
    chars[idx] = applyPackToCharacter(chars[idx], pc)
    updated++
  }

  return { characters: chars, updated, created, skipped }
}

/** Convenience: parse JSON text → pack. */
export function parseCharacterPackJson(text: string): CharacterPack {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('定妆包 JSON 解析失败')
  }
  return parseCharacterPack(raw)
}

export { usedIdsFrom }
