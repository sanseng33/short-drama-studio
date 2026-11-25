/**
 * shot-state-ssot@0.1.0-draft 的显式 opt-in 导出（工作室侧附加包）。
 *
 * 重要边界：
 *  - 这是工作室侧附加包。H3 接收端未改，也没有声明支持这里的任何字段；不得据此认为 H3 会接收或消费。
 *  - 默认导出（buildVideoPipelineExport / projectToMarkdown / seedancePack 不带选项）完全不调用本模块。
 *  - compat 模式只记录；strict / run-ready 不满足时明确拒绝（抛 ShotStateExportRejectedError，或 try 版返回 ok:false），
 *    不吞异常、不降级成 compat、不产出自称 run-ready 的包。
 *  - 未审查散文标 unknown / 未审查；失效或陈旧的派生文本保留原文但标 withheld，不作为现行提示词输出。
 */
import type { Shot } from '../../types'
import { hashSource, hashText } from './hashing'
import {
  assertModelAdapter,
  compileModelAdapterText,
  DEFAULT_ADAPTER_TEXT_FIELDS,
  type CompiledModelAdapterText,
  type ModelAdapterSpec,
} from './adapter'
import { migrateLegacyShot, type CharLike } from './migrate'
import { COMPILER_VERSION, semanticFieldStatus, textStatus } from './texts'
import {
  SHOT_STATE_SPEC,
  type FieldDecl,
  type SemanticFieldStatus,
  type SemanticReview,
  type SemanticStatus,
  type ShotStateDoc,
  type ShotStateIssue,
  type ShotStateMode,
  type ShotStateReport,
  type ShotStateSource,
  type TextProvenance,
  type TextStatus,
} from './types'
import { validateShotState } from './validate'

export const SHOT_STATE_EXPORT_SPEC = 'shot-state-export@0.1.0-draft' as const

/** 写入每个附加包与每段 Markdown/Seedance 附段的固定声明。 */
export const H3_SUPPORT_NOTICE =
  '工作室侧 opt-in 附加包（草案）。H3 接收端未改，也未声明支持其中任何字段；不得据此认为 H3 已接收或消费。'

export interface ShotStateExportOptions {
  /** 默认 'compat'（只记录）。'strict' / 'run-ready' 不满足时拒绝。 */
  mode?: ShotStateMode
  /** 只导出某一集 */
  episode?: number
  /** 按 shot id 提供的权威状态文档；缺省时由旧 Shot 做 compat 迁移 */
  docs?: Readonly<Record<string, ShotStateDoc>>
  /** 版本化模型适配；模型特定限制只在这里 */
  adapter?: ModelAdapterSpec
}

export interface ShotStateExportProject {
  id: string
  title?: string
  characters?: readonly CharLike[]
  storyboards: Record<number, Shot[]>
}

export type ExportPresentation = 'current' | 'unreviewed' | 'withheld'

export interface ShotStateExportText {
  field: string
  /** 原文始终保留；是否可当现行提示词看 presentation / usableAsCurrentPrompt */
  text: string
  status: TextStatus
  semantic: SemanticFieldStatus
  provenance: TextProvenance
  currentTextHash: string
  currentSourceHash: string
  presentation: ExportPresentation
  usableAsCurrentPrompt: boolean
  note: string
}

export interface ShotStateExportBlocker {
  shotId: string
  layer: ShotStateIssue['layer']
  code: string
  message: string
  field?: string
  characterId?: string
  confidence: ShotStateIssue['confidence']
}

export interface ShotStateExportWarning {
  shotId?: string
  code: string
  message: string
  field?: string
}

export type ShotAdaptedEntry =
  | { field: string; status: 'compiled'; presentation: ExportPresentation; compiled: CompiledModelAdapterText }
  | { field: string; status: 'skipped'; reason: string }

export interface ShotStateExportShot {
  shotId: string
  episode: number
  shotNo: number
  docOrigin: 'provided' | 'legacy_migration'
  source: ShotStateSource
  sourceHash: string
  texts: ShotStateExportText[]
  reviews: SemanticReview[]
  review: { status: SemanticStatus; fields: { field: string; status: SemanticFieldStatus }[]; textCount: number }
  /** compat 校验结果（始终包含，不随 mode 变化） */
  compat: ShotStateReport
  /** 请求 mode 的校验结果；mode=compat 时与 compat 相同 */
  report: ShotStateReport
  fields: {
    declared: FieldDecl[]
    /** 阻断 run-ready */
    runRequiredUnsupported: string[]
    /** 只记录/警告，不代表已支持 */
    capabilityUnsupported: string[]
    ignoredDocumented: string[]
  }
  unverifiedCharacterIds: string[]
  migration?: ShotStateDoc['migration']
  adapted: ShotAdaptedEntry[]
}

