/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-shot-state-ssot.ts
 * shot-state-ssot@0.1.0-draft：模块用例 + 生成入口（generateStoryboardChecked）+ 检查入口（collectFindings）集成验收。
 * 不联网（假 LLM），不执行 shell。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { isPipelineJsonBlocked } from '../src/lib/consistency/exportWarnings'
import { generateStoryboardChecked } from '../src/lib/generator'
import { autoFixStoryboard, validateStoryboard, type RawShotLike } from '../src/lib/generatorRules'
import {
  SHOT_STATE_SPEC,
  addReview,
  adoptUserText,
  castEqualsFirstFrameVisible,
  compileAdapterText,
  createShotState,
  deriveText,
  firstFrameVisibleIds,
  hashSource,
  migrateLegacyShot,
  sameSet,
  setText,
  textStatus,
  validateShotState,
  withFields,
  type ShotStateDoc,
} from '../src/lib/shotState'
import type { Project, Shot } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}
const ta = async (name: string, fn: () => Promise<void>) => {
  await fn()
  pass++
  console.log('✓', name)
}

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code)
const errs = (r: { issues: { code: string; severity: string }[] }) => r.issues.filter((i) => i.severity === 'error').map((i) => i.code)

/** 全员首帧 full、文本为用户散文的基础文档（通用角色 id）。 */
const fullDoc = (cast: string[] = ['a', 'b']): ShotStateDoc =>
  createShotState({ shotId: 'x1', cast, firstFrame: cast.map((id) => ({ id, kind: 'full' as const })) })

// ---------------- A. 模块用例 ----------------

t('同义不同文：语义审查 pass 后 strict / run-ready 可通过', () => {
  let d = fullDoc()
  d = setText(d, 'action', '甲把杯子递给乙')
  d = setText(d, 'seedancePrompt', '一人将杯子交到另一人手里')
  assert.equal(validateShotState(d, 'strict').ok, false, '未审查前不通过')
  d = addReview(d, { field: 'action', verdict: 'pass', reviewer: 'human' })
  d = addReview(d, { field: 'seedancePrompt', verdict: 'pass', reviewer: 'llm' })
  assert.equal(validateShotState(d, 'strict').ok, true)
  assert.equal(validateShotState(d, 'run-ready').ok, true)
})

t('相同结构声明但散文冲突：无审查不得 strict / run-ready；unknown 不是 review_fail；显式 fail 不通过', () => {
  let d = fullDoc()
  d = setText(d, 'action', 'a 独自站在门外，b 不在场')
  d = setText(d, 'seedancePrompt', 'a 与 b 并肩站在屋内')
  const strict = validateShotState(d, 'strict')
  const run = validateShotState(d, 'run-ready')
  assert.equal(strict.ok, false)
  assert.equal(run.ok, false)
  assert.equal(strict.semantic.status, 'unknown')
  assert.ok(codes(strict).includes('semantic_unknown'))
  assert.ok(!codes(strict).includes('semantic_fail'), 'unknown 不是已证明矛盾')
  assert.ok(strict.semantic.issues.every((i) => i.confidence === 'unknown'))
  // compat 不因此拒绝
  assert.equal(validateShotState(d, 'compat').ok, true)
  // 显式 semantic fail 不得通过，且是 fail 而非 unknown
  const f = addReview(addReview(d, { field: 'action', verdict: 'fail', reviewer: 'human' }), { field: 'seedancePrompt', verdict: 'pass', reviewer: 'human' })
  for (const m of ['strict', 'run-ready'] as const) {
    const r = validateShotState(f, m)
    assert.equal(r.ok, false)
    assert.equal(r.semantic.status, 'fail')
    assert.ok(codes(r).includes('semantic_fail'))
  }
})

