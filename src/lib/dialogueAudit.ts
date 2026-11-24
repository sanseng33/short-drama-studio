/** 剧本到分镜的台词完整性审计（PK-03）。纯函数，不写回对白，不调用模型。 */
import type { AcceptedRisk, CheckFinding, DialogueAuditSnapshot } from './consistency/types'
import { diceBigram, findingTargetKey, normalizeDialogueKey } from './consistency/dialogueNormalize'
import { scriptHash, shotsHash } from './consistency/fingerprint'
import {
  parseScriptDialogue,
  parseShotDialogueLines,
  type ParsedDialogueLine,
} from './scriptDialogue'
import type { Character, ScriptBeat, Shot } from '../types'

export const DICE_PARAPHRASE = 0.6
export const DICE_REVIEW = 0.35
export const COVER_MIN_KEY = 4
export const SHORT_KEY = 4
export const MIN_DEFINITE_KEY = 2

export interface AuditEpisodeInput {
  fullText?: string
  beats?: ScriptBeat[]
  episode?: number
}

export interface AuditEpisodeResult {
  status: DialogueAuditSnapshot['status']
  findings: CheckFinding[]
  definiteMissing: CheckFinding[]
  definiteMissingCount: number
}

type ALine = ParsedDialogueLine & { idx: number; used: boolean }
type BLine = ParsedDialogueLine & { idx: number; used: boolean }

function deepClone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

function isAccepted(risks: AcceptedRisk[] | undefined, code: string, episode: number, lineKey: string, occurrence: number): boolean {
  if (!Array.isArray(risks) || !risks.length) return false
  const target = findingTargetKey(code, episode, lineKey, occurrence)
  return risks.some((r) => r.targetKey === target || (r.code === code && r.episode === episode && r.targetKey === target))
}

function mkFinding(
  code: string,
  severity: CheckFinding['severity'],
  confidence: NonNullable<CheckFinding['confidence']>,
  line: { key: string; text: string; occurrence: number; shotId?: string; speaker?: string | null },
  episode: number,
  extra: Partial<CheckFinding> = {},
): CheckFinding {
  const targetKey = findingTargetKey(code, episode, line.key, line.occurrence)
  return {
    id: targetKey,
    code,
    severity,
    episode,
    message: extra.message || line.text,
    evidence: extra.evidence,
    confidence,
    targetKey,
    shotId: extra.shotId || line.shotId,
    ...omitUndef({ characterId: extra.characterId }),
  }
}

function omitUndef<T extends Record<string, unknown>>(o: T): T {
  const out = { ...o }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

/** 最大 LCS（仅键相等）。在不缩短 LCS 的前提下从左到右消耗靠前的 A，并配最靠前的合法 B。 */
function markLcs(A: ALine[], B: BLine[]): void {
  const n = A.length
  const m = B.length
  const suf: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (A[i].key && A[i].key === B[j].key) suf[i][j] = suf[i + 1][j + 1] + 1
      else suf[i][j] = Math.max(suf[i + 1][j], suf[i][j + 1])
    }
  }
  let jptr = 0
  for (let i = 0; i < n; i++) {
    if (!A[i].key) continue
    let found = -1
    for (let k = jptr; k < m; k++) {
      if (A[i].key === B[k].key && suf[i][jptr] === suf[i + 1][k + 1] + 1) {
        found = k
        break
      }
    }
    if (found >= 0) {
      A[i].used = true
      B[found].used = true
      jptr = found + 1
    }
  }
}

function unused<T extends { used: boolean }>(list: T[]): T[] {
  return list.filter((x) => !x.used)
}