export interface ShotStateExportPack {
  spec: typeof SHOT_STATE_EXPORT_SPEC
  shotStateSpec: typeof SHOT_STATE_SPEC
  compilerVersion: string
  notice: string
  h3: { receiverModified: false; receiverDeclaresSupport: false }
  mode: ShotStateMode
  projectId: string
  episode?: number
  /** 请求 mode 下所有镜头校验均无 error */
  ok: boolean
  claims: {
    /** 仅 mode=run-ready 且全部满足时为 true；其余一律 false */
    runReady: boolean
    /** 每镜语义汇总均为 pass（unknown / review_required / fail 都不是 pass） */
    semanticPass: boolean
  }
  /** 评估性信息：即使 mode=compat 也给出，不代表包自称 run-ready */
  readiness: { strictOk: boolean; runReadyEligible: boolean; runReadyBlockers: ShotStateExportBlocker[] }
  review: { status: SemanticStatus; counts: Record<SemanticStatus, number> }
  adapter?: {
    adapterId: string
    adapterVersion: string
    modelId: string
    wrapperId: string
    wrapperVersion: string
    maxPromptChars?: number
    note: string
  }
  shots: ShotStateExportShot[]
  blockers: ShotStateExportBlocker[]
  warnings: ShotStateExportWarning[]
  /** docs 中没有对应分镜的 shot id（保留记录，不静默丢弃） */
  unmatchedDocIds: string[]
  packHash: string
}

export interface ShotStateExportRejection {
  spec: typeof SHOT_STATE_EXPORT_SPEC
  mode: ShotStateMode
  reason: string
  blockers: ShotStateExportBlocker[]
  notice: string
}

export class ShotStateExportRejectedError extends Error {
  readonly rejection: ShotStateExportRejection
  constructor(rejection: ShotStateExportRejection) {
    super(rejection.reason)
    this.name = 'ShotStateExportRejectedError'
    this.rejection = rejection
  }
}

export type TryShotStateExport = { ok: true; pack: ShotStateExportPack } | { ok: false; rejection: ShotStateExportRejection }

const toBlocker = (shotId: string, i: ShotStateIssue): ShotStateExportBlocker => ({
  shotId,
  layer: i.layer,
  code: i.code,
  message: i.message,
  ...(i.field ? { field: i.field } : {}),
  ...(i.characterId ? { characterId: i.characterId } : {}),
  confidence: i.confidence,
})

const errorsOf = (shotId: string, r: ShotStateReport): ShotStateExportBlocker[] =>
  r.issues.filter((i) => i.severity === 'error').map((i) => toBlocker(shotId, i))

function describeText(doc: ShotStateDoc, t: ShotStateDoc['texts'][number], currentSourceHash: string): ShotStateExportText {
  const status = textStatus(doc, t)
  const semantic = semanticFieldStatus(doc, t)
  let presentation: ExportPresentation
  let note: string
  if (status === 'invalidated' || status === 'stale' || semantic === 'fail' || semantic === 'review_required') {
    presentation = 'withheld'
    note =
      status === 'invalidated'
        ? '派生文本已被手改（invalidated + review_required）：保留原文，不作为现行提示词'
        : status === 'stale'
          ? '派生文本与当前状态源不一致（stale）：保留原文，不作为现行提示词'
          : semantic === 'fail'
            ? '语义审查未通过：保留原文，不作为现行提示词'
            : '需要语义审查（review_required）：保留原文，不作为现行提示词'
  } else if (status === 'valid_derived' || semantic === 'pass') {
    presentation = 'current'
    note = status === 'valid_derived' ? '派生有效（模板层 hash 匹配；不是语义审查结论）' : '用户文本，已有与当前 hash 匹配的审查 pass'
  } else {
    presentation = 'unreviewed'
    note = '未经语义审查（unknown）：既不是通过，也不是已证明矛盾'
  }
  return {
    field: t.field,
    text: t.text,
    status,
    semantic,
    provenance: { ...t.provenance },
    currentTextHash: hashText(t.text),
    currentSourceHash,
    presentation,
    usableAsCurrentPrompt: presentation === 'current',
    note,
  }
}

function mergeFields(base: readonly FieldDecl[], extra: readonly FieldDecl[] | undefined): FieldDecl[] {
  const out = base.map((f) => ({ ...f }))
  for (const f of extra || []) if (!out.some((x) => x.name === f.name)) out.push({ ...f })
  return out
}

