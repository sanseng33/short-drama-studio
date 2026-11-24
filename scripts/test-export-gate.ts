/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-export-gate.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '../src/types'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { projectToMarkdown, seedancePack } from '../src/lib/export'
import {
  PIPELINE_ACCEPT_NOTE,
  PIPELINE_EMPTY_MESSAGE,
  allPendingChecked,
  attemptPipelineExport,
  confirmAcceptAndExport,
  pendingKey,
  type PipelineExportDeps,
} from '../src/lib/consistency/pipelineExportGate'
import {
  EXPORT_WARNINGS_EMPTY,
  PIPELINE_GATE_TARGET,
  REVIEW_LABEL,
  acceptRisksForFindings,
  dialogueReviewLabel,
  formatMissingLine,
  isPipelineJsonBlocked,
  liveDialogueFindings,
  mapExportWarnings,
  unacceptedDefiniteMissing,
} from '../src/lib/consistency/exportWarnings'

const here = dirname(fileURLToPath(import.meta.url))
const fxDir = join(here, 'fixtures/dialogue-audit')

const load = (name: string) => JSON.parse(readFileSync(join(fxDir, name), 'utf8'))

function toProject(fx: Record<string, unknown>, c?: Record<string, unknown>): Project {
  const src = (c || fx) as {
    script?: { episode?: number; fullText?: string }
    shots?: Project['storyboards'][number]
    episode?: number
  }
  const script = src.script || (fx.script as { episode?: number; fullText?: string } | undefined)
  const shots = src.shots || (fx.shots as Project['storyboards'][number] | undefined)
  const ep = script?.episode || src.episode || (fx.episode as number | undefined) || 1
  return {
    id: String(fx.id || 'p'),
    title: String(fx.id || 't'),
    genre: '都市逆袭',
    platform: '红果',
    episodeCount: 1,
    secondsPerEp: 60,
    style: '真人都市',
    logline: 'l',
    settingFacts: fx.settingFacts as string[] | undefined,
    characters: (fx.characters || []) as Project['characters'],
    outline: [{ episode: ep, title: '一', hook: '', summary: '', cliffhanger: '' }],
    scripts: script
      ? { [ep]: { episode: ep, title: '一', beats: [], fullText: script.fullText || '' } }
      : {},
    storyboards: shots ? { [ep]: shots } : {},
    selectedEpisode: ep,
    updatedAt: '2026-01-01T00:00:00.000Z',
    acceptedRisks: fx.acceptedRisks as Project['acceptedRisks'],
  }
}

function deep(v: unknown) {
  return JSON.parse(JSON.stringify(v))
}

/** 保留值为 undefined 的字段，用于整项目前后严格相等（JSON 克隆会丢掉它们）。 */
function snapshot<T>(v: T): T {
  return structuredClone(v)
}

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

t('F23 导出警告含 setting_fact_gap，映射为检查项', () => {
  const p = toProject(load('f23-setting-fact-gap.json'))
  const data = buildVideoPipelineExport(p)
  const codes = data.warnings.map((w) => w.code)
  assert.ok(codes.includes('setting_fact_gap'), `got ${codes.join(',')}`)
  const mapped = mapExportWarnings(data.warnings)
  assert.ok(mapped.some((f) => f.code === 'setting_fact_gap'))
  // 本夹具不写入 voice_missing 期望
})

t('无警告时文案为「暂无导出警告」', () => {
  assert.equal(mapExportWarnings([]).length, 0)
  assert.equal(mapExportWarnings(undefined).length, 0)
  assert.equal(EXPORT_WARNINGS_EMPTY, '暂无导出警告')
})

t('F01 两条确定缺词会拦截流水线 JSON，并列出原文', () => {
  const p = toProject(load('f01-baseline.json'))
  assert.equal(PIPELINE_GATE_TARGET, 'video-pipeline-json')
  assert.equal(isPipelineJsonBlocked(p), true)
  const missing = unacceptedDefiniteMissing(p)
  assert.equal(missing.length, 2)
  const texts = missing.map((f) => f.lineText || f.message).join('\n')
  assert.ok(texts.includes('我等了很久'))
  assert.ok(texts.includes('我们谈谈正事'))
})

