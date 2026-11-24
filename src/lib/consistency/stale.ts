/** PK-07：根据指纹判断分镜是否过时。设定事实/场景表/角色外观按集比较（按集基线优先，缺省用项目级基线）。无指纹则为未知，不显示过时（useProject 在首次修改前用 ensureFingerprints 补基线）。不清空分镜。 */
import type { CheckFinding, Project, StaleReason } from '../../types'
import { buildFingerprints, charactersLookHash, factsHash, locationsHash, scriptHash } from './fingerprint'

export function computeStoryboardStale(project: Project): Record<number, StaleReason> {
  const fp = project.fingerprints
  if (!fp) return {}
  const out: Record<number, StaleReason> = {}
  const episodes = new Set<number>()
  for (const k of Object.keys(project.storyboards || {})) {
    const n = Number(k)
    if (Number.isFinite(n) && project.storyboards[n]?.length) episodes.add(n)
  }
  const curFacts = factsHash(project.settingFacts)
  const curLoc = locationsHash(project.locations)
  const curLook = charactersLookHash(project.characters)
  for (const ep of [...episodes].sort((a, b) => a - b)) {
    // 每集优先用自己上次复核时的设定基线，没有则用项目级基线
    const factsBase = fp.factsHashByEpisode?.[ep] ?? fp.factsHash
    const locBase = fp.locationsHashByEpisode?.[ep] ?? fp.locationsHash
    const lookBase = fp.charactersLookHashByEpisode?.[ep] ?? fp.charactersLookHash
    const factsChanged = typeof factsBase === 'string' && factsBase !== curFacts
    const locChanged = typeof locBase === 'string' && locBase !== curLoc
    const lookChanged = typeof lookBase === 'string' && lookBase !== curLook
    const baseline = fp.scriptHashByEpisode?.[ep]
    if (typeof baseline === 'string') {
      const cur = scriptHash(project.scripts?.[ep]?.fullText || '')
      if (cur !== baseline) {
        out[ep] = 'script'
        continue
      }
    }
    if (factsChanged) {
      out[ep] = 'facts'
      continue
    }
    if (locChanged) {
      out[ep] = 'locations'
      continue
    }
    if (lookChanged) out[ep] = 'characters'
  }
  return out
}

/**
 * 没有指纹基线的项目（示例、空白、旧存档）永远算不出过时。
 * 在第一次上游修改之前调用，把「修改前」的设定记为基线；已有指纹时原样返回，不覆盖审计写入的基线。
 */
export function ensureFingerprints(project: Project): Project {
  if (project.fingerprints) return project
  return { ...project, fingerprints: buildFingerprints(project) }
}

export function refreshStale(project: Project): Project {
  const storyboards = computeStoryboardStale(project)
  const has = Object.keys(storyboards).length > 0
  if (!has && !project.stale) return project
  if (!has) {
    const next = { ...project.stale, storyboards: undefined }
    const empty = !next.storyboards && Object.values(next).every((v) => v == null)
    return { ...project, stale: empty ? undefined : next }
  }
  return { ...project, stale: { ...project.stale, storyboards } }
}

export function staleMessage(reason: StaleReason): string {
  if (reason === 'script') return '剧本已改，分镜可能过时'
  if (reason === 'facts') return '设定事实已改，分镜可能过时'
  if (reason === 'locations') return '场景表已改，分镜可能过时'
  return '角色外观已改，分镜可能过时'
}

export function staleFindings(project: Project): CheckFinding[] {
  const map = project.stale?.storyboards || {}
  return Object.entries(map).map(([ep, reason]) => ({
    id: `stale-${ep}-${reason}`,
    code: 'stale_storyboard',
    severity: 'warning' as const,
    episode: Number(ep),
    message: staleMessage(reason),
    evidence: reason,
  }))
}
