/** ShotStateDoc 的构造与集合辅助（纯函数）。 */
import { normalizeSource, sameSet } from './hashing'
import {
  SHOT_STATE_SPEC,
  type FieldDecl,
  type ShotStateDoc,
  type ShotStateSource,
} from './types'

export interface CreateShotStateInput extends Partial<ShotStateSource> {
  shotId: string
  cast: string[]
  fields?: FieldDecl[]
}

export function createShotState(input: CreateShotStateInput): ShotStateDoc {
  const { shotId, fields, ...src } = input
  return { spec: SHOT_STATE_SPEC, shotId, source: normalizeSource(src), texts: [], reviews: [], fields: fields ? fields.map((f) => ({ ...f })) : [] }
}

/** 首帧 full/partial 的角色集合（按 displayOrder 排列，比较时按集合）。 */
export function firstFrameVisibleIds(source: ShotStateSource): string[] {
  const vis = new Set(source.firstFrame.filter((e) => e.kind === 'full' || e.kind === 'partial').map((e) => e.id))
  return source.displayOrder.filter((id) => vis.has(id))
}

/** 集合相等，不看顺序。 */
export const castEqualsFirstFrameVisible = (source: ShotStateSource): boolean => sameSet(firstFrameVisibleIds(source), source.cast)

export function withFields(doc: ShotStateDoc, fields: FieldDecl[]): ShotStateDoc {
  return { ...doc, fields: fields.map((f) => ({ ...f })) }
}
