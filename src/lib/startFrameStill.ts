/**
 * First-class start-frame still binding for a shot, and the export-time consistency gate that
 * compares the still's declared inventory with visual / camera / size / seedancePrompt / startState.
 * Bytes are never persisted on export; sha256 or an external file declaration binds the still.
 */
import { isSha256Hex, sha256Hex } from './contentHash'
import {
  conflictingAnchors,
  extractAnchors,
  inventoryToText,
  shotAnchorText,
  type AnchorConflict,
} from './sceneAnchors'

export interface StartFrameInventory {
  text?: string
  decor?: string[]
  size?: string
  camera?: string
  staging?: string[]
}

export interface StartFrameStill {
  sha256?: string
  width?: number
  height?: number
  /** logical name or external path / URL declaration */
  source?: string
  origin?: 'local_computed' | 'imported_manifest' | 'external_unverified'
  inventory?: StartFrameInventory | string
  /** caller-held bytes only; never written to an export pack */
  bytes?: Uint8Array
}

export interface StartFrameConflict extends AnchorConflict {
  shotId: string
  episode?: number
}

export function isBoundStartFrameStill(still: StartFrameStill | null | undefined): boolean {
  if (!still || typeof still !== 'object') return false
  if (still.sha256 && isSha256Hex(still.sha256)) return true
  if (typeof still.source === 'string' && still.source.trim()) return true
  return false
}

export function normalizeStartFrameStill(raw: StartFrameStill): StartFrameStill {
  const out: StartFrameStill = { ...raw }
  if (raw.bytes) {
    const computed = sha256Hex(raw.bytes)
    if (raw.sha256 && raw.sha256 !== computed) {
      throw new Error('startFrameStill.sha256 与文件字节不一致')
    }
    out.sha256 = computed
    out.origin = 'local_computed'
    delete out.bytes
  } else if (raw.sha256 && !isSha256Hex(raw.sha256)) {
    throw new Error('startFrameStill.sha256 必须是 64 位小写十六进制')
  }
  return out
}

/** Export form: binding as given, minus any bytes. */
export function exportStartFrameStill(still: StartFrameStill): StartFrameStill {
  const n = normalizeStartFrameStill(still)
  const { bytes: _drop, ...rest } = n
  return rest
}

export function startFrameConflicts(shot: {
  id?: string
  visual?: string
  camera?: string
  size?: string
  seedancePrompt?: string
  prompt?: string
  action?: string
  startState?: unknown
  startFrameStill?: StartFrameStill | null
}): AnchorConflict[] {
  const still = shot.startFrameStill
  if (!isBoundStartFrameStill(still || undefined)) return []
  const inv = inventoryToText(still!.inventory)
  if (!inv.trim()) return []
  return conflictingAnchors(extractAnchors(inv), extractAnchors(shotAnchorText(shot)))
}

export function evaluateStartFrameConsistency(
  project: { storyboards?: Record<string | number, Array<{ id: string; visual?: string; camera?: string; size?: string; seedancePrompt?: string; action?: string; startState?: unknown; startFrameStill?: StartFrameStill | null }>> },
): { ok: true; conflicts: [] } | { ok: false; conflicts: StartFrameConflict[] } {
  const conflicts: StartFrameConflict[] = []
  for (const [k, shots] of Object.entries(project.storyboards || {})) {
    const episode = Number(k)
    for (const s of shots || []) {
      for (const c of startFrameConflicts(s)) {
        conflicts.push({ ...c, shotId: s.id, episode: Number.isFinite(episode) ? episode : undefined })
      }
    }
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true, conflicts: [] }
}

export function formatStartFrameConflicts(conflicts: StartFrameConflict[]): string[] {
  return conflicts.map((c) => `${c.shotId}${c.episode ? `（第${c.episode}集）` : ''}：起幅静帧与正文${c.detail}`)
}

/** True when this shot already binds a start-frame still (blocks FL2V carry). */
export function shotHasBoundStartFrame(s: { startFrameStill?: StartFrameStill | null }): boolean {
  return isBoundStartFrameStill(s.startFrameStill || undefined)
}