t('逐条接受后不再拦截，风险记录完整，对白不变', () => {
  const p = toProject(load('f01-baseline.json'))
  const shotsBefore = deep(p.storyboards)
  const textBefore = p.scripts[1].fullText
  const missing = unacceptedDefiniteMissing(p)
  const at = '2026-11-24T04:00:00.000Z'
  const next = acceptRisksForFindings(p, missing, '测试接受', at)
  assert.equal(next.acceptedRisks?.length, 2)
  for (const r of next.acceptedRisks!) {
    assert.equal(r.code, 'dialogue_missing')
    assert.equal(r.episode, 1)
    assert.ok(r.targetKey && r.targetKey.length === 40)
    assert.equal(r.note, '测试接受')
    assert.equal(r.at, at)
  }
  assert.equal(isPipelineJsonBlocked(next), false)
  assert.deepEqual(next.storyboards, shotsBefore)
  assert.equal(next.scripts[1].fullText, textBefore)
  // 再次「下载」不再拦截
  assert.equal(unacceptedDefiniteMissing(next).length, 0)
})

t('F12 / F15 / F18 不拦截，标记待人工复核，不出现完整或已通过', () => {
  for (const name of ['f12-unparseable-script.json', 'f15-paraphrase.json', 'f18-ambiguous-colon.json']) {
    const p = toProject(load(name))
    assert.equal(isPipelineJsonBlocked(p), false, name)
    assert.equal(dialogueReviewLabel(p), REVIEW_LABEL, name)
  }
  const ui = [REVIEW_LABEL, EXPORT_WARNINGS_EMPTY, '当前没有台词检查项。', '（已接受）'].join('\n')
  assert.ok(!ui.includes('完整'))
  assert.ok(!ui.includes('已通过'))
  const src = readFileSync(join(here, '../src/components/ExportPanel.tsx'), 'utf8')
  const findingsSrc = readFileSync(join(here, '../src/components/ConsistencyFindings.tsx'), 'utf8')
  assert.ok(!src.includes('完整') && !src.includes('已通过'))
  assert.ok(!findingsSrc.includes('完整') && !findingsSrc.includes('已通过'))
})

t('闸门只作用于流水线 JSON 标识，Markdown/Seedance 路径不调用拦截', () => {
  const p = toProject(load('f01-baseline.json'))
  assert.equal(isPipelineJsonBlocked(p), true)
  const panel = readFileSync(join(here, '../src/components/ExportPanel.tsx'), 'utf8')
  // Markdown / Seedance 点击处理中不得调用 isPipelineJsonBlocked
  const mdStart = panel.indexOf('已下载 Markdown')
  const seedStart = panel.indexOf('已下载本集 Seedance 包')
  const allStart = panel.indexOf('已下载全部已生成分镜的 Seedance 包')
  assert.ok(mdStart > 0 && seedStart > 0 && allStart > 0)
  const mdBlock = panel.slice(panel.lastIndexOf('onClick', mdStart), mdStart)
  const seedBlock = panel.slice(panel.lastIndexOf('onClick', seedStart), seedStart)
  const allBlock = panel.slice(panel.lastIndexOf('onClick', allStart), allStart)
  assert.ok(!mdBlock.includes('isPipelineJsonBlocked'))
  assert.ok(!seedBlock.includes('isPipelineJsonBlocked'))
  assert.ok(!allBlock.includes('isPipelineJsonBlocked'))
  // 流水线按钮走共用闸门（行为由下方「闸门：」用例调用生产函数验证）
  assert.ok(panel.includes('onClick={requestExport}'))
})

t('F02 重复台词缺 1 次：对话框只列第 2 次出现', () => {
  const fx = load('f02-repeat.json')
  const c = (fx.cases as Record<string, unknown>[])[0]
  const p = toProject(fx, c)
  const missing = unacceptedDefiniteMissing(p)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].occurrence, 2)
  const label = formatMissingLine(missing[0])
  assert.ok(label.includes('第 2 次出现'))
  assert.ok(label.includes('你来了'))
})

t('已接受行被改动后 targetKey 变化，需重新接受', () => {
  const p = toProject(load('f01-baseline.json'))
  const missing = unacceptedDefiniteMissing(p)
  const one = missing[0]
  const accepted = acceptRisksForFindings(p, [one], '只接受一句', '2026-11-24T04:00:00.000Z')
  assert.equal(unacceptedDefiniteMissing(accepted).length, 1)
  // 改写已接受的那句剧本台词，使 key 变化
  const oldText = one.lineText || ''
  const nextText = accepted.scripts[1].fullText.replace(oldText, '这句已经被改掉了，不再是原来的词。')
  const changed: Project = {
    ...accepted,
    scripts: {
      ...accepted.scripts,
      1: { ...accepted.scripts[1], fullText: nextText },
    },
  }
  const after = unacceptedDefiniteMissing(changed)
  // 原已接受的 targetKey 不再命中新缺失；仍有至少一条未接受（另一句 + 可能的新缺失）
  assert.ok(after.length >= 1)
  assert.ok(after.every((f) => f.targetKey !== one.targetKey) || after.some((f) => f.targetKey !== one.targetKey))
  const stillUsesOldKey = after.some((f) => f.targetKey === one.targetKey)
  assert.equal(stillUsesOldKey, false)
  assert.equal(isPipelineJsonBlocked(changed), true)
})

