/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-shot-state-export.ts
 * shot-state 显式 opt-in 导出（buildVideoPipelineExport / projectToMarkdown / seedancePack）验收。
 * 不联网，不执行 shell。默认导出的三个 sha256 是固定期望值；哈希变了只能修实现，不能改夹具或期望值。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { projectToMarkdown, seedancePack } from '../src/lib/export'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import {
  H3_SUPPORT_NOTICE,
  ShotStateExportRejectedError,
  addReview,
  buildShotStateExportPack,
  compileModelAdapterText,
  createShotState,
  deriveText,
  hashSource,
  hashText,
  renderShotStateAppendix,
  setText,
  shotStatePromptView,
  textStatus,
  tryBuildShotStateExportPack,
  type ModelAdapterSpec,
  type ShotStateDoc,
  type ShotStateExportOptions,
  type ShotStateExportPack,
} from '../src/lib/shotState'
import type { Project, Shot } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

// ---------------- 夹具（A 的哈希期望值依赖它，字段不得改动） ----------------

const mkShots = (): Shot[] =>
  [
    {
      id: 's-1',
      episode: 1,
      shotNo: 1,
      size: '中景',
      durationSec: 4,
      visual: '厨房日景，角色甲在前景',
      action: '角色甲看向门口',
      dialogue: '角色甲：进来吧。',
      camera: '固定机位',
      emotion: '平静',
      characterIds: ['c-a'],
      voiceOnly: ['c-b'],
      seedancePrompt: '厨房日景，角色甲在前景，角色乙画外说话',
    },
  ] as unknown as Shot[]

const mkProject = (): Project => {
  const shots = mkShots()
  return {
    id: 't7-hash-fixture',
    title: 'T7默认导出哈希夹具',
    logline: 'l',
    genre: '都市情感',
    platform: '红果',
    style: '真人都市',
    episodeCount: 1,
    secondsPerEp: 60,
    settingFacts: ['旧楼对窗'],
    characters: [
      { id: 'c-a', name: '角色甲', role: '女主', tags: [], visualLock: '短发', costume: '白衬衫', signatureProp: '', locked: false, refImage: null },
      { id: 'c-b', name: '角色乙', role: '女配', tags: [], visualLock: '长发', costume: '灰外套', signatureProp: '', locked: false, refImage: null },
    ],
    outline: [{ episode: 1, title: '一', hook: 'h', summary: 's', cliffhanger: 'c' }],
    scripts: { 1: { episode: 1, fullText: '角色甲：进来吧。', beats: [] } },
    storyboards: { 1: shots },
    selectedEpisode: 1,
    updatedAt: '2026-11-25T00:00:00.000Z',
  } as unknown as Project
}

const SHOT = mkShots()[0]
const APPENDIX_HEAD = '## shot-state 附段'
const body = (text: string): string => text.split(APPENDIX_HEAD)[0]
const appendix = (text: string): string => {
  const i = text.indexOf(APPENDIX_HEAD)
  return i < 0 ? '' : text.slice(i)
}

const packOf = (project: Project, o: ShotStateExportOptions = {}): ShotStateExportPack => {
  const out = buildVideoPipelineExport(project, { shotStateExport: Object.keys(o).length ? o : true })
  assert.ok(out.shotStateExport, 'opt-in 后应有 shotStateExport')
  return out.shotStateExport
}

const errCodes = (blockers: { code: string }[]) => blockers.map((b) => b.code)
const rejected = ShotStateExportRejectedError

const adapter = (extra: Partial<ModelAdapterSpec> = {}): ModelAdapterSpec => ({
  adapterId: 'test-adapter',
  adapterVersion: '1.0.0',
  modelId: 'test-model',
  wrapperId: 'identity',
  wrapperVersion: '1',
  wrap: (s) => s,
  ...extra,
})

/** 全员首帧已声明、两段散文均已审查 pass 的文档（run-ready 可通过）。 */
const readyDoc = (): ShotStateDoc => {
  let d = createShotState({
    shotId: 's-1',
    cast: ['c-a', 'c-b'],
    displayOrder: ['c-a', 'c-b'],
    firstFrame: [
      { id: 'c-a', kind: 'full' },
      { id: 'c-b', kind: 'offscreen' },
    ],
    speech: [{ id: 'c-b', mode: 'voice_only' }],
  })
  d = setText(d, 'action', SHOT.action)
  d = setText(d, 'seedancePrompt', SHOT.seedancePrompt)
  d = addReview(d, { field: 'action', verdict: 'pass', reviewer: 'human' })
  d = addReview(d, { field: 'seedancePrompt', verdict: 'pass', reviewer: 'human' })
  return d
}

