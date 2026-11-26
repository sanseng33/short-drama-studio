/**
 * shot-state-ssot@0.1.0（已冻结）的类型。单一状态源：出演、首帧可见、发声、事件时序、可选服装。
 * 不依赖 src/types.ts 的 Shot/Project 必填字段；旧 Shot 通过 migrate.ts 迁入。
 */
export const SHOT_STATE_SPEC = 'shot-state-ssot@0.1.0' as const

export type ShotStateMode = 'compat' | 'strict' | 'run-ready'

export type FirstFrameKind = 'full' | 'partial' | 'offscreen' | 'absent' | 'unverified'
export type SpeechMode = 'onscreen' | 'offscreen' | 'inner' | 'voice_only'
export type ShotEventKind = 'start_visible' | 'start_offscreen' | 'enter' | 'exit' | 'reenter'

export const FIRST_FRAME_KINDS: readonly FirstFrameKind[] = ['full', 'partial', 'offscreen', 'absent', 'unverified']
export const SPEECH_MODES: readonly SpeechMode[] = ['onscreen', 'offscreen', 'inner', 'voice_only']
export const SHOT_EVENT_KINDS: readonly ShotEventKind[] = ['start_visible', 'start_offscreen', 'enter', 'exit', 'reenter']

export interface FirstFrameEntry {
  id: string
  kind: FirstFrameKind
  /** kind=partial 时必填，例如 ['sleeve'] */
  parts?: string[]
}

export interface SpeechEntry {
  id: string
  mode: SpeechMode
}

export interface ShotEvent {
  id: string
  kind: ShotEventKind
  /** 可选秒数；同一角色的事件时间不得倒退 */
  atSec?: number
}

export interface CostumeEntry {
  id: string
  state: string
}

export interface ShotStateSource {
  /** 本镜涉及角色的集合（集合语义；比较与 hash 都不依赖顺序） */
  cast: string[]
  /** 仅用于显示的顺序，不进入 sourceHash */
  displayOrder: string[]
  firstFrame: FirstFrameEntry[]
  speech: SpeechEntry[]
  /** 按数组顺序即时序 */
  events: ShotEvent[]
  costume?: CostumeEntry[]
}

export interface TextProvenance {
  field: string
  source: 'derived' | 'user'
  compilerId?: string
  compilerVersion?: string
  /** 派生时的状态源 hash；用户文本为空 */
  sourceHash?: string
  textHash: string
  invalidated: boolean
  reviewRequired: boolean
}

export interface StateText {
  field: string
  text: string
  provenance: TextProvenance
}

export type SemanticVerdict = 'pass' | 'fail' | 'review_required'

/** 人工 / LLM 语义审查记录；绑定审查时的 textHash 与 sourceHash，任一变化即作废。 */
export interface SemanticReview {
  field: string
  verdict: SemanticVerdict
  reviewer: 'human' | 'llm'
  textHash: string
  sourceHash: string
  note?: string
  at?: string
}

export type FieldRole = 'run_required' | 'capability' | 'ignored_documented'

export interface FieldDecl {
  name: string
  role: FieldRole
  supported: boolean
  note?: string
}

export interface MigrationInfo {
  origin: 'legacy_migration' | 'shot_fields' | 'start_state'
  fromCharacterIds: string[]
  fromVoiceOnly: string[]
  /** voiceOnly 中无法解析到角色 id 的原值（保留为 cast 成员） */
  unresolvedVoiceOnly: string[]
}

export interface ShotStateDoc {
  spec: typeof SHOT_STATE_SPEC
  shotId: string
  source: ShotStateSource
  texts: StateText[]
  reviews: SemanticReview[]
  fields: FieldDecl[]
  migration?: MigrationInfo
}

export type IssueLayer = 'structural' | 'template' | 'semantic' | 'fields'

export interface ShotStateIssue {
  layer: IssueLayer
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  characterId?: string
  field?: string
  /** unknown 不是已证明的矛盾 */
  confidence: 'definite' | 'unknown'
}

export type TextStatus = 'valid_derived' | 'user' | 'invalidated' | 'stale'
export type SemanticStatus = 'pass' | 'fail' | 'review_required' | 'unknown'
export type SemanticFieldStatus = SemanticStatus | 'derived_valid'

export interface ShotStateReport {
  spec: typeof SHOT_STATE_SPEC
  shotId: string
  mode: ShotStateMode
  ok: boolean
  structural: { ok: boolean; issues: ShotStateIssue[] }
  template: { fields: { field: string; status: TextStatus }[]; issues: ShotStateIssue[] }
  semantic: { status: SemanticStatus; fields: { field: string; status: SemanticFieldStatus }[]; issues: ShotStateIssue[] }
  fields: { runRequiredUnsupported: string[]; capabilityUnsupported: string[]; ignoredDocumented: string[]; issues: ShotStateIssue[] }
  /** cast 中首帧缺声明或为 unverified 的角色 */
  unverifiedCharacterIds: string[]
  issues: ShotStateIssue[]
}
