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
  /** Shared real name for look variants, e.g. 白朴 for 白朴（变帅前）/白朴（变帅后）; used for subtitles */
  baseName?: string
  personality?: string
  arc?: string
  /** Wealth / class / home background stated in the idea, e.g. 富三代，住高档小区独栋 */
  background?: string
  /** Age (number or text like 17) — injected into prompts; never invent conflicting ages */
  age?: string
  /** 定妆图文件名/前缀, e.g. bai_pu_plain — exported as characters[].refImage */
  refImage?: string
  /** visualLock/costume are authoritative (also implied by refImage): regeneration must not overwrite */
  locked?: boolean
  /** 定妆负向提示（导入定妆包） */
  negative?: string
  /** 定妆包角色键，同人多造型共用，e.g. bai_pu */
  characterKey?: string
  /** GPU 定妆图目录名 images.dir（导入定妆包；导出为 characters[].imagesDir） */
  imagesDir?: string
  /** wardrobe state of this look variant (e.g. plain / glowup); default derived from refImage minus characterKey_ */
  wardrobeState?: string
  /** wardrobe changes over the story: { state, fromShotId? | fromEpisode? } (exported to the video pack) */
  wardrobeTimeline?: { state: string; fromShotId?: string; fromEpisode?: number; evidence?: string; autoProposed?: boolean }[]
  /** keyword cues in shot visual/action text that switch the wardrobe state from that shot on */
  wardrobeCues?: { state: string; keywords: string[] }[]
    /** wardrobe state → character-pack reference set (lora_materials/datasets/<refSet>), null = none yet */
    wardrobeRefs?: Record<string, { refSet: string | null; logoFree?: boolean; fallbackRefSet?: string; note?: string }>
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
  /** Scene time of day carried from script, e.g. 清晨 / 白天 / 黄昏 / 夜 */
  timeOfDay?: string
  /** Optional short location tag, e.g. 江景别墅卧室 / 教室 (helps sceneId; post-process still derives when absent) */
  location?: string
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
  /** Key setting facts (hard constraints for LLM prompts), e.g. 白朴是富三代，住高档小区 */
  settingFacts?: string[]
  /** 'idea' when created by 从想法一键生成 — genre template tropes are not injected */
  source?: 'idea'
  characters: Character[]
  outline: EpisodeOutline[]
  scripts: Record<number, EpisodeScript>
  storyboards: Record<number, Shot[]>
  selectedEpisode: number
  updatedAt: string
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