const HAND_EDITED = 'HAND_EDITED_PROMPT_MARKER 手改后的提示词'

/** seedancePrompt 先作为有效派生文本，再被手改 -> invalidated + review_required。 */
const invalidatedDoc = (): ShotStateDoc => {
  let d = createShotState({
    shotId: 's-1',
    cast: ['c-a', 'c-b'],
    displayOrder: ['c-a', 'c-b'],
    firstFrame: [
      { id: 'c-a', kind: 'full' },
      { id: 'c-b', kind: 'offscreen' },
    ],
  })
  d = deriveText(d, 'castLine', (id) => (id === 'c-a' ? '角色甲' : '角色乙'))
  const derived = d.texts[0]
  d = { ...d, texts: [{ field: 'seedancePrompt', text: derived.text, provenance: { ...derived.provenance, field: 'seedancePrompt' } }] }
  assert.equal(textStatus(d, d.texts[0]), 'valid_derived')
  d = setText(d, 'seedancePrompt', HAND_EDITED)
  assert.equal(textStatus(d, d.texts[0]), 'invalidated')
  return d
}

// ---------------- A. 默认兼容哈希 ----------------

const HASH_PIPELINE = '3c6e960b8d9eaeae6f9f87d620e43abcdbde24ed0f52a754cd769ee43d699bd8'
const HASH_MARKDOWN = '80dcf88fe3a1156ce831dad490a7c428b7f11a355ffe1aaf59561373303e690e'
const HASH_SEEDANCE = 'da81142d09d881c8945a78d12e042c6607a370a94524db1edeb0c86d3f20fcc1'

t('A 默认 buildVideoPipelineExport 哈希不变且无 shotStateExport 键', () => {
  const out = buildVideoPipelineExport(mkProject())
  assert.equal('shotStateExport' in out, false)
  assert.equal(sha256(JSON.stringify(out, null, 2)), HASH_PIPELINE)
})

t('A 默认 projectToMarkdown 哈希不变', () => {
  assert.equal(sha256(projectToMarkdown(mkProject())), HASH_MARKDOWN)
})

t('A 默认 seedancePack 哈希不变', () => {
  assert.equal(sha256(seedancePack(mkProject())), HASH_SEEDANCE)
})

t('A shotStateExport: false / 空选项等同默认（无键、哈希不变）', () => {
  const off = buildVideoPipelineExport(mkProject(), { shotStateExport: false })
  assert.equal('shotStateExport' in off, false)
  assert.equal(sha256(JSON.stringify(off, null, 2)), HASH_PIPELINE)
  assert.equal(sha256(projectToMarkdown(mkProject(), {})), HASH_MARKDOWN)
  assert.equal(sha256(projectToMarkdown(mkProject(), { shotState: false })), HASH_MARKDOWN)
  assert.equal(sha256(seedancePack(mkProject(), undefined, {})), HASH_SEEDANCE)
})

t('A opt-in 调用后默认哈希仍不变（无共享状态污染）', () => {
  const p = mkProject()
  buildVideoPipelineExport(p, { shotStateExport: true })
  projectToMarkdown(p, { shotState: true })
  seedancePack(p, undefined, { shotState: true })
  assert.equal(sha256(JSON.stringify(buildVideoPipelineExport(p), null, 2)), HASH_PIPELINE)
  assert.equal(sha256(projectToMarkdown(p)), HASH_MARKDOWN)
  assert.equal(sha256(seedancePack(p)), HASH_SEEDANCE)
})

// ---------------- B. Opt-in 版本化包 ----------------