export function auditEpisodeDialogue(
  script: AuditEpisodeInput | string | null | undefined,
  shots: unknown,
  characters?: Character[] | null,
  acceptedRisks?: AcceptedRisk[] | null,
  opts?: { previousShots?: unknown; episode?: number },
): AuditEpisodeResult {
  const scriptCopy = deepClone(script)
  const shotsCopy = deepClone(shots)
  const prevCopy = opts?.previousShots !== undefined ? deepClone(opts.previousShots) : undefined

  const episode =
    opts?.episode ??
    (typeof script === 'object' && script && typeof script.episode === 'number' ? script.episode : 1)

  const scriptObj =
    typeof scriptCopy === 'string' ? { fullText: scriptCopy, episode } : scriptCopy || { fullText: '' }

  const hasScriptText = !!(scriptObj.fullText && String(scriptObj.fullText).trim()) || (Array.isArray(scriptObj.beats) && scriptObj.beats.some((b) => b?.dialogue && String(b.dialogue).trim()))

  const parsedA = parseScriptDialogue(scriptObj)
  const parsedB = parseShotDialogueLines(shotsCopy, characters || [])

  const emptyShots = !Array.isArray(shotsCopy) || shotsCopy.length === 0

  if (!hasScriptText && parsedA.lines.length === 0 && parsedA.unparseable.length === 0) {
    return { status: 'no_script', findings: [], definiteMissing: [], definiteMissingCount: 0 }
  }
  if (hasScriptText && emptyShots) {
    return { status: 'no_storyboard', findings: [], definiteMissing: [], definiteMissingCount: 0 }
  }

  const findings: CheckFinding[] = []

  if (parsedA.unparseable.length || parsedB.unparseable.length) {
    for (const u of parsedA.unparseable) {
      findings.push({
        id: findingTargetKey('dialogue_unparseable', episode, normalizeLoose(u.raw), 1),
        code: 'dialogue_unparseable',
        severity: 'warning',
        episode,
        message: u.raw,
        evidence: u.evidence,
        confidence: 'unknown',
      })
    }
    for (const u of parsedB.unparseable) {
      findings.push({
        id: findingTargetKey('dialogue_unparseable', episode, u.shotId || 'shot', 1),
        code: 'dialogue_unparseable',
        severity: 'warning',
        episode,
        message: '',
        evidence: u.evidence,
        confidence: 'unknown',
        shotId: u.shotId,
      })
    }
  }

  const noParsedA = parsedA.lines.length === 0
  if (noParsedA && (parsedA.unparseable.length || !hasScriptText === false)) {
    // 有正文但没有台词行（可能只有标题/动作或 P6）
    if (hasScriptText && parsedA.lines.length === 0) {
      const already = findings.some((f) => f.code === 'dialogue_unparseable')
      if (!already) {
        findings.push({
          id: findingTargetKey('dialogue_unparseable', episode, '', 1),
          code: 'dialogue_unparseable',
          severity: 'warning',
          episode,
          message: '',
          evidence: '没有任何可解析台词行',
          confidence: 'unknown',
        })
      }
      return finalize('unparseable', findings, acceptedRisks || [], episode)
    }
  }

  if (parsedB.unparseable.length || (parsedA.unparseable.length && parsedA.lines.length === 0)) {
    return finalize('unparseable', findings, acceptedRisks || [], episode)
  }

  // 有 P6 但同时也解析出了台词：C8 说存在 P6 则 status unparseable。F18 只有 P6。
  // 若同时有可解析行与 P6，仍标 unparseable，且不计 definite（C3 要求无解析失败）。
  const scriptUnparseable = parsedA.unparseable.length > 0

  const A: ALine[] = parsedA.lines.map((l, idx) => ({ ...l, idx, used: false }))
  const B: BLine[] = parsedB.lines.map((l, idx) => ({ ...l, idx, used: false }))

  markLcs(A, B)

  // M2 顺序变化：未匹配集合里键相同者配对
  const aLeft = unused(A)
  const bLeft = unused(B)
  const bByKey = new Map<string, BLine[]>()
  for (const b of bLeft) {
    const arr = bByKey.get(b.key) || []
    arr.push(b)
    bByKey.set(b.key, arr)
  }
  for (const a of aLeft) {
    const arr = bByKey.get(a.key) || []
    const b = arr.find((x) => !x.used)
    if (!b) continue
    a.used = true
    b.used = true
    findings.push(
      enrich(
        mkFinding('dialogue_order_changed', 'warning', 'definite', a, episode, { evidence: 'M2 内容完整但顺序变化' }),
        a,
      ),
    )
  }

  // M3 覆盖：仅 key 长度 >= 4。先枚举 B 的连续 1–3 行窗口，再把能被该窗口覆盖的全部 A 一次性标为已覆盖。
  type Cover = { a: ALine[]; b: BLine[]; kind: 'split' | 'merge' }
  const unmatchedB0 = unused(B).sort((x, y) => x.idx - y.idx)
  const windows: { b: BLine[]; key: string }[] = []
  for (let i = 0; i < unmatchedB0.length; i++) {
    for (let len = 1; len <= 3; len++) {
      const slice = unmatchedB0.slice(i, i + len)
      if (slice.length < len) continue
      const contiguous = slice.every((x, k) => k === 0 || x.idx === slice[k - 1].idx + 1)
      if (!contiguous) continue
      windows.push({ b: slice, key: slice.map((r) => r.key).join('') })
    }
  }
  // 先看更长的窗口，避免一行先占用后拆不开
  windows.sort((x, y) => y.b.length - x.b.length || x.b[0].idx - y.b[0].idx)

  const grouped: Cover[] = []
  for (const w of windows) {
    if (w.b.some((b) => b.used)) continue
    const splitAs: ALine[] = []
    const mergeAs: ALine[] = []
    for (const a of unused(A)) {
      if ([...a.key].length < COVER_MIN_KEY) continue
      if (a.key === w.key && w.b.length >= 2) splitAs.push(a)
      else if (a.key !== w.key && w.key.includes(a.key)) mergeAs.push(a)
    }
    if (splitAs.length) {
      for (const a of splitAs) a.used = true
      for (const b of w.b) b.used = true
      grouped.push({ a: splitAs, b: w.b, kind: 'split' })
    } else if (mergeAs.length) {
      for (const a of mergeAs) a.used = true
      for (const b of w.b) b.used = true
      grouped.push({ a: mergeAs, b: w.b, kind: 'merge' })
    }
  }
  for (const c of grouped) {
    const shotIds = [...new Set(c.b.map((b) => b.shotId).filter(Boolean))] as string[]
    if (c.kind === 'split') {
      for (const a of c.a) {
        findings.push(
          enrich(
            mkFinding('dialogue_split', 'info', 'definite', a, episode, {
              evidence: `M3 跨镜拆句：${shotIds.join(', ')}`,
              shotId: shotIds[0],
            }),
            a,
            shotIds,
          ),
        )
      }
    } else {
      const mergedText = c.b.map((b) => b.text).join('')
      findings.push(
        enrich(
          mkFinding(
            'dialogue_merged',
            'warning',
            'definite',
            { ...c.b[0], occurrence: c.a[0]?.occurrence || 1, text: mergedText, key: c.b[0].key },
            episode,
            { evidence: 'M3 合句，内容已覆盖', shotId: shotIds[0] },
          ),
          { ...c.a[0], text: mergedText },
          shotIds,
        ),
      )
      const speakersA = new Set(c.a.map((a) => a.speakerNorm).filter(Boolean))
      const speakersB = new Set(c.b.map((b) => b.speakerNorm).filter(Boolean))
      const mismatch = [...speakersA].some((s) => s && !speakersB.has(s)) || speakersA.size > 1
      if (mismatch) {
        const victim = c.a.find((a) => a.speakerNorm && !speakersB.has(a.speakerNorm)) || c.a[0]
        findings.push(
          enrich(
            mkFinding('speaker_unresolved', 'warning', 'fuzzy', victim, episode, {
              evidence: '跨说话人合句或说话人不一致',
            }),
            victim,
          ),
        )
      }
    }
  }

  // 截断特例（优先于模糊配对）
  for (const a of unused(A)) {
    if ([...a.key].length < MIN_DEFINITE_KEY) continue
    for (const b of unused(B)) {
      if (b.key && a.key !== b.key && (a.key.startsWith(b.key) || a.key.endsWith(b.key))) {
        const ratio = [...b.key].length / [...a.key].length
        if (ratio < 0.6) {
          const ev = a.key.startsWith(b.key) ? '仅保留前缀' : '仅保留后缀'
          a.used = true
          b.used = true
          findings.push(enrich(mkFinding('dialogue_missing', 'error', 'definite', a, episode, { evidence: ev }), a))
          break
        }
      }
    }
  }

  // M4 模糊一对一（key 长度 >= 4）
  const fuzzyPairs: { a: ALine; b: BLine; score: number }[] = []
  for (const a of unused(A)) {
    if ([...a.key].length < SHORT_KEY) continue
    for (const b of unused(B)) {
      if ([...b.key].length < SHORT_KEY && [...a.key].length >= SHORT_KEY) {
        // 仍允许与短 B 计算，但 M5 说长度小于 4 不做 M4
      }
      if ([...b.key].length < SHORT_KEY) continue
      const score = diceBigram(a.key, b.key)
      if (score >= DICE_REVIEW) fuzzyPairs.push({ a, b, score })
    }
  }
  fuzzyPairs.sort((x, y) => y.score - x.score || x.a.idx - y.a.idx || x.b.idx - y.b.idx)
  for (const p of fuzzyPairs) {
    if (p.a.used || p.b.used) continue
    p.a.used = true
    p.b.used = true
    if (p.score >= DICE_PARAPHRASE) {
      findings.push(enrich(mkFinding('dialogue_paraphrased', 'warning', 'fuzzy', p.a, episode, { evidence: `Dice ${p.score.toFixed(2)}` }), p.a))
    } else {
      findings.push(enrich(mkFinding('dialogue_needs_review', 'warning', 'fuzzy', p.a, episode, { evidence: `Dice ${p.score.toFixed(2)}` }), p.a))
    }
    if (p.a.speakerNorm && p.b.speakerNorm && p.a.speakerNorm !== p.b.speakerNorm) {
      findings.push(enrich(mkFinding('speaker_unresolved', 'warning', 'fuzzy', p.a, episode, { evidence: '模糊配对说话人不一致' }), p.a))
    }
  }

  // 剩余 A：缺失或短句待复核
  const leftoverB = unused(B)
  for (const a of unused(A)) {
    a.used = true
    const keyLen = [...a.key].length
    if (keyLen < MIN_DEFINITE_KEY) {
      findings.push(enrich(mkFinding('dialogue_needs_review', 'warning', 'fuzzy', a, episode, { evidence: 'C4 key 长度小于 2，恒为待复核' }), a))
      continue
    }
    const canDefinite =
      !scriptUnparseable &&
      parsedB.unparseable.length === 0 &&
      keyLen >= MIN_DEFINITE_KEY &&
      (keyLen < SHORT_KEY ? leftoverB.length === 0 : leftoverB.every((b) => diceBigram(a.key, b.key) < DICE_REVIEW))
    if (canDefinite) {
      findings.push(enrich(mkFinding('dialogue_missing', 'error', 'definite', a, episode), a))
    } else {
      findings.push(enrich(mkFinding('dialogue_needs_review', 'warning', 'fuzzy', a, episode, { evidence: '未达到确定缺词条件，待复核' }), a))
      // 导致其不能定缺的近邻 B 行视为同一复核对，不再记 extra
      let best: BLine | null = null
      let bestScore = DICE_REVIEW
      for (const b of leftoverB) {
        if (b.used) continue
        const sc = diceBigram(a.key, b.key)
        if (sc >= bestScore) {
          best = b
          bestScore = sc
        }
      }
      if (best) best.used = true
    }
  }

  // 剩余 B：extra
  for (const b of unused(B)) {
    b.used = true
    findings.push(enrich(mkFinding('dialogue_extra', 'info', 'definite', b, episode, { shotId: b.shotId, evidence: '分镜多出或非台词文本' }), b))
  }

  // C5 修复丢词
  if (opts?.previousShots !== undefined) {
    const before = auditEpisodeDialogue(scriptCopy, prevCopy, characters, acceptedRisks, { episode })
    const beforeMatchedKeys = new Set(
      // 用「修复前不是 missing/unparseable/needs_review-only-unmatched」更好：
      // 简化：对 previous shots 再跑一遍，收集被 LCS/覆盖/改写消耗的 A keys+occurrence
    )
    // 重新用 previous 的匹配集合：before 结果里没有 missing 的脚本行视为已匹配
    const missingNow = findings.filter((f) => f.code === 'dialogue_missing' && f.confidence === 'definite')
    const prevMissing = new Set(before.findings.filter((f) => f.code === 'dialogue_missing' || f.code === 'dialogue_dropped_silent').map((f) => `${f.targetKey}`))
    // 更好：previous 审计中出现在 split/merge/paraphrased/order/不在 missing 的 line
    const prevPresent = previousMatchedOccurrences(scriptCopy, prevCopy, characters || [], episode)
    for (const f of missingNow) {
      const lineKey = keyFromFinding(f)
      const occ = occFromFinding(f, A)
      const ident = `${lineKey}#${occ}`
      if (prevPresent.has(ident)) {
        f.code = 'dialogue_dropped_silent'
        f.evidence = f.evidence || '修复前已匹配，修复后确定缺失且未被接受'
        f.id = findingTargetKey('dialogue_dropped_silent', episode, lineKey, occ)
        f.targetKey = f.id
      }
    }
    void beforeMatchedKeys
    void prevMissing
  }

  const status: DialogueAuditSnapshot['status'] = scriptUnparseable || parsedB.unparseable.length ? 'unparseable' : 'checked'
  // 存在 P6 但还有可解析行时：C8 要求 unparseable，且不计 definite —— 将 definite missing 降为 review
  if (status === 'unparseable') {
    for (const f of findings) {
      if (f.code === 'dialogue_missing' && f.confidence === 'definite') {
        f.code = 'dialogue_needs_review'
        f.severity = 'warning'
        f.confidence = 'fuzzy'
        f.evidence = (f.evidence || '') + '（剧本或分镜存在不可解析行，不计 definite）'
      }
    }
  }

  return finalize(status, findings, acceptedRisks || [], episode)
}

