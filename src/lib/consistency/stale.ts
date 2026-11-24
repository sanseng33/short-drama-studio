/** PK-07：根据指纹判断分镜是否过时。无指纹则为未知，不显示过时。不清空分镜。 */
import type { CheckFinding, Project, StaleReason } from '../../types'
import { charactersLookHash, factsHash, locationsHash, scriptHash } from './fingerprint'

export function computeStoryboardStale(project: Project): Record<number, StaleReason> {
  const fp = project.fingerprints
  if (!fp) return {}
  const out: Record<number, StaleReason> = {}
  const episodes = new Set<number>()
  for (const k of Object.keys(project.storyboards || {})) {
    const n = Number(k)
    if (Number.isFinite(n) && project.storyboards[n]?.length) episodes.add(n)
  }
  const factsChanged = typeof fp.factsHash === 'string' && fp.factsHash !== factsHash(project.settingFacts)
  const locChanged = typeof fp.locationsHash === 'string' && fp.locationsHash !== locationsHash(project.locations)
  const lookChanged = typeof fp.charactersLookHash === 'string' && fp.charactersLookHash !== charactersLookHash(project.characters)
  for (const ep of [...episodes].sort((a, b) => a - b)) {
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