t('乱序集合等价，但保留 displayOrder', () => {
  const a = createShotState({ shotId: 's', cast: ['b', 'a', 'c'], displayOrder: ['b', 'a', 'c'] })
  const b = createShotState({ shotId: 's', cast: ['c', 'b', 'a'], displayOrder: ['a', 'c', 'b'] })
  assert.ok(sameSet(a.source.cast, b.source.cast))
  assert.equal(hashSource(a.source), hashSource(b.source), 'sourceHash 不依赖顺序')
  assert.deepEqual(a.source.displayOrder, ['b', 'a', 'c'])
  assert.deepEqual(b.source.displayOrder, ['a', 'c', 'b'])
  // 首帧条目乱序同样等价
  const x = createShotState({ shotId: 's', cast: ['a', 'b'], firstFrame: [{ id: 'a', kind: 'full' }, { id: 'b', kind: 'offscreen' }] })
  const y = createShotState({ shotId: 's', cast: ['a', 'b'], firstFrame: [{ id: 'b', kind: 'offscreen' }, { id: 'a', kind: 'full' }] })
  assert.equal(hashSource(x.source), hashSource(y.source))
  assert.deepEqual(firstFrameVisibleIds(createShotState({ shotId: 's', cast: ['b', 'a'], displayOrder: ['b', 'a'], firstFrame: [{ id: 'a', kind: 'full' }, { id: 'b', kind: 'full' }] }).source), ['b', 'a'])
})

t('纯画外 VO 可 run-ready', () => {
  const d = createShotState({
    shotId: 'vo',
    cast: ['n'],
    firstFrame: [{ id: 'n', kind: 'offscreen' }],
    speech: [{ id: 'n', mode: 'voice_only' }],
  })
  const r = validateShotState(d, 'run-ready')
  assert.equal(r.ok, true, JSON.stringify(r.issues))
  assert.deepEqual(firstFrameVisibleIds(d.source), [])
})

t('局部袖子 partial；缺 parts 结构失败；partial + start_offscreen 结构冲突', () => {
  const ok = createShotState({ shotId: 'p', cast: ['a', 'b'], firstFrame: [{ id: 'a', kind: 'full' }, { id: 'b', kind: 'partial', parts: ['sleeve'] }] })
  assert.equal(validateShotState(ok, 'strict').ok, true)
  const noParts = createShotState({ shotId: 'p', cast: ['a'], firstFrame: [{ id: 'a', kind: 'partial' }] })
  assert.ok(errs(validateShotState(noParts, 'compat')).includes('partial_missing_parts'))
  const emptyParts = createShotState({ shotId: 'p', cast: ['a'], firstFrame: [{ id: 'a', kind: 'partial', parts: [' '] }] })
  assert.ok(errs(validateShotState(emptyParts, 'compat')).includes('partial_missing_parts'))
  const conflict = createShotState({
    shotId: 'p',
    cast: ['a'],
    firstFrame: [{ id: 'a', kind: 'partial', parts: ['sleeve'] }],
    events: [{ id: 'a', kind: 'start_offscreen' }],
  })
  const r = validateShotState(conflict, 'compat')
  assert.equal(r.ok, false)
  assert.ok(errs(r).includes('start_offscreen_but_visible'))
  // full + start_offscreen 同样冲突
  const full = createShotState({ shotId: 'p', cast: ['a'], firstFrame: [{ id: 'a', kind: 'full' }], events: [{ id: 'a', kind: 'start_offscreen' }] })
  assert.ok(errs(validateShotState(full, 'compat')).includes('start_offscreen_but_visible'))
})