function normalizeLoose(s: string): string {
  return (s || '').slice(0, 32)
}

function enrich(f: CheckFinding, line: ParsedDialogueLine, shotIds?: string[]): CheckFinding {
  const extra: CheckFinding & { lineText?: string; occurrence?: number; shotIds?: string[] } = f
  extra.lineText = line.text
  extra.occurrence = line.occurrence
  if (shotIds && shotIds.length) extra.shotIds = shotIds
  extra.message = extra.message || line.text
  return extra
}

function keyFromFinding(f: CheckFinding & { lineText?: string }): string {
  const ext = f as CheckFinding & { lineText?: string }
  // targetKey 无法逆出，使用 message/lineText 的 key 在调用处
  return ext.lineText || f.message
}

function occFromFinding(f: CheckFinding, _A: ALine[]): number {
  const ext = f as CheckFinding & { occurrence?: number }
  return ext.occurrence || 1
}

function previousMatchedOccurrences(
  script: AuditEpisodeInput | string | null | undefined,
  previousShots: unknown,
  characters: Character[],
  episode: number,
): Set<string> {
  const parsedA = parseScriptDialogue(typeof script === 'string' ? { fullText: script, episode } : script)
  const result = auditEpisodeDialogue(script, previousShots, characters, [], { episode })
  const missing = new Set(
    result.findings
      .filter((f) => f.code === 'dialogue_missing' || f.code === 'dialogue_dropped_silent')
      .map((f) => `${(f as CheckFinding & { lineText?: string }).lineText || f.message}#${(f as CheckFinding & { occurrence?: number }).occurrence || 1}`),
  )
  const out = new Set<string>()
  for (const l of parsedA.lines) {
    const ident = `${l.text}#${l.occurrence}`
    const identKey = `${l.key}#${l.occurrence}`
    if (!missing.has(ident) && !missing.has(`${l.text}#${l.occurrence}`)) {
      // 也排除 unparseable-only 情况
      out.add(ident)
      out.add(identKey)
    }
  }
  return out
}