function buildShot(ep: number, shot: Shot, chars: readonly CharLike[], opts: ShotStateExportOptions, mode: ShotStateMode) {
  const provided = opts.docs?.[shot.id]
  let doc: ShotStateDoc = provided ?? migrateLegacyShot(shot, chars)
  if (opts.adapter?.fieldDecls?.length) doc = { ...doc, fields: mergeFields(doc.fields, opts.adapter.fieldDecls) }
  const sourceHash = hashSource(doc.source)
  const texts = doc.texts.map((t) => describeText(doc, t, sourceHash))
  const compat = validateShotState(doc, 'compat')
  const report = mode === 'compat' ? compat : validateShotState(doc, mode)
  const strict = validateShotState(doc, 'strict')
  const runReady = validateShotState(doc, 'run-ready')

  const adapted: ShotAdaptedEntry[] = []
  const adapterWarnings: ShotStateExportWarning[] = []
  if (opts.adapter) {
    for (const field of opts.adapter.textFields ?? DEFAULT_ADAPTER_TEXT_FIELDS) {
      const t = texts.find((x) => x.field === field)
      if (!t) {
        adapted.push({ field, status: 'skipped', reason: 'text_missing' })
      } else if (t.presentation === 'withheld') {
        adapted.push({ field, status: 'skipped', reason: `text_withheld:${t.status}/${t.semantic}` })
      } else {
        const compiled = compileModelAdapterText(t.text, opts.adapter)
        adapted.push({ field, status: 'compiled', presentation: t.presentation, compiled })
        for (const w of compiled.warnings) adapterWarnings.push({ shotId: shot.id, code: 'adapter_warning', message: w, field })
      }
    }
  }

  const out: ShotStateExportShot = {
    shotId: shot.id,
    episode: ep,
    shotNo: shot.shotNo,
    docOrigin: provided ? 'provided' : 'legacy_migration',
    source: doc.source,
    sourceHash,
    texts,
    reviews: doc.reviews.map((r) => ({ ...r })),
    review: { status: report.semantic.status, fields: report.semantic.fields, textCount: texts.length },
    compat,
    report,
    fields: {
      declared: doc.fields.map((f) => ({ ...f })),
      runRequiredUnsupported: compat.fields.runRequiredUnsupported,
      capabilityUnsupported: compat.fields.capabilityUnsupported,
      ignoredDocumented: compat.fields.ignoredDocumented,
    },
    unverifiedCharacterIds: compat.unverifiedCharacterIds,
    ...(doc.migration ? { migration: doc.migration } : {}),
    adapted,
  }
  const warnings: ShotStateExportWarning[] = [
    ...report.issues
      .filter((i) => i.severity === 'warning')
      .map((i) => ({ shotId: shot.id, code: i.code, message: i.message, ...(i.field ? { field: i.field } : {}) })),
    ...adapterWarnings,
  ]
  return {
    out,
    blockers: errorsOf(shot.id, report),
    strictOk: strict.ok,
    runReadyOk: runReady.ok,
    runReadyBlockers: errorsOf(shot.id, runReady),
    warnings,
  }
}