t('全员首帧在场合法；同一人先离画再入画合法；未先离画就 reenter 非法', () => {
  const d = createShotState({
    shotId: 'e',
    cast: ['a', 'b'],
    firstFrame: [{ id: 'a', kind: 'full' }, { id: 'b', kind: 'full' }],
    events: [{ id: 'a', kind: 'exit', atSec: 2 }, { id: 'a', kind: 'reenter', atSec: 5 }],
  })
  assert.ok(castEqualsFirstFrameVisible(d.source), 'firstFrame 可见集合等于 cast')
  const r = validateShotState(d, 'run-ready')
  assert.equal(r.structural.ok, true, JSON.stringify(r.structural.issues))
  assert.equal(validateShotState(d, 'strict').ok, true)
  const bad = createShotState({
    shotId: 'e',
    cast: ['a'],
    firstFrame: [{ id: 'a', kind: 'full' }],
    events: [{ id: 'a', kind: 'reenter' }],
  })
  assert.ok(errs(validateShotState(bad, 'compat')).includes('reenter_while_visible'))
  const back = createShotState({
    shotId: 'e',
    cast: ['a'],
    firstFrame: [{ id: 'a', kind: 'full' }],
    events: [{ id: 'a', kind: 'exit', atSec: 3 }, { id: 'a', kind: 'enter', atSec: 1 }],
  })
  assert.ok(errs(validateShotState(back, 'compat')).includes('event_time_regression'))
})

t('旧 Shot 仅 characterIds/voiceOnly/action/seedancePrompt：compat 通过且 unverified，不得 run-ready', () => {
  const chars = [{ id: 'c1', name: '甲' }, { id: 'c2', name: '乙' }]
  const doc = migrateLegacyShot({ id: 's1', characterIds: ['c1'], voiceOnly: ['乙'], action: '甲转身', seedancePrompt: '0-3秒 甲转身' }, chars)
  assert.deepEqual([...doc.source.cast].sort(), ['c1', 'c2'])
  assert.ok(doc.source.firstFrame.every((e) => e.kind === 'unverified'), 'characterIds 不得无迁移改释为首帧可见')
  assert.deepEqual(doc.source.speech, [{ id: 'c2', mode: 'voice_only' }])
  assert.equal(doc.migration?.origin, 'legacy_migration')
  const compat = validateShotState(doc, 'compat')
  assert.equal(compat.ok, true, JSON.stringify(compat.issues))
  assert.deepEqual([...compat.unverifiedCharacterIds].sort(), ['c1', 'c2'])
  assert.equal(validateShotState(doc, 'strict').ok, false)
  assert.equal(validateShotState(doc, 'run-ready').ok, false)
  // 散文不逐字相等也不会让 compat 拒绝
  assert.equal(validateShotState(setText(doc, 'seedancePrompt', '完全不同的写法'), 'compat').ok, true)
  // 未解析的 voiceOnly 保留并记录
  const u = migrateLegacyShot({ id: 's2', characterIds: [], voiceOnly: ['路人广播'] }, chars)
  assert.deepEqual(u.migration?.unresolvedVoiceOnly, ['路人广播'])
  assert.equal(validateShotState(u, 'compat').ok, true)
  // 空旧 shot 不抛错
  assert.equal(validateShotState(migrateLegacyShot({ id: 's3' }, chars), 'compat').ok, true)
})

t('不支持的可选 capability 不单独阻断；run_required 不支持则阻断 run-ready', () => {
  const base = fullDoc(['a'])
  const cap = withFields(base, [{ name: 'lensFlare', role: 'capability', supported: false }, { name: 'legacyNote', role: 'ignored_documented', supported: false }])
  const rc = validateShotState(cap, 'run-ready')
  assert.equal(rc.ok, true, JSON.stringify(rc.issues))
  assert.deepEqual(rc.fields.capabilityUnsupported, ['lensFlare'])
  assert.deepEqual(rc.fields.ignoredDocumented, ['legacyNote'])
  assert.ok(rc.issues.some((i) => i.code === 'capability_unsupported' && i.severity === 'warning'))
  const req = withFields(base, [{ name: 'refImageSlot', role: 'run_required', supported: false }])
  const rr = validateShotState(req, 'run-ready')
  assert.equal(rr.ok, false)
  assert.deepEqual(rr.fields.runRequiredUnsupported, ['refImageSlot'])
  const supported = withFields(base, [{ name: 'refImageSlot', role: 'run_required', supported: true }])
  assert.equal(validateShotState(supported, 'run-ready').ok, true)
})

