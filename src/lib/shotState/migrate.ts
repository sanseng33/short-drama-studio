/**
 * 旧 Shot -> ShotStateDoc 的迁移（纯函数，不改 Shot，不要求 Shot 增加字段）。
 *   characterIds  -> cast（保持「本镜出场/涉及」旧含义，首帧可见性记 unverified）
 *   voiceOnly     -> cast 成员 + speech.mode=voice_only（画外发声）
 *   action / seedancePrompt -> 用户文本（source=user，语义未审查）
 * 不把 characterIds 改释为首帧可见，不凭散文推断可见性。
 */
import type { Shot } from '../../types'
import { hashText, normalizeSource } from './hashing'
import { SHOT_STATE_SPEC, type ShotStateDoc, type StateText } from './types'

export interface CharLike {
  id: string
  name: string
  baseName?: string
}

export type LegacyShotLike = Pick<Shot, 'id'> & Partial<Pick<Shot, 'shotNo' | 'characterIds' | 'voiceOnly' | 'action' | 'seedancePrompt'>>

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [])

function resolveId(v: string, chars: readonly CharLike[]): string | null {
  const hit = chars.find((c) => c.id === v) || chars.find((c) => c.name === v) || chars.find((c) => c.baseName === v)
  return hit ? hit.id : null
}

const userText = (field: string, text: string): StateText => ({
  field,
  text,
  provenance: { field, source: 'user', textHash: hashText(text), invalidated: false, reviewRequired: false },
})

export function migrateLegacyShot(shot: LegacyShotLike, chars: readonly CharLike[] = []): ShotStateDoc {
  const fromCharacterIds = strs(shot.characterIds)
  const fromVoiceOnly = strs(shot.voiceOnly)
  const unresolvedVoiceOnly: string[] = []
  const voiceIds: string[] = []
  for (const v of fromVoiceOnly) {
    const id = resolveId(v, chars)
    if (id) voiceIds.push(id)
    else {
      unresolvedVoiceOnly.push(v)
      voiceIds.push(v)
    }
  }
  const order = [...new Set([...fromCharacterIds, ...voiceIds])]
  const source = normalizeSource({
    cast: order,
    displayOrder: order,
    firstFrame: order.map((id) => ({ id, kind: 'unverified' as const })),
    speech: [...new Set(voiceIds)].map((id) => ({ id, mode: 'voice_only' as const })),
    events: [],
  })
  const texts: StateText[] = []
  if (typeof shot.action === 'string' && shot.action.trim()) texts.push(userText('action', shot.action))
  if (typeof shot.seedancePrompt === 'string' && shot.seedancePrompt.trim()) texts.push(userText('seedancePrompt', shot.seedancePrompt))
  return {
    spec: SHOT_STATE_SPEC,
    shotId: shot.id || `shot-${shot.shotNo ?? 0}`,
    source,
    texts,
    reviews: [],
    fields: [],
    migration: { origin: 'legacy_migration', fromCharacterIds, fromVoiceOnly, unresolvedVoiceOnly },
  }
}