function evaluate(project: ShotStateExportProject, opts: ShotStateExportOptions): ShotStateExportPack {
  const mode: ShotStateMode = opts.mode ?? 'compat'
  if (opts.adapter) assertModelAdapter(opts.adapter)
  const chars = project.characters || []
  const eps = Object.keys(project.storyboards || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && (opts.episode === undefined || n === opts.episode))
    .sort((a, b) => a - b)

  const shots: ShotStateExportShot[] = []
  const blockers: ShotStateExportBlocker[] = []
  const warnings: ShotStateExportWarning[] = []
  const runReadyBlockers: ShotStateExportBlocker[] = []
  let strictOk = true
  let runReadyOk = true
  for (const ep of eps) {
    for (const shot of project.storyboards[ep] || []) {
      const r = buildShot(ep, shot, chars, opts, mode)
      shots.push(r.out)
      blockers.push(...r.blockers)
      warnings.push(...r.warnings)
      runReadyBlockers.push(...r.runReadyBlockers)
      strictOk = strictOk && r.strictOk
      runReadyOk = runReadyOk && r.runReadyOk
    }
  }
  if (!shots.length) {
    const none: ShotStateExportBlocker = {
      shotId: '',
      layer: 'structural',
      code: 'no_shots',
      message: '没有可导出的分镜',
      confidence: 'definite',
    }
    if (mode !== 'compat') blockers.push(none)
    runReadyBlockers.push(none)
    strictOk = false
    runReadyOk = false
  }

  const allIds = new Set(Object.values(project.storyboards || {}).flatMap((l) => (l || []).map((s) => s.id)))
  const unmatchedDocIds = Object.keys(opts.docs || {}).filter((id) => !allIds.has(id))

  const counts: Record<SemanticStatus, number> = { pass: 0, fail: 0, review_required: 0, unknown: 0 }
  for (const s of shots) counts[s.review.status]++
  const reviewStatus: SemanticStatus = counts.fail
    ? 'fail'
    : counts.review_required
      ? 'review_required'
      : counts.unknown
        ? 'unknown'
        : 'pass'

  const ok = blockers.length === 0
  const a = opts.adapter
  const pack: Omit<ShotStateExportPack, 'packHash'> = {
    spec: SHOT_STATE_EXPORT_SPEC,
    shotStateSpec: SHOT_STATE_SPEC,
    compilerVersion: COMPILER_VERSION,
    notice: H3_SUPPORT_NOTICE,
    h3: { receiverModified: false, receiverDeclaresSupport: false },
    mode,
    projectId: project.id,
    ...(opts.episode !== undefined ? { episode: opts.episode } : {}),
    ok,
    claims: { runReady: mode === 'run-ready' && ok, semanticPass: shots.length > 0 && reviewStatus === 'pass' },
    readiness: { strictOk, runReadyEligible: runReadyOk, runReadyBlockers },
    review: { status: reviewStatus, counts },
    ...(a
      ? {
          adapter: {
            adapterId: a.adapterId,
            adapterVersion: a.adapterVersion,
            modelId: a.modelId,
            wrapperId: a.wrapperId,
            wrapperVersion: a.wrapperVersion,
            ...(a.maxPromptChars !== undefined ? { maxPromptChars: a.maxPromptChars } : {}),
            note: '模型特定限制只存在于此适配声明；H3 接收端未改、未声明支持。',
          },
        }
      : {}),
    shots,
    blockers,
    warnings,
    unmatchedDocIds,
  }
  return { ...pack, packHash: hashText(JSON.stringify(shots)) }
}

function rejectionOf(pack: ShotStateExportPack): ShotStateExportRejection {
  const codes = [...new Set(pack.blockers.map((b) => b.code))]
  return {
    spec: SHOT_STATE_EXPORT_SPEC,
    mode: pack.mode,
    reason: `shot-state ${pack.mode} 导出被拒绝：${pack.blockers.length} 个阻断项（${codes.join(', ')}）`,
    blockers: pack.blockers,
    notice: H3_SUPPORT_NOTICE,
  }
}

/** 不抛错版本：strict / run-ready 不满足时返回 ok:false + 拒绝原因，不产出 pack。compat 总是返回 pack。 */
export function tryBuildShotStateExportPack(project: ShotStateExportProject, opts: ShotStateExportOptions = {}): TryShotStateExport {
  const pack = evaluate(project, opts)
  if (pack.mode !== 'compat' && !pack.ok) return { ok: false, rejection: rejectionOf(pack) }
  return { ok: true, pack }
}

/** strict / run-ready 不满足时抛 ShotStateExportRejectedError；不吞异常，不降级。 */
export function buildShotStateExportPack(project: ShotStateExportProject, opts: ShotStateExportOptions = {}): ShotStateExportPack {
  const r = tryBuildShotStateExportPack(project, opts)
  if (!r.ok) throw new ShotStateExportRejectedError(r.rejection)
  return r.pack
}

// ---------------- Markdown / Seedance 呈现 ----------------

const SEM_LABEL: Record<SemanticFieldStatus, string> = {
  pass: '已审查通过',
  fail: '审查未通过',
  review_required: '需审查（review_required）',
  unknown: '未审查（unknown：既不是通过，也不是已证明矛盾）',
  derived_valid: '派生有效（模板层，不是语义审查）',
}

const PRESENTATION_LABEL: Record<ExportPresentation, string> = {
  current: '可作现行文本',
  unreviewed: '未审查，不得当作已通过',
  withheld: '已失效/需审查，不得作为现行提示词',
}

const WITHHELD_MARK = '【已失效·需审查：未作为现行提示词输出，原文见 shot-state 附段】'
const UNREVIEWED_MARK = '【未审查·unknown】'

/**
 * 正文里 seedancePrompt 的呈现：current 原样输出；unreviewed 加「未审查」前缀；withheld 不输出文本，只放标记。
 * 仅 opt-in 路径使用，默认路径不经过它。
 */
