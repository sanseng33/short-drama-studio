/** PK-05：把各集台词审计汇总进项目（不写回对白，不阻断生成）。 */
import type { AcceptedRisk, CheckFinding, DialogueAuditSnapshot } from './types'
import { refreshStale, staleFindings } from './stale'
import {
  buildFingerprints,
  charactersLookHash,
  factsHash,
  locationsHash,
  scriptHash,
  shotsHash,
} from './fingerprint'
import { auditEpisodeDialogue, buildDialogueAuditSnapshot } from '../dialogueAudit'
import type { Project, Shot } from '../../types'
import { auditAssets } from '../assetAudit'

export function collectFindings(project: Project): CheckFinding[] {
  const out: CheckFinding[] = []
  for (const snap of Object.values(project.dialogueAudit || {})) {
    if (snap?.findings) out.push(...snap.findings)
  }
  out.push(...staleFindings(project))
  out.push(...auditAssets(project))
  return out
}

export function applyDialogueAuditToProject(
  project: Project,
  episode: number,
  opts?: { previousShots?: Shot[] },
): Project {
  const script = project.scripts?.[episode]
  const shots = project.storyboards?.[episode] || []
  const result = auditEpisodeDialogue(script, shots, project.characters, project.acceptedRisks, {
    episode,
    previousShots: opts?.previousShots,
  })
  const snapshot: DialogueAuditSnapshot = buildDialogueAuditSnapshot(result, script?.fullText || '', shots)
  const dialogueAudit = { ...(project.dialogueAudit || {}), [episode]: snapshot }
  // 只记录本集复核时的基线；项目级 factsHash / locationsHash / charactersLookHash 保持不动，
  // 否则其他尚未复核的集会因同一批上游变更而被悄悄清掉过时标记。无指纹时按当前设定补项目级基线。
  const prev = project.fingerprints || buildFingerprints(project)
  const fingerprints = {
    ...prev,
    scriptHashByEpisode: {
      ...(prev.scriptHashByEpisode || {}),
      [episode]: scriptHash(script?.fullText || ''),
    },
    factsHashByEpisode: { ...(prev.factsHashByEpisode || {}), [episode]: factsHash(project.settingFacts) },
    locationsHashByEpisode: { ...(prev.locationsHashByEpisode || {}), [episode]: locationsHash(project.locations) },
    charactersLookHashByEpisode: {
      ...(prev.charactersLookHashByEpisode || {}),
      [episode]: charactersLookHash(project.characters),
    },
  }
  void shotsHash
  return refreshStale({ ...project, dialogueAudit, fingerprints })
}

export function applyDialogueAuditAll(project: Project): Project {
  const episodes = new Set<number>([
    ...Object.keys(project.scripts || {}).map(Number),
    ...Object.keys(project.storyboards || {}).map(Number),
  ])
  let next = project
  for (const ep of [...episodes].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)) {
    next = applyDialogueAuditToProject(next, ep)
  }
  return next
}

export function episodeAudit(project: Project, episode: number): DialogueAuditSnapshot | undefined {
  return project.dialogueAudit?.[episode]
}

export function acceptedRisksOf(project: Project): AcceptedRisk[] {
  return Array.isArray(project.acceptedRisks) ? project.acceptedRisks : []
}