t('接受风险前后 buildVideoPipelineExport JSON 逐字节相同，schema 仍为 @1', () => {
  const p = toProject(load('f01-baseline.json'))
  const a = buildVideoPipelineExport(p)
  assert.equal(a.schema, 'short-drama-studio/video-pipeline@1')
  const next = acceptRisksForFindings(p, unacceptedDefiniteMissing(p), '接受', '2026-11-24T04:00:00.000Z')
  const b = buildVideoPipelineExport(next)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

t('台词检查 findings 来自现场重算且不改写 shots', () => {
  const p = toProject(load('f01-baseline.json'))
  const shots = deep(p.storyboards)
  const findings = liveDialogueFindings(p)
  assert.ok(findings.some((f) => f.code === 'dialogue_missing'))
  assert.deepEqual(p.storyboards, shots)
})

// ---- 共用生产闸门（ExportPanel 与 Storyboard 都经 usePipelineExportGate → 这些函数）----

interface Rec {
  downloads: { filename: string; content: string; mime?: string }[]
  toasts: string[]
  saved: Project[]
}
function makeDeps(): { deps: PipelineExportDeps; rec: Rec } {
  const rec: Rec = { downloads: [], toasts: [], saved: [] }
  const deps: PipelineExportDeps = {
    download: (filename, content, mime) => rec.downloads.push({ filename, content, mime }),
    flash: (m) => rec.toasts.push(m),
    setProject: (n) => rec.saved.push(n),
  }
  return { deps, rec }
}

t('闸门：无分镜提示「尚无分镜可导出」，不下载、不拦截弹窗', () => {
  const p = toProject(load('f01-baseline.json'))
  const empty: Project = { ...p, storyboards: {} }
  const { deps, rec } = makeDeps()
  const r = attemptPipelineExport(empty, deps)
  assert.equal(r.status, 'empty')
  assert.deepEqual(rec.toasts, [PIPELINE_EMPTY_MESSAGE])
  assert.equal(PIPELINE_EMPTY_MESSAGE, '尚无分镜可导出')
  assert.equal(rec.downloads.length, 0)
  assert.equal(rec.saved.length, 0)
})

t('闸门：确定缺词拦截下载并列出原文；未勾选全部不可确认', () => {
  const p = toProject(load('f01-baseline.json'))
  const { deps, rec } = makeDeps()
  const r = attemptPipelineExport(p, deps)
  assert.equal(r.status, 'blocked')
  if (r.status !== 'blocked') return
  assert.equal(r.pending.length, 2)
  const lines = r.pending.map(formatMissingLine).join('\n')
  assert.ok(lines.includes('我等了很久') && lines.includes('我们谈谈正事'))
  assert.equal(rec.downloads.length, 0)
  assert.equal(rec.saved.length, 0)
  // 无勾选 / 部分勾选：不落盘不下载
  assert.equal(allPendingChecked(r.pending, {}), false)
  const partial = { [pendingKey(r.pending[0])]: true }
  assert.equal(allPendingChecked(r.pending, partial), false)
  assert.equal(confirmAcceptAndExport(p, r.pending, partial, deps).status, 'not_confirmed')
  assert.equal(rec.downloads.length, 0)
  assert.equal(rec.saved.length, 0)
})

t('闸门：取消（不调用确认）不写 acceptedRisks，剧本与分镜台词不变，仍拦截', () => {
  const p = toProject(load('f01-baseline.json'))
  const before = snapshot(p)
  const scriptsBefore = deep(p.scripts)
  const shotsBefore = deep(p.storyboards)
  const riskCountBefore = p.acceptedRisks?.length ?? 0
  const { deps, rec } = makeDeps()
  const r = attemptPipelineExport(p, deps)
  assert.equal(r.status, 'blocked')
  if (r.status !== 'blocked') return
  assert.equal(r.pending.length, 2)
  // 取消 = UI 只关闭面板，不调用 confirmAcceptAndExport
  assert.equal(p.acceptedRisks?.length ?? 0, riskCountBefore)
  assert.equal(p.acceptedRisks, undefined)
  assert.deepEqual(deep(p.scripts), scriptsBefore)
  assert.deepEqual(deep(p.storyboards), shotsBefore)
  assert.deepEqual(p, before)
  assert.equal(rec.downloads.length, 0)
  assert.equal(rec.saved.length, 0)
  assert.deepEqual(rec.toasts, [])
  assert.equal(isPipelineJsonBlocked(p), true)
  // 取消后再次点击导出仍被拦截，待确认列表不变
  const again = attemptPipelineExport(p, deps)
  assert.equal(again.status, 'blocked')
  if (again.status === 'blocked') assert.deepEqual(again.pending.map(pendingKey), r.pending.map(pendingKey))
  assert.equal(rec.downloads.length, 0)
  assert.equal(rec.saved.length, 0)
})

t('闸门：逐条全部勾选后先 setProject 写入 acceptedRisks，再下载；对白与 JSON 不变', () => {
  const p = toProject(load('f01-baseline.json'))
  const before = snapshot(p)
  const jsonBefore = JSON.stringify(buildVideoPipelineExport(p), null, 2)
  const { deps, rec } = makeDeps()
  const r = attemptPipelineExport(p, deps)
  assert.equal(r.status, 'blocked')
  if (r.status !== 'blocked') return
  const checked: Record<string, boolean> = {}
  for (const f of r.pending) checked[pendingKey(f)] = true
  assert.equal(allPendingChecked(r.pending, checked), true)
  const c = confirmAcceptAndExport(p, r.pending, checked, deps)
  assert.equal(c.status, 'downloaded')
  if (c.status !== 'downloaded') return
  assert.equal(rec.saved.length, 1)
  assert.equal(rec.saved[0].acceptedRisks?.length, 2)
  assert.ok(rec.saved[0].acceptedRisks!.every((x) => x.code === 'dialogue_missing' && x.note === PIPELINE_ACCEPT_NOTE))
  assert.equal(rec.downloads.length, 1)
  assert.equal(rec.downloads[0].mime, 'application/json')
  assert.ok(rec.downloads[0].filename.length > 0)
  assert.equal(rec.downloads[0].content, jsonBefore)
  assert.equal(JSON.parse(rec.downloads[0].content).schema, 'short-drama-studio/video-pipeline@1')
  assert.equal(isPipelineJsonBlocked(rec.saved[0]), false)
  // 对白、剧本不变
  assert.deepEqual(rec.saved[0].storyboards, before.storyboards)
  assert.deepEqual(rec.saved[0].scripts, before.scripts)
  assert.deepEqual(p, before)
})

t('闸门：已全部接受后再次导出直接下载；无确定缺词的项目直接下载', () => {
  const p = toProject(load('f01-baseline.json'))
  const accepted = acceptRisksForFindings(p, unacceptedDefiniteMissing(p), 'x', '2026-11-24T04:00:00.000Z')
  const a = makeDeps()
  const ra = attemptPipelineExport(accepted, a.deps)
  assert.equal(ra.status, 'downloaded')
  assert.equal(a.rec.downloads.length, 1)
  assert.equal(a.rec.saved.length, 0)
  const clean = toProject(load('f15-paraphrase.json'))
  assert.equal(isPipelineJsonBlocked(clean), false)
  const b = makeDeps()
  const rb = attemptPipelineExport(clean, b.deps)
  assert.equal(rb.status, 'downloaded')
  assert.equal(b.rec.downloads.length, 1)
  assert.equal(b.rec.saved.length, 0)
})

t('闸门：项目 JSON / Markdown / Seedance 不依赖闸门函数（调用生产导出函数，被拦项目仍可生成）', () => {
  const p = toProject(load('f01-baseline.json'))
  assert.equal(isPipelineJsonBlocked(p), true)
  // 这些导出不经过 attemptPipelineExport，被拦截的项目照常产出内容
  assert.ok(projectToMarkdown(p).length > 0)
  assert.ok(typeof seedancePack(p, 1) === 'string')
  assert.ok(JSON.stringify(p).length > 0)
  const { rec } = makeDeps()
  assert.equal(rec.downloads.length, 0)
})

t('两入口共用同一闸门（辅助源码断言）：Storyboard 与 ExportPanel 都用 usePipelineExportGate，Storyboard 不再直接下载流水线 JSON', () => {
  const board = readFileSync(join(here, '../src/components/Storyboard.tsx'), 'utf8')
  const panel = readFileSync(join(here, '../src/components/ExportPanel.tsx'), 'utf8')
  const shared = readFileSync(join(here, '../src/components/PipelineExportGate.tsx'), 'utf8')
  assert.ok(board.includes('usePipelineExportGate(api)') && panel.includes('usePipelineExportGate(api)'))
  assert.ok(!board.includes('downloadText') && !board.includes('videoPipelineFilename') && !board.includes('buildVideoPipelineExport'))
  assert.ok(!panel.includes('videoPipelineFilename') && !panel.includes('acceptRisksForFindings'))
  assert.ok(shared.includes('attemptPipelineExport') && shared.includes('confirmAcceptAndExport'))
})

console.log(`\n${pass} tests passed`)
