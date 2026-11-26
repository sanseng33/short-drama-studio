import type {
  AcceptedRisk,
  DialogueAuditSnapshot,
  ProjectLocks,
  ProjectStale,
  SettingFactItem,
  SourceFingerprint,
} from './lib/consistency/types'

export type {
  AcceptedRisk,
  CheckFinding,
  CheckSeverity,
  DialogueAuditSnapshot,
  ProjectLocks,
  ProjectStale,
  SettingFactItem,
  SourceFingerprint,
  StaleReason,
} from './lib/consistency/types'
export { KNOWN_SCHEMA_VERSION, PROJECT_BACKUP_KEY } from './lib/consistency/types'
export type { StartFrameStill, StartFrameInventory } from './lib/startFrameStill'

export type Genre =
  | '男频玄幻'
  | '都市逆袭'
  | '都市重生'
  | '古风女频重生'
  | '大女主'

export type Platform = '红果' | '抖音试水' | '海外ReelShort'

export type ArtStyle = '2D国风' | '2D日漫' | '真人都市'

export type StepId =
  | 'idea'
  | 'project'
  | 'characters'
  | 'outline'
  | 'script'
  | 'storyboard'
  | 'export'
  | 'settings'

/** Visible parts still allowed when faceVisibility is hidden. Only `ear` is accepted; cheek/jaw/eye/profile are not. */
export type FaceVisibilityAllowPart = 'ear'

export interface Character {
  id: string
  name: string
  role: string
  /** Optional targeting tags for generators, e.g. protagonist / antagonist / mentor */
  tags?: string[]
  visualLock: string
  costume: string
  signatureProp: string
  /** Optional personality / arc (filled by 从想法一键生成) */
  /** Shared real name for look variants, e.g. 甲 for 甲（之前）/甲（之后）; used for subtitles */
  baseName?: string
  personality?: string
  arc?: string
  /** Wealth / class / home background stated in the idea, e.g. 富三代，住高档小区独栋 */
  background?: string
  /** Age (number or text like 17) — injected into prompts; never invent conflicting ages */
  age?: string
  /** female / male (also 女 / 男) — drives pronoun mapping and the auto voice */
  gender?: string
  /** age band derived from age (儿童/青少年/青年/中年人/老年人) — voice + casting */
  ageBand?: string
  /** ids of the other look variants of the same person (same characterKey) */
  lookVariants?: string[]
  /** id of a DIFFERENT person this character closely resembles (keep refs / voices apart) */
  lookalikeOf?: string | null
  /** 定妆图文件名/前缀, e.g. char_a_plain — exported as characters[].refImage */
  refImage?: string
  /** visualLock/costume are authoritative (also implied by refImage): regeneration must not overwrite */
  locked?: boolean
  /** 定妆负向提示（导入定妆包） */
  negative?: string
  /** 定妆包角色键，同人多造型共用，e.g. char_a */
  characterKey?: string
  /** TTS voice: voice-library name, or { description, id }; look variants inherit by characterKey */
  voice?: string | { description?: string; id?: string }
  /** GPU 定妆图目录名 images.dir（导入定妆包；导出为 characters[].imagesDir） */
  imagesDir?: string
  /** wardrobe state of this look variant (e.g. plain / glowup); default derived from refImage minus characterKey_ */
  wardrobeState?: string
  /** wardrobe changes over the story: { state, fromShotId? | fromEpisode? } (exported to the video pack) */
  wardrobeTimeline?: { state: string; fromShotId?: string; fromEpisode?: number; evidence?: string; autoProposed?: boolean }[]
  /** keyword cues in shot visual/action text that switch the wardrobe state from that shot on */
  wardrobeCues?: { state: string; keywords: string[] }[]
    /** wardrobe state → character-pack reference set (lora_materials/datasets/<refSet>), null = none yet */
    wardrobeRefs?: Record<string, { refSet: string | null; logoFree?: boolean; fallbackRefSet?: string; note?: string; costume?: string; look?: string; facePolicy?: 'hidden' | 'visible'; faceVisibility?: 'hidden' | 'visible' | 'unverified'; faceVisibilityAllow?: FaceVisibilityAllowPart[] }>
  /**
   * LoRA / Omni multi-ref training materials from 定妆包.
   * Training-only: never inject into visual prompts, characterBrief, or inject_character_meta.
   * dialogueClips[].text is for LoRA text training only.
   */
  trainingAssets?: CharacterTrainingAssets
}

/** Angle stills for Omni / LoRA identity (named + extras and/or slots). */
export interface CharacterMultiAngleStills {
  front?: string
  side?: string
  threeQuarter?: string
  extras?: string[]
  slots?: { kind: 'front' | 'side' | 'threeQuarter' | 'extra'; path: string; label?: string }[]
}