t('B opt-in 出现版本化包：source、派生 provenance、version、hashes、compat、notice、h3', () => {
  const out = buildVideoPipelineExport(mkProject(), { shotStateExport: true })
  const pack = out.shotStateExport
  assert.ok(pack)
  assert.equal(pack.spec, 'shot-state-export@0.1.0-draft')
  assert.equal(pack.shotStateSpec, 'shot-state-ssot@0.1.0-draft')
  assert.ok(pack.compilerVersion)
  assert.equal(pack.mode, 'compat')
  assert.equal(pack.projectId, 't7-hash-fixture')
  assert.ok(pack.packHash)
  assert.equal(pack.notice, H3_SUPPORT_NOTICE)
  assert.deepEqual(pack.h3, { receiverModified: false, receiverDeclaresSupport: false })
  assert.equal(pack.claims.runReady, false)
  assert.equal(pack.ok, true)

  const s = pack.shots[0]
  assert.equal(s.shotId, 's-1')
  assert.equal(s.docOrigin, 'legacy_migration')
  assert.deepEqual(s.source.cast, ['c-a', 'c-b'])
  assert.deepEqual(s.source.speech, [{ id: 'c-b', mode: 'voice_only' }])
  assert.ok(s.source.firstFrame.every((e) => e.kind === 'unverified'), '旧 characterIds 不被解释为首帧可见')
  assert.equal(s.sourceHash, hashSource(s.source))
  assert.deepEqual(s.unverifiedCharacterIds.sort(), ['c-a', 'c-b'])
  assert.equal(s.compat.mode, 'compat')
  assert.equal(s.compat.ok, true)
  assert.ok(s.migration && s.migration.origin === 'legacy_migration')

  const fields = s.texts.map((x) => x.field).sort()
  assert.deepEqual(fields, ['action', 'seedancePrompt'])
  for (const x of s.texts) {
    assert.equal(x.provenance.source, 'user')
    assert.equal(x.provenance.textHash, hashText(x.text))
    assert.equal(x.currentTextHash, hashText(x.text))
    assert.equal(x.currentSourceHash, s.sourceHash)
  }
})

t('B 默认部分之外与默认导出逐字相同（附加包只追加一个键）', () => {
  const withPack = buildVideoPipelineExport(mkProject(), { shotStateExport: true })
  const { shotStateExport: _omit, ...rest } = withPack
  void _omit
  assert.equal(JSON.stringify(rest, null, 2), JSON.stringify(buildVideoPipelineExport(mkProject()), null, 2))
})

t('B 包确定性：同输入 packHash 相同；输入变化 packHash 变化', () => {
  const a = packOf(mkProject())
  const b = packOf(mkProject())
  assert.equal(a.packHash, b.packHash)
  const p2 = mkProject()
  p2.storyboards[1][0].voiceOnly = []
  assert.notEqual(packOf(p2).packHash, a.packHash)
})

t('B 直接调用 buildShotStateExportPack 与 videoExport 内嵌包一致；episode 过滤', () => {
  const p = mkProject()
  const direct = buildShotStateExportPack(p)
  assert.equal(direct.packHash, packOf(p).packHash)
  const none = tryBuildShotStateExportPack(p, { episode: 99 })
  assert.equal(none.ok, true, 'compat 总返回 pack')
  if (none.ok) assert.equal(none.pack.shots.length, 0)
})

t('B compileModelAdapterText 记录输入输出 hash，限长只警告不截断', () => {
  const c = compileModelAdapterText('一二三四五', adapter({ maxPromptChars: 3 }))
  assert.equal(c.text, '一二三四五')
  assert.equal(c.inputHash, hashText('一二三四五'))
  assert.equal(c.outputHash, hashText('一二三四五'))
  assert.ok(c.warnings.some((w) => w.startsWith('prompt_exceeds_adapter_limit')))
})

// ---------------- C. 手改失效的派生文本 ----------------

t('C docs 手改失效：包内 invalidated + withheld，原文保留且不可作现行', () => {
  const pack = packOf(mkProject(), { docs: { 's-1': invalidatedDoc() }, adapter: adapter() })
  const txt = pack.shots[0].texts.find((x) => x.field === 'seedancePrompt')
  assert.ok(txt)
  assert.equal(pack.shots[0].docOrigin, 'provided')
  assert.equal(txt.status, 'invalidated')
  assert.equal(txt.presentation, 'withheld')
  assert.equal(txt.usableAsCurrentPrompt, false)
  assert.equal(txt.semantic, 'review_required')
  assert.equal(txt.provenance.invalidated, true)
  assert.equal(txt.provenance.reviewRequired, true)
  assert.equal(txt.text, HAND_EDITED, '原文保留作证据')
  assert.notEqual(txt.currentTextHash, txt.provenance.textHash, '当前 hash 与派生时 hash 不一致')
  const ad = pack.shots[0].adapted.find((x) => x.field === 'seedancePrompt')
  assert.ok(ad && ad.status === 'skipped' && ad.reason.startsWith('text_withheld'), '失效文本不进入模型适配')
})

