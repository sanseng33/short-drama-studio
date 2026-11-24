/** PK-08：场景表与角色外观软检查。不改写分镜、对白或导出契约。 */
import { sha1Hex } from './hash'
import { locationNamer, normalizeLocation } from './locationNorm'
import { shotCharacterIds } from './shotCast'
import type { AcceptedRisk, CheckFinding, Project, Shot } from '../types'

export function assetTargetKey(code: string, episode: number, key: string, occurrence = 1): string {
  return sha1Hex(`${code}|${episode}|${key}|${occurrence}`)
}

export function lookCandidates(...fields: (string | undefined | null)[]): string[] {
  const segs: string[] = []
  for (const f of fields) {
    if (!f) continue
    for (const part of String(f).split(/[、，,；;\s]+/)) {
      const s = part.trim()
      if (s.length >= 2) segs.push(s)
    }
  }
  const cands = new Set<string>()
  for (const seg of segs) {
    cands.add(seg)
    for (let len = 2; len <= 4 && len < seg.length; len++) cands.add(seg.slice(-len))
  }
  return [...cands].filter((c) => c.length >= 2)
}

export function canonicalizeLocations(
  lines: string[] | undefined | null,
  namer = locationNamer([]),
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of lines || []) {
    const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim()
    if (!text) continue
    const key = normalizeLocation(text, namer) || text
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function isAccepted(risks: AcceptedRisk[] | undefined, targetKey: string, code: string, episode: number): boolean {
  if (!Array.isArray(risks) || !risks.length) return false
  return risks.some((r) => r.targetKey === targetKey || (r.code === code && r.episode === episode && r.targetKey === targetKey))
}

function shotHasLook(shot: Shot, candidates: string[]): boolean {
  const blob = `${shot.visual || ''} ${shot.seedancePrompt || ''}`
  return candidates.some((c) => blob.includes(c))
}

export function auditAssets(project: Project): CheckFinding[] {
  const findings: CheckFinding[] = []
  const namer = locationNamer(project.characters || [])
  const table = (project.locations || []).map((x) => x.trim()).filter(Boolean)
  const tableKeys = new Set(table.map((t) => normalizeLocation(t, namer) || t))
  const risks = project.acceptedRisks

  for (const [k, shots] of Object.entries(project.storyboards || {})) {
    const episode = Number(k)
    if (!Number.isFinite(episode) || !Array.isArray(shots) || !shots.length) continue
    const ordered = [...shots].sort((a, b) => (a.shotNo || 0) - (b.shotNo || 0))

    if (table.length) {
      // 同一集内同一地点只出一条，附上涉及的镜头；targetKey 仍按（集, 地点）计算，忽略一次覆盖整条。
      const byLocation = new Map<string, { loc: string; shots: Shot[] }>()
      for (const s of ordered) {
        const loc = (s.location || '').trim()
        if (!loc) continue
        const key = normalizeLocation(loc, namer) || loc
        if (tableKeys.has(key)) continue
        const group = byLocation.get(key)
        if (group) group.shots.push(s)
        else byLocation.set(key, { loc, shots: [s] })
      }
      for (const [key, { loc, shots: locShots }] of byLocation) {
        const targetKey = assetTargetKey('location_not_in_table', episode, key)
        if (isAccepted(risks, targetKey, 'location_not_in_table', episode)) continue
        const nos = locShots.map((s, i) => s.shotNo || i + 1)
        findings.push({
          id: targetKey,
          code: 'location_not_in_table',
          severity: 'warning',
          episode,
          shotId: locShots[0].id,
          message: `分镜地点「${loc}」不在场景表（${locShots.length} 个镜头：${nos.map((n) => `#${n}`).join(' ')}）`,
          evidence: loc,
          confidence: 'definite',
          targetKey,
        })
      }
    }

    for (const c of project.characters || []) {
      const candidates = lookCandidates(c.costume, c.signatureProp, c.visualLock)
      if (!candidates.length) continue
      const appears = ordered.filter((s) => shotCharacterIds(s, project.characters).includes(c.id))
      if (!appears.length) continue
      const missing = appears.filter((s) => !shotHasLook(s, candidates))
      if (!missing.length) continue
      const first = appears[0]
      const firstMissing = missing[0]
      const others = missing
        .filter((s) => s.id !== (firstMissing?.id || first.id))
        .map((s) => s.shotNo)
        .slice(0, 5)
      const targetKey = assetTargetKey('character_look_not_in_shot', episode, c.id)
      if (isAccepted(risks, targetKey, 'character_look_not_in_shot', episode)) continue
      findings.push({
        id: targetKey,
        code: 'character_look_not_in_shot',
        severity: 'warning',
        episode,
        shotId: firstMissing?.id || first.id,
        characterId: c.id,
        message: `角色「${c.name}」的服装/道具/外貌要点未写入第${episode}集出场画面`,
        evidence: others.length ? `其余未写到的镜号：${others.join('、')}` : undefined,
        confidence: 'fuzzy',
        targetKey,
      })
    }
  }
  return findings
}