export interface CharacterWardrobeVariant {
  id: string
  label: string
  costumePrompt?: string
  refImages: string[]
}

export interface CharacterVoiceSample {
  path?: string
  url?: string
  label?: string
}

/** LoRA dialogue line — never inject into visual prompts. */
export interface CharacterDialogueClip {
  text: string
  sourceShotId?: string
}

export interface CharacterTrainingAssets {
  multiAngleStills?: CharacterMultiAngleStills
  wardrobeVariants?: CharacterWardrobeVariant[]
  voiceSamples?: CharacterVoiceSample[]
  /** Typically 10–14; LoRA only — never inject into visual prompts */
  dialogueClips?: CharacterDialogueClip[]
  loraStrengthDefault?: number
  /** Should include 参考图勿强继承光照 */
  trainingNotes?: string
  /** Marker for exporters / injectors */
  neverInjectIntoVisualPrompts?: true
}

export interface EpisodeOutline {
  episode: number
  title: string
  hook: string
  summary: string
  cliffhanger: string
}

export interface ScriptBeat {
  label: string
  content: string
  dialogue?: string
}

export interface EpisodeScript {
  episode: number
  title: string
  beats: ScriptBeat[]
  fullText: string
}

export type ShotSize =
  | '大远景'
  | '远景'
  | '全景'
  | '中景'
  | '近景'
  | '特写'
  | '大特写'

export type CameraMove =
  | '固定'
  | '推'
  | '拉'
  | '摇'
  | '移'
  | '跟'
  | '升'
  | '降'
  | '环绕'

export interface Shot {
  id: string
  shotNo: number
  size: ShotSize
  durationSec: number
  visual: string
  action: string
  dialogue: string
  camera: CameraMove
  emotion: string
  seedancePrompt: string
  groupNote?: string
  refImage?: string
  /** Characters appearing in this shot (values are characters[].id) */
  characterIds?: string[]
  /** Sound effects, e.g. 砰 / 玻璃碎裂 */
  sfx?: string[]
  /** System UI / on-screen text — added in post, never rendered by the video model */
  overlayText?: string[]
  /** Offscreen voices (names or ids): OS / 画外音 / 电话里 */
  voiceOnly?: string[]
  /** Optional per-shot wardrobeRefs key by character id (or name, normalized on ingest). */
  wardrobeState?: Record<string, string>
  /**
   * Optional structured first-frame visibility (character id / name + kind).
   * When present and well-formed, export uses it; prose is not parsed to fill this in, and it is not a review pass.
   */
  firstFrame?: { id: string; kind: string; parts?: string[] }[]
  /** Optional structured timed events (enter / start_offscreen / …). Same caveats as firstFrame. */
  events?: { id: string; kind: string; atSec?: number }[]
  /** Export/generation: this shot is the pre or post half of a delayed-entry split. */
  delayedEntrySplit?: 'pre' | 'post'
  /** Parent shot id when this shot was split from a delayed-entry (or other) parent. */
  splitFrom?: string
  /** Parent durationSec at split time (source; may differ from this part's execution duration). */
  splitSourceDurationSec?: number
  /** Planned part duration at split time, before any later padding or allocation. */
  splitPlannedDurationSec?: number
  /** True when the split used a half-and-half plan because enter events had no usable atSec. */
  splitUntimed?: boolean
  /** Scene time of day carried from script, e.g. 清晨 / 白天 / 黄昏 / 夜 */
  timeOfDay?: string
  /** Optional short location tag, e.g. 别墅卧室 / 教室 (helps sceneId; post-process still derives when absent) */
  location?: string
  /** generator hint: first shot of a new place / time band (wide establishing frame) */
  establishing?: boolean
  /** generator (P0-1): first / last frame state per on-screen character (keys: name or id) { pos, facing, pose, gaze, hands } */
  startState?: Record<string, Record<string, unknown>>
  endState?: Record<string, Record<string, unknown>>
  /** generator (P0-2): master | A | B side of the scene's 180° line; eyeline { name: left | right | front } */
  cameraSide?: string
  eyeline?: Record<string, unknown>
  /** generator (P0-2): scene blocking { positions, facing, door, window, holding } (first shot of a scene) */
  blocking?: Record<string, unknown>
  /** generator (P0-3): scene lighting { key, soft, temp } (first shot of a scene) */
  lighting?: Record<string, unknown>
  /** generator (P0-3): onscreen | inner | offscreen */
  voiceMode?: string
  /** generator: scene realm reality | dream | memory (look variants may switch at a realm boundary) */
  realm?: string
  /** generator: false = do not FL2V from the previous shot's last frame */
  carryFromPrev?: boolean
  /**
   * Bound start-frame still (sha256 and/or external file declaration). First-class: export must carry it as-is
   * (bytes never persisted). When bound, visual/camera/size/seedancePrompt/startState must not contradict the still.
   */
  startFrameStill?: import('./lib/startFrameStill').StartFrameStill
}