t('C 补一条 pass 审查也不能让失效派生文本变回现行（需显式 adopt）', () => {
  const d = addReview(invalidatedDoc(), { field: 'seedancePrompt', verdict: 'pass', reviewer: 'human' })
  const txt = packOf(mkProject(), { docs: { 's-1': d } }).shots[0].texts[0]
  assert.equal(txt.status, 'invalidated')
  assert.equal(txt.presentation, 'withheld')
  assert.equal(txt.usableAsCurrentPrompt, false)
})

t('C opt-in Markdown 正文不输出失效原文，附段留档并标注不得作为现行提示词', () => {
  const md = projectToMarkdown(mkProject(), { shotState: { docs: { 's-1': invalidatedDoc() } } })
  assert.ok(!body(md).includes('HAND_EDITED_PROMPT_MARKER'), '正文不得出现失效原文')
  assert.ok(body(md).includes('已失效·需审查'), '正文用失效标记占位')
  const ap = appendix(md)
  assert.ok(ap.includes('HAND_EDITED_PROMPT_MARKER'), '附段留档原文')
  assert.ok(ap.includes('失效原文（仅留档，不得作为现行提示词）'))
  assert.ok(ap.includes('invalidated'))
})

t('C opt-in Seedance 包正文不输出失效原文', () => {
  const sp = seedancePack(mkProject(), undefined, { shotState: { docs: { 's-1': invalidatedDoc() } } })
  assert.ok(!body(sp).includes('HAND_EDITED_PROMPT_MARKER'))
  assert.ok(body(sp).includes('已失效·需审查'))
  assert.ok(appendix(sp).includes('失效原文（仅留档，不得作为现行提示词）'))
})

t('C strict / run-ready 遇到失效派生文本明确拒绝', () => {
  for (const mode of ['strict', 'run-ready'] as const) {
    const r = tryBuildShotStateExportPack(mkProject(), { mode, docs: { 's-1': invalidatedDoc() } })
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(errCodes(r.rejection.blockers).includes('derived_invalidated'))
  }
})

// ---------------- D. run_required unsupported ----------------

const RUN_REQ = [{ name: 'refImageSlot', role: 'run_required' as const, supported: false }]
const CAP = [{ name: 'multiRef', role: 'capability' as const, supported: false }]

t('D 基线：已审查的状态文档可 run-ready，claims.runReady 为 true', () => {
  const r = tryBuildShotStateExportPack(mkProject(), { mode: 'run-ready', docs: { 's-1': readyDoc() } })
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.rejection.blockers))
  if (r.ok) {
    assert.equal(r.pack.claims.runReady, true)
    assert.equal(r.pack.h3.receiverDeclaresSupport, false, 'run-ready 也不声称 H3 已支持')
  }
})

t('D run_required unsupported：run-ready 明确拒绝（try 返回 ok:false，build / 管线导出抛错）', () => {
  const o: ShotStateExportOptions = { mode: 'run-ready', docs: { 's-1': readyDoc() }, adapter: adapter({ fieldDecls: RUN_REQ }) }
  const r = tryBuildShotStateExportPack(mkProject(), o)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.rejection.mode, 'run-ready')
    assert.ok(errCodes(r.rejection.blockers).includes('run_required_unsupported'))
    assert.equal(r.rejection.notice, H3_SUPPORT_NOTICE)
    assert.ok(!('pack' in r), '拒绝时不产出包')
  }
  assert.throws(() => buildShotStateExportPack(mkProject(), o), rejected)
  assert.throws(() => buildVideoPipelineExport(mkProject(), { shotStateExport: o }), rejected)
  assert.throws(() => projectToMarkdown(mkProject(), { shotState: o }), rejected)
  assert.throws(() => seedancePack(mkProject(), undefined, { shotState: o }), rejected)
})