export function shotStatePromptView(pack: ShotStateExportPack): (shotId: string, original: string) => string {
  const byShot = new Map(pack.shots.map((s) => [s.shotId, s]))
  return (shotId, original) => {
    const t = byShot.get(shotId)?.texts.find((x) => x.field === 'seedancePrompt')
    if (!t) return original ? `${UNREVIEWED_MARK}${original}` : original
    if (t.presentation === 'current') return t.text
    if (t.presentation === 'unreviewed') return `${UNREVIEWED_MARK}${t.text}`
    return WITHHELD_MARK
  }
}

/** 附段（Markdown 行）。标题固定含 shot-state 与 opt-in，和默认正文分开。 */
export function renderShotStateAppendix(pack: ShotStateExportPack, headingLevel = 2): string[] {
  const h = (n: number) => '#'.repeat(Math.min(6, headingLevel + n))
  const lines: string[] = [
    `${h(0)} shot-state 附段（opt-in · ${pack.shotStateSpec}）`,
    '',
    `> ${pack.notice}`,
    `> 导出规范：${pack.spec}｜编译器版本：${pack.compilerVersion}｜mode：${pack.mode}｜packHash：${pack.packHash}`,
    `> 本包是否自称 run-ready：${pack.claims.runReady ? '是' : '否'}｜语义汇总：${pack.review.status}${pack.claims.semanticPass ? '' : '（未全部通过，不是语义 pass）'}`,
  ]
  if (pack.adapter) {
    lines.push(`> 适配：${pack.adapter.adapterId}@${pack.adapter.adapterVersion} → ${pack.adapter.modelId}（${pack.adapter.note}）`)
  }
  lines.push('')
  for (const s of pack.shots) {
    lines.push(`${h(1)} 镜 ${s.shotId}（第${s.episode}集 #${s.shotNo}）`, '')
    lines.push(`- sourceHash：${s.sourceHash}｜来源：${s.docOrigin === 'provided' ? '提供的状态文档' : '旧 Shot compat 迁移'}`)
    lines.push(`- 语义审查：${s.review.status === 'pass' ? 'pass' : s.review.status}｜校验（${pack.mode}）：${s.report.ok ? '无 error' : '有 error'}｜compat：${s.compat.ok ? '无 error' : '有 error'}`)
    if (s.unverifiedCharacterIds.length) lines.push(`- 首帧可见性未核验（unverified）：${s.unverifiedCharacterIds.join('、')}`)
    if (s.fields.runRequiredUnsupported.length) lines.push(`- 运行所需字段未被支持（阻断 run-ready）：${s.fields.runRequiredUnsupported.join('、')}`)
    if (s.fields.capabilityUnsupported.length) lines.push(`- 可选能力未被支持（仅记录，不代表已支持）：${s.fields.capabilityUnsupported.join('、')}`)
    for (const t of s.texts) {
      const p = t.provenance
      lines.push(
        `- 文本 \`${t.field}\`｜${PRESENTATION_LABEL[t.presentation]}｜状态 ${t.status}｜语义 ${t.semantic}（${SEM_LABEL[t.semantic]}）` +
          `｜来源 ${p.source}${p.compilerId ? `｜${p.compilerId}@${p.compilerVersion ?? '?'}` : ''}` +
          `｜sourceHash ${p.sourceHash ?? '-'}｜textHash ${p.textHash}｜当前 textHash ${t.currentTextHash}` +
          `｜invalidated ${p.invalidated}｜reviewRequired ${p.reviewRequired}`,
      )
      if (t.presentation === 'withheld') lines.push('  - 失效原文（仅留档，不得作为现行提示词）：', '', '    ```', ...t.text.split('\n').map((x) => `    ${x}`), '    ```')
    }
    for (const a of s.adapted) {
      lines.push(
        a.status === 'compiled'
          ? `- 适配 \`${a.field}\`：${a.compiled.adapterId}@${a.compiled.adapterVersion}（${a.compiled.modelId}）｜inputHash ${a.compiled.inputHash}｜outputHash ${a.compiled.outputHash}｜${PRESENTATION_LABEL[a.presentation]}`
          : `- 适配 \`${a.field}\`：已跳过（${a.reason}）`,
      )
    }
    lines.push('')
  }
  if (pack.blockers.length) {
    lines.push(`${h(1)} 阻断项`, '')
    for (const b of pack.blockers) lines.push(`- [${b.shotId || '-'}] ${b.code}：${b.message}`)
    lines.push('')
  }
  if (pack.warnings.length) {
    lines.push(`${h(1)} 警告`, '')
    for (const w of pack.warnings) lines.push(`- [${w.shotId || '-'}] ${w.code}：${w.message}`)
    lines.push('')
  }
  if (pack.unmatchedDocIds.length) lines.push(`未匹配分镜的状态文档：${pack.unmatchedDocIds.join('、')}`, '')
  return lines
}