t('派生后手改失效并 review_required，不会静默恢复有效', () => {
  let d = fullDoc()
  d = deriveText(d, 'firstFrameLine', (id) => id.toUpperCase())
  const cur = d.texts.find((x) => x.field === 'firstFrameLine')!
  assert.equal(cur.provenance.source, 'derived')
  assert.equal(cur.provenance.compilerId, 'shot-state/firstFrameLine')
  assert.ok(cur.provenance.compilerVersion && cur.provenance.sourceHash && cur.provenance.textHash)
  assert.equal(textStatus(d, cur), 'valid_derived')
  // 全部文本仍是有效派生：strict 可过，run-ready 也可过
  assert.equal(validateShotState(d, 'strict').ok, true)
  assert.equal(validateShotState(d, 'run-ready').ok, true)
  // 手改
  const edited = setText(d, 'firstFrameLine', '首帧：A（全身可见）；B 趴在地上')
  const p = edited.texts.find((x) => x.field === 'firstFrameLine')!.provenance
  assert.equal(p.invalidated, true)
  assert.equal(p.reviewRequired, true)
  const r = validateShotState(edited, 'strict')
  assert.equal(r.ok, false)
  assert.equal(r.semantic.status, 'review_required')
  // 即使补了一条 pass 审查，失效的派生仍需显式 adopt 为用户文本才能通过
  const reviewed = addReview(edited, { field: 'firstFrameLine', verdict: 'pass', reviewer: 'human' })
  assert.equal(validateShotState(reviewed, 'strict').ok, false)
  assert.ok(codes(validateShotState(reviewed, 'strict')).includes('derived_invalidated'))
  const adopted = addReview(adoptUserText(edited, 'firstFrameLine'), { field: 'firstFrameLine', verdict: 'pass', reviewer: 'human' })
  assert.equal(validateShotState(adopted, 'strict').ok, true)
  // 状态源变化使旧派生 stale
  const moved: ShotStateDoc = { ...d, source: { ...d.source, firstFrame: [{ id: 'a', kind: 'offscreen' }, { id: 'b', kind: 'full' }] } }
  assert.equal(textStatus(moved, moved.texts[0]), 'stale')
  assert.equal(validateShotState(moved, 'strict').ok, false)
  // 重新编译后恢复
  assert.equal(validateShotState(deriveText(moved, 'firstFrameLine'), 'strict').ok, true)
})

t('审查记录绑定 hash：文本改动后旧 pass 不再生效', () => {
  let d = setText(fullDoc(), 'action', '甲开门')
  d = addReview(d, { field: 'action', verdict: 'pass', reviewer: 'human' })
  assert.equal(validateShotState(d, 'run-ready').ok, true)
  d = setText(d, 'action', '甲砸门')
  const r = validateShotState(d, 'run-ready')
  assert.equal(r.ok, false)
  assert.equal(r.semantic.status, 'unknown')
})

t('只补 t0 结构字段不能当语义 oracle', () => {
  // 旧文档：未核验 + 散文冲突
  const legacy = migrateLegacyShot({ id: 'z', characterIds: ['a', 'b'], action: 'a 一人在屋内', seedancePrompt: 'a、b 同在屋外' }, [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }])
  // 补齐 t0：首帧全员 full，事件声明一致。散文未动，也没有审查记录
  const patched: ShotStateDoc = {
    ...legacy,
    source: { ...legacy.source, firstFrame: legacy.source.cast.map((id) => ({ id, kind: 'full' as const })) },
  }
  assert.equal(validateShotState(patched, 'compat').ok, true)
  for (const m of ['strict', 'run-ready'] as const) {
    const r = validateShotState(patched, m)
    assert.equal(r.ok, false, `${m} 不得因已有 t0 字段而通过`)
    assert.equal(r.structural.ok, true, '结构本身一致')
    assert.ok(['unknown', 'review_required'].includes(r.semantic.status))
    assert.notEqual(r.semantic.status, 'pass')
  }
  // 源变化后，原来的审查记录同样失效
  const reviewed = addReview(patched, { field: 'action', verdict: 'pass', reviewer: 'human' })
  const changedT0: ShotStateDoc = { ...reviewed, source: { ...reviewed.source, firstFrame: reviewed.source.cast.map((id) => ({ id, kind: 'offscreen' as const })) } }
  assert.equal(validateShotState(changedT0, 'strict').ok, false)
})