t('D run_required unsupported 在 compat 只记录：包存在但 runReady 为 false 且不具备 run-ready 资格', () => {
  const pack = packOf(mkProject(), { docs: { 's-1': readyDoc() }, adapter: adapter({ fieldDecls: RUN_REQ }) })
  assert.equal(pack.mode, 'compat')
  assert.equal(pack.claims.runReady, false)
  assert.equal(pack.readiness.runReadyEligible, false)
  assert.ok(errCodes(pack.readiness.runReadyBlockers).includes('run_required_unsupported'))
  assert.deepEqual(pack.shots[0].fields.runRequiredUnsupported, ['refImageSlot'])
  assert.ok(appendix(projectToMarkdown(mkProject(), { shotState: { docs: { 's-1': readyDoc() }, adapter: adapter({ fieldDecls: RUN_REQ }) } })).includes('阻断 run-ready'))
})

t('D capability unsupported：只记录/警告，不阻断，也不冒充已支持', () => {
  const o: ShotStateExportOptions = { mode: 'run-ready', docs: { 's-1': readyDoc() }, adapter: adapter({ fieldDecls: CAP }) }
  const pack = buildShotStateExportPack(mkProject(), o)
  const s = pack.shots[0]
  assert.deepEqual(s.fields.capabilityUnsupported, ['multiRef'])
  const decl = s.fields.declared.find((d) => d.name === 'multiRef')
  assert.ok(decl && decl.supported === false, '声明保持 unsupported')
  assert.ok(pack.warnings.some((w) => w.code === 'capability_unsupported' && w.field === 'multiRef'))
  assert.ok(!pack.blockers.some((b) => b.code === 'capability_unsupported'))
  assert.equal(pack.h3.receiverDeclaresSupport, false)
  const md = projectToMarkdown(mkProject(), { shotState: o })
  assert.ok(appendix(md).includes('仅记录，不代表已支持'))
})

// ---------------- E. unknown 不是 pass 也不是已证明 contradiction ----------------

t('E 旧镜头 unknown：pack.review 为 unknown，文本 presentation=unreviewed，不是 pass / fail', () => {
  const pack = packOf(mkProject())
  assert.equal(pack.review.status, 'unknown')
  assert.equal(pack.review.counts.unknown, 1)
  assert.equal(pack.review.counts.pass, 0)
  assert.equal(pack.review.counts.fail, 0)
  assert.equal(pack.claims.semanticPass, false)
  const s = pack.shots[0]
  assert.equal(s.review.status, 'unknown')
  for (const x of s.texts) {
    assert.equal(x.semantic, 'unknown')
    assert.equal(x.presentation, 'unreviewed')
    assert.equal(x.usableAsCurrentPrompt, false)
  }
  const sem = s.compat.semantic.issues
  assert.ok(sem.length > 0 && sem.every((i) => i.code === 'semantic_unknown' && i.confidence === 'unknown' && i.severity === 'info'))
  assert.ok(!s.compat.issues.some((i) => i.code === 'semantic_fail'), 'unknown 不是已证明矛盾')
  assert.equal(s.compat.ok, true, 'compat 不因 unknown 拒绝')
})

t('E 未审查文本在 opt-in 正文带「未审查」标记，附段声明既不是通过也不是矛盾', () => {
  const md = projectToMarkdown(mkProject(), { shotState: true })
  assert.ok(body(md).includes(`【未审查·unknown】${SHOT.seedancePrompt}`))
  const ap = appendix(md)
  assert.ok(ap.includes('未审查，不得当作已通过'))
  assert.ok(ap.includes('既不是通过，也不是已证明矛盾'))
  assert.ok(ap.includes('不是语义 pass'))
})

t('E 显式 fail 审查是 fail，不是 unknown：compat 仍出包但正文隐去该文本', () => {
  const d = addReview(readyDoc(), { field: 'seedancePrompt', verdict: 'fail', reviewer: 'human' })
  const pack = packOf(mkProject(), { docs: { 's-1': d } })
  const txt = pack.shots[0].texts.find((x) => x.field === 'seedancePrompt')
  assert.ok(txt)
  assert.equal(txt.semantic, 'fail')
  assert.equal(txt.presentation, 'withheld')
  assert.equal(pack.review.status, 'fail')
  const r = tryBuildShotStateExportPack(mkProject(), { mode: 'strict', docs: { 's-1': d } })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(errCodes(r.rejection.blockers).includes('semantic_fail'))
})