export interface Project {
  id: string
  title: string
  genre: Genre
  platform: Platform
  episodeCount: number
  secondsPerEp: number
  style: ArtStyle
  logline: string
  /** Free-form genre label from idea pipeline when it doesn't map to a preset genre */
  customGenre?: string
  /** World / setting text from idea pipeline */
  worldSetting?: string
  /** canonical location list (one name per physical place, reused verbatim by every episode's shots) */
  locations?: string[]
  /** Key setting facts (hard constraints for LLM prompts), e.g. 甲家境富裕，住高档小区 */
  settingFacts?: string[]
  /** 'idea' when created by 从想法一键生成 — genre template tropes are not injected */
  source?: 'idea'
  characters: Character[]
  outline: EpisodeOutline[]
  scripts: Record<number, EpisodeScript>
  storyboards: Record<number, Shot[]>
  selectedEpisode: number
  updatedAt: string
  /** 写入 2；读取缺省按 1。旧项目缺省此字段。 */
  schemaVersion?: number
  fingerprints?: SourceFingerprint
  acceptedRisks?: AcceptedRisk[]
  dialogueAudit?: Record<number, DialogueAuditSnapshot>
  /** 设定事实确认/锁定元数据；settingFacts 仍是提示词与导出的兼容投影。 */
  settingFactItems?: SettingFactItem[]
  factsConfirmedAt?: string
  locks?: ProjectLocks
  stale?: ProjectStale
  sourceMode?: string
  /** H3 feed contract inputs (assetFeed.ts): file bindings per character × wardrobe state and per sceneId. Separate from trainingAssets. */
  assetBindings?: ProjectAssetBindings
}

/**
 * One asset file binding supplied by the user / an import step.
 * - `bytes`: only a caller that really holds the file bytes may pass them (never persisted); the builder computes SHA-256 from them.
 * - `sha256` without `bytes` is accepted only with `origin: 'imported_manifest'` (hash copied from a user manifest, format-checked).
 * - `path`: relative logical name, or an external reference (`/mnt/...`, `C:\...`, `http(s)://...`) that is never hashed.
 */
export interface AssetBindingInput {
  path?: string
  bytes?: Uint8Array
  sha256?: string
  origin?: 'local_computed' | 'imported_manifest' | 'external_unverified' | 'missing'
  note?: string
  /**
   * Attestation for a hidden-face / back-only wardrobe state.
   * The contract does not infer this from pixels. `visible` is unqualified and fail-closed;
   * missing attestation on a hidden-face ref is also fail-closed (`unverified`).
   */
  faceVisibility?: 'hidden' | 'visible' | 'unverified'
  /**
   * Optional exception list when faceVisibility is `hidden`.
   * Only `ear` is a contract-accepted visible part (ear contour). Other parts fail closed as unqualified.
   */
  faceVisibilityAllow?: FaceVisibilityAllowPart[]
}

export interface ProjectAssetBindings {
  /** key: `${characterId}:${wardrobeState}` */
  characters?: Record<string, AssetBindingInput>
  /** key: sceneId (the export's `sceneId`, never `sceneIdExport`) */
  scenes?: Record<string, AssetBindingInput>
}


export interface LlmSettings {
  baseURL: string
  apiKey: string
  model: string
}

export const DEFAULT_LLM: LlmSettings = {
  // OpenAI-compatible DeepSeek. Fill API Key in Settings (localStorage only).
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4-flash',
}

export const STEPS: { id: StepId; label: string; desc: string }[] = [
  { id: 'idea', label: '从想法一键生成', desc: '粘贴想法 → 全流程自动' },
  { id: 'project', label: '项目设定', desc: '题材 / 平台 / 集数' },
  { id: 'characters', label: '角色卡', desc: '视觉锁定与人设' },
  { id: 'outline', label: '大纲', desc: '分集钩子与悬念' },
  { id: 'script', label: '分集剧本', desc: '三秒钩子·反转·悬念' },
  { id: 'storyboard', label: '分镜表', desc: '工业分镜 + Seedance' },
  { id: 'export', label: '导出', desc: 'MD / JSON / 提示词包' },
  { id: 'settings', label: '设置', desc: '可选 LLM API' },
]
