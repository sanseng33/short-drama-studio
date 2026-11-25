/**
 * 入口接线用：对一集旧 Shot 做 compat 迁移 + 校验，只产出记录，不改 Shot，不抛错。
 * 记录挂在 generateStoryboardChecked 返回值的可选字段上，并映射为 collectFindings 的 CheckFinding。
 */
import type { Shot } from '../../types'
import type { CheckFinding } from '../consistency/types'
import { migrateLegacyShot, type CharLike } from './migrate'
import { validateShotState } from './validate'
import { SHOT_STATE_SPEC, type ShotStateIssue, type ShotStateReport } from './types'

export interface ShotStateEpisodeRecord {
  spec: typeof SHOT_STATE_SPEC
  mode: 'compat'
  episode?: number
  shotCount: number
  /** compat 下结构无 error 的镜头数 */
  okCount: number
  /** 首帧存在 unverified 角色的镜头数（compat 迁移的预期状态） */
  unverifiedShotCount: number
  /** 因内部异常无法记录的镜头 id（记录本身不得影响调用方） */
  failedShotIds: string[]
  reports: ShotStateReport[]
}

export function recordShotStates(shots: readonly Shot[] | undefined | null, chars: readonly CharLike[], opts: { episode?: number } = {}): ShotStateEpisodeRecord {
  const reports: ShotStateReport[] = []
  const failedShotIds: string[] = []
  const list = Array.isArray(shots) ? shots : []
  for (const shot of list) {
    try {
      reports.push(validateShotState(migrateLegacyShot(shot, chars), 'compat'))
    } catch {
      failedShotIds.push(String((shot as { id?: unknown } | null)?.id ?? ''))
    }
  }
  return {
    spec: SHOT_STATE_SPEC,
    mode: 'compat',
    ...(opts.episode !== undefined ? { episode: opts.episode } : {}),
    shotCount: list.length,
    okCount: reports.filter((r) => r.ok).length,
    unverifiedShotCount: reports.filter((r) => r.unverifiedCharacterIds.length > 0).length,
    failedShotIds,
    reports,
  }
}

const SEV: Record<ShotStateIssue['severity'], CheckFinding['severity']> = { error: 'warning', warning: 'warning', info: 'info' }

/** 把一集记录映射为 CheckFinding。compat 记录最高只到 warning，不触发任何闸门。 */
export function shotStateFindings(rec: ShotStateEpisodeRecord): CheckFinding[] {
  const out: CheckFinding[] = []
  const ep = rec.episode
  for (const r of rec.reports) {
    for (const i of r.issues) {
      // 迁移期预期的 unverified / 未审查散文并入下方汇总，不逐条刷屏
      if (i.code === 'firstframe_unverified' || i.code === 'semantic_unknown' || i.code === 'semantic_review_required') continue
      out.push({
        id: `shot_state-${ep ?? 'x'}-${r.shotId}-${i.code}-${i.characterId || i.field || ''}`,
        code: `shot_state_${i.code}`,
        severity: SEV[i.severity],
        ...(ep !== undefined ? { episode: ep } : {}),
        shotId: r.shotId,
        ...(i.characterId ? { characterId: i.characterId } : {}),
        message: i.message,
        confidence: i.confidence === 'unknown' ? 'unknown' : 'definite',
      })
    }
  }
  const unverifiedShots = rec.reports.filter((r) => r.unverifiedCharacterIds.length > 0)
  const unreviewed = rec.reports.filter((r) => r.semantic.status === 'unknown' || r.semantic.status === 'review_required')
  if (unverifiedShots.length || unreviewed.length) {
    out.push({
      id: `shot_state-${ep ?? 'x'}-compat_unverified`,
      code: 'shot_state_compat_unverified',
      severity: 'info',
      ...(ep !== undefined ? { episode: ep } : {}),
      message: `兼容模式：${unverifiedShots.length} 镜首帧可见性未核验，${unreviewed.length} 镜散文未经语义审查（unknown，不是矛盾；不可直接 run-ready）`,
      confidence: 'unknown',
    })
  }
  if (rec.failedShotIds.length) {
    out.push({
      id: `shot_state-${ep ?? 'x'}-record_failed`,
      code: 'shot_state_record_failed',
      severity: 'info',
      ...(ep !== undefined ? { episode: ep } : {}),
      message: `${rec.failedShotIds.length} 镜无法生成 shot-state 记录`,
      confidence: 'unknown',
    })
  }
  return out
}

/** 项目各集分镜的 compat 记录 -> findings。不抛错。 */
export function collectShotStateFindings(project: { characters?: readonly CharLike[]; storyboards?: Record<number, Shot[]> }): CheckFinding[] {
  const out: CheckFinding[] = []
  try {
    const eps = Object.keys(project.storyboards || {}).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
    for (const ep of eps) {
      const rec = recordShotStates(project.storyboards?.[ep], project.characters || [], { episode: ep })
      out.push(...shotStateFindings(rec))
    }
  } catch {
    // 记录是附加信息，任何异常都不影响原有 findings
  }
  return out
}