// ---------------- F. 只补结构字段不能让散文冲突变 semantic pass ----------------

const conflictDoc = (): ShotStateDoc => {
  let d = createShotState({
    shotId: 's-1',
    cast: ['c-a', 'c-b'],
    displayOrder: ['c-a', 'c-b'],
    firstFrame: [
      { id: 'c-a', kind: 'full' },
      { id: 'c-b', kind: 'full' },
    ],
  })
  d = deriveText(d, 'castLine', (id) => (id === 'c-a' ? '角色甲' : '角色乙'))
  d = deriveText(d, 'firstFrameLine', (id) => (id === 'c-a' ? '角色甲' : '角色乙'))
  d = setText(d, 'action', '角色甲独自站在门外，角色乙不在场')
  d = setText(d, 'seedancePrompt', '角色甲与角色乙并肩站在屋内')
  return d
}

t('F 结构字段齐全且派生文本有效，但散文冲突无审查：语义仍是 unknown，不是 pass', () => {
  const pack = packOf(mkProject(), { docs: { 's-1': conflictDoc() } })
  const s = pack.shots[0]
  assert.equal(s.compat.structural.ok, true)
  assert.deepEqual(s.unverifiedCharacterIds, [])
  assert.equal(s.review.status, 'unknown')
  assert.equal(pack.review.status, 'unknown')
  assert.equal(pack.claims.semanticPass, false)
  assert.equal(pack.claims.runReady, false)
  for (const f of ['action', 'seedancePrompt']) {
    const x = s.texts.find((y) => y.field === f)
    assert.ok(x)
    assert.equal(x.semantic, 'unknown')
    assert.equal(x.presentation, 'unreviewed')
  }
  for (const f of ['castLine', 'firstFrameLine']) {
    const x = s.texts.find((y) => y.field === f)
    assert.ok(x)
    assert.equal(x.semantic, 'derived_valid', '派生有效只是模板层结论')
    assert.equal(x.provenance.source, 'derived')
    assert.equal(x.provenance.compilerId, `shot-state/${f}`)
    assert.ok(x.provenance.compilerVersion)
    assert.equal(x.provenance.sourceHash, s.sourceHash)
    assert.equal(x.status, 'valid_derived')
  }
  assert.ok(!s.compat.issues.some((i) => i.code === 'semantic_fail'), '也没有被证明矛盾')
})

t('F 同一文档 strict / run-ready 拒绝，原因是 semantic_unknown 而不是 semantic_fail', () => {
  for (const mode of ['strict', 'run-ready'] as const) {
    const r = tryBuildShotStateExportPack(mkProject(), { mode, docs: { 's-1': conflictDoc() } })
    assert.equal(r.ok, false)
    if (!r.ok) {
      const codes = errCodes(r.rejection.blockers)
      assert.ok(codes.includes('semantic_unknown'))
      assert.ok(!codes.includes('semantic_fail'))
      assert.ok(!codes.includes('firstframe_unverified'), '结构已补齐')
    }
  }
})

// ---------------- G. 旧镜头 run-ready 拒绝 ----------------

t('G 默认旧镜头（仅 characterIds 等）run-ready 明确拒绝，不产出包', () => {
  const r = tryBuildShotStateExportPack(mkProject(), { mode: 'run-ready' })
  assert.equal(r.ok, false)
  if (!r.ok) {
    const codes = errCodes(r.rejection.blockers)
    assert.ok(codes.includes('firstframe_unverified'))
    assert.ok(codes.includes('semantic_unknown'))
    assert.ok(r.rejection.reason.includes('run-ready'))
    assert.ok(!('pack' in r))
  }
  assert.throws(() => buildShotStateExportPack(mkProject(), { mode: 'run-ready' }), rejected)
  assert.throws(() => buildVideoPipelineExport(mkProject(), { shotStateExport: { mode: 'run-ready' } }), rejected)
  assert.throws(() => projectToMarkdown(mkProject(), { shotState: { mode: 'run-ready' } }), rejected)
  assert.throws(() => seedancePack(mkProject(), 1, { shotState: { mode: 'run-ready' } }), rejected)
})