t('compileAdapterText：wrapperId 必填，记录 inputHash/outputHash，不覆写输入', () => {
  const input = '原文'
  const rec = compileAdapterText(input, { wrapperId: 'w.prefix', wrapperVersion: '1', wrap: (s) => `[锁定]${s}` })
  assert.equal(rec.text, '[锁定]原文')
  assert.equal(input, '原文')
  assert.ok(rec.inputHash && rec.outputHash && rec.inputHash !== rec.outputHash)
  assert.equal(rec.wrapperId, 'w.prefix')
  assert.throws(() => compileAdapterText(input, { wrapperId: ' ', wrapperVersion: '1', wrap: (s) => s }), /wrapperId/)
  // 与导出默认路径无关：模块本身不依赖 videoExport
})

// ---------------- B. 集成验收 ----------------

const chars: Project['characters'] = [
  { id: 'c1', name: '甲', role: '主角', visualLock: '短发', costume: '白衬衫', signatureProp: '手表' },
  { id: 'c2', name: '乙', role: '配角', visualLock: '长发', costume: '夹克', signatureProp: '背包' },
]
const LOCS = ['病房', '客厅']
const mkProject = (): Project => ({
  id: 'p',
  title: 'T',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 75,
  style: '真人都市',
  logline: '',
  locations: LOCS,
  characters: chars,
  outline: [{ episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }],
  scripts: {},
  storyboards: {},
  selectedEpisode: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const stOf = (cast: string[]) => Object.fromEntries(cast.map((c, i) => [c, { pos: cast.length > 1 ? (i ? 'right' : 'left') : 'center', facing: 'front', pose: '站', gaze: 'front', hands: '空手' }]))
const rawShot = (p: Partial<RawShotLike> = {}): RawShotLike => ({
  durationSec: 7,
  visual: '病房里',
  action: '甲抬头',
  dialogue: '',
  seedancePrompt: '',
  characters: ['甲'],
  location: '病房',
  timeOfDay: '白天',
  startState: stOf(p.characters || ['甲']),
  endState: stOf(p.characters || ['甲']),
  cameraSide: 'master',
  lighting: { key: '左侧窗光', soft: true, temp: '暖' },
  ...p,
})
const legacyShot = (o: Partial<Shot> = {}): Shot => ({
  id: 's1-1',
  shotNo: 1,
  size: '近景',
  durationSec: 5,
  visual: '室内',
  action: '甲坐着',
  dialogue: '',
  camera: '固定',
  emotion: '平静',
  seedancePrompt: '室内，甲坐着',
  ...o,
})
const ctx = { characters: chars, locations: LOCS, secondsPerEp: 75 }
const outline = { episode: 1, title: '', hook: '', summary: '', cliffhanger: '' }

async function main() {
  await ta('生成入口：假 LLM 合法分镜 → shots 可用、shotState 已记录、issues/attempts 不受影响', async () => {
    const p = mkProject()
    const raw = [rawShot(), rawShot({ action: '甲低头' }), rawShot({ action: '甲坐下', voiceOnly: ['乙'] } as Partial<RawShotLike>)]
    let calls = 0
    const llm = async () => (calls++, JSON.stringify(raw))
    const r = await generateStoryboardChecked(llm, p, outline, '', { maxRepairs: 2 })
    assert.equal(calls, 1)
    assert.equal(r.attempts, 1)
    assert.deepEqual(r.issues, [])
    assert.equal(r.shots.length, 3)
    assert.deepEqual(r.shots[0].characterIds, ['c1'])
    assert.deepEqual(r.shots[1].characterIds, ['c1'])
    assert.deepEqual(r.shots[2].voiceOnly, ['乙'])
    assert.ok(r.shotState, 'shotState 已记录')
    assert.equal(r.shotState!.spec, SHOT_STATE_SPEC)
    assert.equal(r.shotState!.mode, 'compat')
    assert.equal(r.shotState!.episode, 1)
    assert.equal(r.shotState!.shotCount, 3)
    assert.equal(r.shotState!.okCount, 3)
    assert.equal(r.shotState!.failedShotIds.length, 0)
    assert.deepEqual(r.shotState!.reports.map((x) => x.shotId), r.shots.map((s) => s.id))
    assert.ok(r.shotState!.reports.every((x) => x.mode === 'compat' && x.unverifiedCharacterIds.length > 0), '迁移为 unverified')
    const third = r.shotState!.reports[2]
    assert.ok(third.unverifiedCharacterIds.includes('c2'))
    assert.ok(r.issues.every((i) => !/shot_state/i.test(i.rule) && !/shot_state/i.test(i.detail)), 'shot-state 不进 issues')
  })

  await ta('生成入口：分镜自检有问题时，issues/attempts 与未接线时一致，shot-state 仍只是记录', async () => {
    const p = mkProject()
    const raw = [rawShot({ durationSec: 3 }), rawShot()]
    const expected = validateStoryboard(autoFixStoryboard(JSON.parse(JSON.stringify(raw)) as RawShotLike[], ctx), ctx)
    assert.ok(expected.some((x) => x.rule === 'duration'))
    const prompts: string[] = []
    const llm = async (_s: string, u: string) => (prompts.push(u), JSON.stringify(raw))
    const r = await generateStoryboardChecked(llm, p, outline, '', { maxRepairs: 1 })
    assert.equal(r.attempts, 2, '修复循环次数只由原有 issues 决定')
    assert.equal(prompts.length, 2)
    assert.deepEqual(r.issues, expected)
    assert.ok(!prompts[1].includes('shot_state'), '修复提示不含 shot-state 内容')
    assert.equal(r.shots.length, 2)
    assert.equal(r.shotState?.shotCount, 2)
  })

  await ta('生成入口：非 JSON 后恢复；全程不因 shot-state 抛错', async () => {
    const p = mkProject()
    const prompts: string[] = []
    const llm = async (_s: string, u: string) => (prompts.push(u), prompts.length === 1 ? '没有 JSON' : JSON.stringify([rawShot(), rawShot()]))
    const r = await generateStoryboardChecked(llm, p, outline, '', { maxRepairs: 2 })
    assert.equal(r.attempts, 2)
    assert.ok(r.shotState)
    assert.equal(r.shots.length, 2)
  })

  await ta('生成入口：不可解析仍按原行为抛 no parseable output', async () => {
    const p = mkProject()
    await assert.rejects(generateStoryboardChecked(async () => '完全不是 JSON', p, outline, '', { maxRepairs: 0 }), /no parseable output/)
  })

  t('检查入口：collectFindings 在旧项目上记录 shot_state（compat），原有 findings 保持，不阻断', () => {
    const p = mkProject()
    p.storyboards[1] = [legacyShot({ characterIds: ['c1'] }), legacyShot({ id: 's1-2', shotNo: 2, characterIds: ['c1'], voiceOnly: ['乙'] })]
    const before = JSON.stringify(p)
    const withoutShotState = (fs: ReturnType<typeof collectFindings>) => fs.filter((f) => !f.code.startsWith('shot_state_'))
    const all = collectFindings(p)
    assert.equal(JSON.stringify(p), before, '不改项目')
    const ss = all.filter((f) => f.code.startsWith('shot_state_'))
    assert.ok(ss.length > 0, '含 shot_state 记录')
    assert.ok(ss.some((f) => f.code === 'shot_state_compat_unverified' && f.confidence === 'unknown' && f.episode === 1))
    assert.ok(ss.every((f) => f.severity !== 'error'), 'compat 记录不产生 error')
    assert.ok(ss.every((f) => ['definite', 'unknown'].includes(f.confidence || '')))
    // 原有 findings 形状不变：非 shot_state 的结果与不含 shot_state 时同一函数得到的一致
    const rest = withoutShotState(all)
    assert.ok(rest.every((f) => typeof f.id === 'string' && typeof f.code === 'string' && typeof f.message === 'string' && ['info', 'warning', 'error'].includes(f.severity)))
    assert.equal(isPipelineJsonBlocked(p), false)
    // 幂等
    assert.deepEqual(collectFindings(p), all)
  })

  t('检查入口：无分镜 / 旧式缺字段分镜不抛错，且不要求 run-ready', () => {
    const empty = mkProject()
    assert.doesNotThrow(() => collectFindings(empty))
    assert.equal(collectFindings(empty).filter((f) => f.code.startsWith('shot_state_')).length, 0)
    const minimal = mkProject()
    minimal.storyboards[1] = [legacyShot()] // 无 characterIds / voiceOnly
    const fs = collectFindings(minimal)
    assert.ok(fs.every((f) => !(f.code.startsWith('shot_state_') && f.severity === 'error')))
    assert.ok(!fs.some((f) => f.code === 'shot_state_semantic_not_pass'))
  })

  t('兼容：applyDialogueAuditToProject / collectFindings 在旧项目上仍可调用，shape 不变', () => {
    const p = mkProject()
    const fx = JSON.parse(readFileSync(join(here, 'fixtures/dialogue-audit/f01-baseline.json'), 'utf8'))
    p.scripts[1] = { episode: 1, title: '一', beats: [], fullText: fx.script.fullText }
    p.characters = fx.characters
    p.storyboards[1] = (fx.shots as Shot[]).map((s) => ({ ...s, characterIds: ['c-li'] }))
    const snap = JSON.parse(JSON.stringify(p.storyboards[1]))
    const next = applyDialogueAuditToProject(p, 1)
    assert.deepEqual(next.storyboards[1], snap)
    assert.equal(next.dialogueAudit![1].status, 'checked')
    assert.ok(next.dialogueAudit![1].findings.every((f) => !f.code.startsWith('shot_state_')), 'shot_state 不写入对白审计快照')
    assert.ok(next.fingerprints?.scriptHashByEpisode?.[1])
    const all = collectFindings(next)
    // 与 test-check-entry 一致：2 条确定缺词仍在，且仍拦截流水线 JSON
    assert.equal(all.filter((f) => f.code === 'dialogue_missing').length, 2)
    assert.equal(isPipelineJsonBlocked(next), true)
    // shot-state 记录在同一次调用中追加，且不改变对白 findings 的 shape
    assert.ok(all.some((f) => f.code.startsWith('shot_state_')))
    assert.ok(all.filter((f) => f.code === 'dialogue_missing').every((f) => f.confidence === 'definite'))
  })

  t('兼容：对白完整的旧项目不被 shot-state 阻断', () => {
    const p = mkProject()
    p.storyboards[1] = [legacyShot({ characterIds: ['c1'] })]
    assert.doesNotThrow(() => applyDialogueAuditToProject(p, 1))
    assert.equal(isPipelineJsonBlocked(applyDialogueAuditToProject(p, 1)), false)
  })

  console.log(`\n${pass} tests passed`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