function finalize(
  status: DialogueAuditSnapshot['status'],
  findings: CheckFinding[],
  risks: AcceptedRisk[],
  episode: number,
): AuditEpisodeResult {
  const marked = findings.map((f) => {
    const ext = f as CheckFinding & { accepted?: boolean; lineText?: string; occurrence?: number }
    const lineKey = needKey(ext)
    const occ = ext.occurrence || 1
    if (f.targetKey && isAccepted(risks, f.code, episode, lineKey, occ)) {
      ext.accepted = true
    } else if (isAccepted(risks, f.code, episode, lineKey, occ)) {
      ext.accepted = true
    }
    return ext
  })
  const definiteMissing = marked.filter(
    (f) =>
      (f.code === 'dialogue_missing' || f.code === 'dialogue_dropped_silent') &&
      f.confidence === 'definite' &&
      !(f as CheckFinding & { accepted?: boolean }).accepted,
  )
  return { status, findings: marked, definiteMissing, definiteMissingCount: definiteMissing.length }
}

function needKey(f: CheckFinding & { lineText?: string }): string {
  const text = f.lineText || f.message || ''
  return normalizeDialogueKey(text)
}

export function hasDefiniteMissing(findings: CheckFinding[], acceptedRisks?: AcceptedRisk[] | null, episode = 1): boolean {
  return findings.some((f) => {
    if (!(f.code === 'dialogue_missing' || f.code === 'dialogue_dropped_silent')) return false
    if (f.confidence !== 'definite') return false
    if ((f as CheckFinding & { accepted?: boolean }).accepted) return false
    const ext = f as CheckFinding & { lineText?: string; occurrence?: number }
    const lineKey = needKey(ext)
    if (isAccepted(acceptedRisks || [], f.code, f.episode ?? episode, lineKey, ext.occurrence || 1)) return false
    return true
  })
}

/** 深拷贝保护：调用前后 shots / script 必须可由测试断言相等。本函数不修改入参。 */
export function buildDialogueAuditSnapshot(
  result: AuditEpisodeResult,
  scriptFullText: string,
  shots: Pick<Shot, 'shotNo' | 'dialogue'>[] | undefined,
): DialogueAuditSnapshot {
  return {
    scriptHash: scriptHash(scriptFullText),
    shotsHash: shotsHash(shots),
    status: result.status,
    findings: result.findings,
    checkedAt: new Date().toISOString(),
  }
}