t('G 旧镜头 strict 同样拒绝；compat 出包但 claims.runReady 为 false 且不具备资格', () => {
  const r = tryBuildShotStateExportPack(mkProject(), { mode: 'strict' })
  assert.equal(r.ok, false)
  const pack = packOf(mkProject())
  assert.equal(pack.claims.runReady, false)
  assert.equal(pack.readiness.runReadyEligible, false)
  assert.equal(pack.readiness.strictOk, false)
  assert.ok(errCodes(pack.readiness.runReadyBlockers).includes('firstframe_unverified'))
  const md = projectToMarkdown(mkProject(), { shotState: true })
  assert.ok(appendix(md).includes('本包是否自称 run-ready：否'))
})

t('G 没有可导出分镜时 run-ready 也拒绝（no_shots），不是空包通过', () => {
  const r = tryBuildShotStateExportPack(mkProject(), { mode: 'run-ready', episode: 99 })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(errCodes(r.rejection.blockers).includes('no_shots'))
  const compat = packOf(mkProject(), { episode: 99 })
  assert.equal(compat.claims.runReady, false)
  assert.equal(compat.claims.semanticPass, false)
})

// ---------------- H. 默认 Markdown/Seedance 不变；opt-in 附段 ----------------

t('H opt-in Markdown：明确附段含 H3_SUPPORT_NOTICE，现行提示词路径走 shotStatePromptView', () => {
  const p = mkProject()
  const md = projectToMarkdown(p, { shotState: true })
  assert.notEqual(md, projectToMarkdown(p))
  assert.ok(md.includes(APPENDIX_HEAD))
  assert.ok(md.includes('opt-in'))
  assert.ok(appendix(md).includes(H3_SUPPORT_NOTICE))
  const pack = buildShotStateExportPack(p)
  assert.ok(appendix(md).includes(pack.packHash))
  const view = shotStatePromptView(pack)(SHOT.id, SHOT.seedancePrompt)
  assert.ok(view.startsWith('【未审查·unknown】'))
  assert.ok(body(md).includes(view))
  assert.ok(!body(md).includes(`\n${SHOT.seedancePrompt}\n`), '未加标记的原文不再作为现行提示词出现')
  assert.ok(md.endsWith(renderShotStateAppendix(pack, 2).join('\n')), '附段由 renderShotStateAppendix 渲染并追加在末尾')
})

t('H opt-in Seedance：附段含 H3_SUPPORT_NOTICE，提示词经 shotStatePromptView', () => {
  const p = mkProject()
  const sp = seedancePack(p, undefined, { shotState: true })
  assert.notEqual(sp, seedancePack(p))
  assert.ok(appendix(sp).includes(H3_SUPPORT_NOTICE))
  const pack = buildShotStateExportPack(p)
  const view = shotStatePromptView(pack)(SHOT.id, SHOT.seedancePrompt)
  assert.ok(body(sp).includes(view))
  assert.ok(!body(sp).includes(`\n${SHOT.seedancePrompt}\n`))
})

t('H 提示词已审查 pass（现行）时：opt-in 正文与默认逐字相同，只多出附段', () => {
  const o = { shotState: { docs: { 's-1': readyDoc() } } }
  const p = mkProject()
  const pack = buildShotStateExportPack(p, o.shotState)
  assert.equal(shotStatePromptView(pack)(SHOT.id, SHOT.seedancePrompt), SHOT.seedancePrompt)
  const sp = seedancePack(p, undefined, o)
  assert.ok(sp.startsWith(seedancePack(p)))
  assert.ok(appendix(sp).includes(H3_SUPPORT_NOTICE))
  const md = projectToMarkdown(p, o)
  assert.ok(md.startsWith(projectToMarkdown(p)))
  assert.ok(appendix(md).includes(H3_SUPPORT_NOTICE))
})

t('H 提示词视图：未知镜头 id 不丢原文且带未审查标记；空原文保持为空', () => {
  const view = shotStatePromptView(buildShotStateExportPack(mkProject()))
  assert.equal(view('no-such-shot', '原文'), '【未审查·unknown】原文')
  assert.equal(view('no-such-shot', ''), '')
})

t('H seedancePack 指定 episode 时附包只含该集', () => {
  const sp = seedancePack(mkProject(), 1, { shotState: true })
  assert.ok(appendix(sp).includes('镜 s-1'))
  assert.equal(sha256(seedancePack(mkProject(), 1)), HASH_SEEDANCE, '默认带 episode 与不带 episode 一致')
})

console.log(`\n${pass} tests passed`)
