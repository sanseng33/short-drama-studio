/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-check-entry.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { hasDefiniteMissing } from '../src/lib/dialogueAudit'
import { generateStoryboardChecked } from '../src/lib/generator'
import { applyOneClickStoryboard } from '../src/lib/consistency/scriptLockGuards'
import { isPipelineJsonBlocked } from '../src/lib/consistency/exportWarnings'
import type { Project } from '../src/types'
import { STORYBOARD_SYSTEM } from '../src/lib/llm'
import { storyboardUser } from '../src/lib/prompts'
import { readFileSync as rf } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))

const base = (): Project => ({
  id: 'p',
  title: 't',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 60,
  style: '真人都市',
  logline: 'l',
  characters: [
    { id: 'c-li', name: '小李', role: '主角', visualLock: '短发', costume: '白衬衫', signatureProp: '手表' },
    { id: 'c-wang', name: '小王', role: '配角', visualLock: '长发', costume: '夹克', signatureProp: '背包' },
  ],
  outline: [{ episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }],
  scripts: {},
  storyboards: {},
  selectedEpisode: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

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

t('无剧本不抛错，状态 no_script', () => {
  const p = base()
  p.storyboards[1] = [
    {
      id: 's1-1',
      shotNo: 1,
      size: '近景',
      durationSec: 3,
      visual: '室内',
      action: '坐',
      dialogue: '',
      camera: '固定',
      emotion: '平静',
      seedancePrompt: '室内',
    },
  ]
  const next = applyDialogueAuditToProject(p, 1)
  assert.equal(next.dialogueAudit![1].status, 'no_script')
  assert.deepEqual(next.storyboards[1], p.storyboards[1])
})

t('F01 经统一入口写入 dialogueAudit，不改分镜，可检出确定缺词', () => {
  const fx = JSON.parse(readFileSync(join(here, 'fixtures/dialogue-audit/f01-baseline.json'), 'utf8'))
  const p = base()
  p.scripts[1] = { episode: 1, title: '一', beats: [], fullText: fx.script.fullText }
  p.storyboards[1] = fx.shots
  const shotsSnap = JSON.parse(JSON.stringify(p.storyboards[1]))
  const next = applyDialogueAuditToProject(p, 1)
  assert.deepEqual(next.storyboards[1], shotsSnap)
  assert.equal(next.dialogueAudit![1].status, 'checked')
  assert.ok(hasDefiniteMissing(next.dialogueAudit![1].findings))
  assert.equal(collectFindings(next).filter((f) => f.code === 'dialogue_missing').length, 2)
  assert.ok(next.fingerprints?.scriptHashByEpisode?.[1])
})

t('重新检查幂等（finding codes 稳定）', () => {
  const fx = JSON.parse(readFileSync(join(here, 'fixtures/dialogue-audit/f01-baseline.json'), 'utf8'))
  const p = base()
  p.scripts[1] = { episode: 1, title: '一', beats: [], fullText: fx.script.fullText }
  p.storyboards[1] = fx.shots
  const a = applyDialogueAuditToProject(p, 1)
  const b = applyDialogueAuditToProject(a, 1)
  assert.deepEqual(
    a.dialogueAudit![1].findings.map((f) => f.code),
    b.dialogueAudit![1].findings.map((f) => f.code),
  )
})

t('提示词含不得无说明丢词（模板与 LLM 共用约束）', () => {
  assert.ok(STORYBOARD_SYSTEM.includes('不得无说明丢词'))
  const p = base()
  const user = storyboardUser(p, p.outline[0], '小李：你来了。')
  assert.ok(user.includes('不得无说明丢词'))
})

t('一键分镜步（IdeaPanel 调用的 applyOneClickStoryboard）仍经审计：findings 写入、对白不被改写、锁定集保留原分镜', () => {
  const fx = JSON.parse(readFileSync(join(here, 'fixtures/dialogue-audit/f01-baseline.json'), 'utf8'))
  const dialoguesOf = (shots: { dialogue: string }[]) => shots.map((s) => s.dialogue)
  const fixtureDialogues = dialoguesOf(fx.shots)

  // 未锁定：写入 makeShots() 的结果，并在同一步审计出 2 条确定缺词
  const prev = base()
  const proj = base()
  proj.scripts[1] = { episode: 1, title: '一', beats: [], fullText: fx.script.fullText }
  let made = 0
  const r = applyOneClickStoryboard(prev, proj, 1, () => (made++, JSON.parse(JSON.stringify(fx.shots))))
  assert.equal(r.kept, false)
  assert.equal(made, 1)
  assert.deepEqual(dialoguesOf(r.project.storyboards[1]), fixtureDialogues)
  assert.equal(r.project.dialogueAudit![1].status, 'checked')
  assert.equal(r.project.dialogueAudit![1].findings.filter((f) => f.code === 'dialogue_missing').length, 2)
  assert.equal(collectFindings(r.project).filter((f) => f.code === 'dialogue_missing').length, 2)
  assert.ok(r.project.fingerprints?.scriptHashByEpisode?.[1])
  assert.equal(isPipelineJsonBlocked(r.project), true)

  // 锁定且已有分镜：不调用 makeShots，分镜原样保留，仍写入审计结果
  const lockedPrev: Project = { ...proj, locks: { scripts: { 1: true } }, storyboards: { 1: JSON.parse(JSON.stringify(fx.shots)) } }
  const lockedProj: Project = { ...lockedPrev }
  const shotsSnap = JSON.parse(JSON.stringify(lockedProj.storyboards[1]))
  made = 0
  const k = applyOneClickStoryboard(lockedPrev, lockedProj, 1, () => (made++, []))
  assert.equal(k.kept, true)
  assert.equal(made, 0)
  assert.deepEqual(k.project.storyboards[1], shotsSnap)
  assert.equal(k.project.scripts[1].fullText, fx.script.fullText)
  assert.equal(k.project.dialogueAudit![1].status, 'checked')
  assert.equal(k.project.dialogueAudit![1].findings.filter((f) => f.code === 'dialogue_missing').length, 2)

  // 辅助源码断言（不是唯一证据）：分步与一键入口都使用生产函数
  const hook = rf(join(here, '../src/hooks/useProject.ts'), 'utf8')
  assert.ok(hook.includes('generateStoryboardChecked') && hook.includes('applyDialogueAuditToProject'))
  const idea = rf(join(here, '../src/components/IdeaPanel.tsx'), 'utf8')
  assert.ok(idea.includes('generateStoryboardChecked') && idea.includes('applyOneClickStoryboard'))
})

// ---- 生产路径：LLM 分镜 → generateStoryboardChecked → applyDialogueAuditToProject（与 useProject / IdeaPanel 相同顺序）----

const fixture = (name: string) => JSON.parse(readFileSync(join(here, 'fixtures/dialogue-audit', name), 'utf8'))
const outline1 = { episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }
const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

async function main() {
  const f01 = fixture('f01-baseline.json')
  const rawShots = (f01.shots as Record<string, unknown>[]).map((s) => ({ ...s, characters: ['小李'] }))
  const withScript = (): Project => {
    const p = base()
    p.scripts[1] = { episode: 1, title: '一', beats: [], fullText: f01.script.fullText }
    return p
  }

  await ta('LLM 分镜（假 LLM 返回 f01 分镜）→ 生成后审计写入 findings 并可检出确定缺词，对白不被改写', async () => {
    const p = withScript()
    const calls: string[] = []
    const llm = async (_s: string, u: string) => (calls.push(u), JSON.stringify(rawShots))
    const r = await generateStoryboardChecked(llm, p, p.outline[0], p.scripts[1].fullText, { maxRepairs: 0 })
    assert.equal(r.shots.length, 4)
    assert.deepEqual(r.shots.map((s) => s.dialogue), (f01.shots as { dialogue: string }[]).map((s) => s.dialogue))
    assert.ok(calls[0].includes('不得无说明丢词'))
    // 上一版没有分镜（[]）：没有「修复前已匹配」的台词，缺词是 dialogue_missing，不是 dropped_silent
    const next = applyDialogueAuditToProject({ ...p, storyboards: { 1: r.shots } }, 1, { previousShots: [] })
    assert.equal(next.dialogueAudit![1].status, 'checked')
    const all = collectFindings(next)
    assert.equal(all.filter((f) => f.code === 'dialogue_dropped_silent').length, 0)
    const missing = all.filter((f) => f.code === 'dialogue_missing')
    assert.equal(missing.length, 2)
    assert.ok(missing.every((f) => f.confidence === 'definite'))
    assert.deepEqual(
      missing.map((f) => (f as { lineText?: string }).lineText).sort(),
      ['我们谈谈正事。', '我等了很久。'].sort(),
    )
    assert.ok(hasDefiniteMissing(next.dialogueAudit![1].findings))
    assert.deepEqual(next.storyboards[1], r.shots)
    assert.deepEqual(next.scripts[1].fullText, f01.script.fullText)
    assert.ok(next.fingerprints?.scriptHashByEpisode?.[1])
    assert.equal(isPipelineJsonBlocked(next), true)

    // 上一版含全部 6 句、本次丢了两句：才是 dialogue_dropped_silent（仍属确定缺词，仍拦截）
    // 按剧本顺序排列，避免上一版自身出现顺序变化
    const prevShots = [
      r.shots[0],
      { ...r.shots[0], id: 's1-5', shotNo: 5, dialogue: '小李：我等了很久。' },
      r.shots[1],
      r.shots[2],
      r.shots[3],
      { ...r.shots[0], id: 's1-6', shotNo: 6, dialogue: '小李：我们谈谈正事。' },
    ]
    const dropped = applyDialogueAuditToProject({ ...p, storyboards: { 1: r.shots } }, 1, { previousShots: prevShots })
    const dFindings = collectFindings(dropped)
    assert.equal(dFindings.filter((f) => f.code === 'dialogue_missing').length, 0)
    const silent = dFindings.filter((f) => f.code === 'dialogue_dropped_silent')
    assert.equal(silent.length, 2)
    assert.ok(silent.every((f) => f.confidence === 'definite'))
    assert.deepEqual(
      silent.map((f) => (f as { lineText?: string }).lineText).sort(),
      ['我们谈谈正事。', '我等了很久。'].sort(),
    )
    assert.ok(hasDefiniteMissing(dropped.dialogueAudit![1].findings))
    assert.deepEqual(dropped.storyboards[1], r.shots)
    assert.equal(isPipelineJsonBlocked(dropped), true)
  })

  await ta('LLM 先返回非 JSON、再返回合法数组：修复循环恢复，提示含无法解析说明，随后审计可用', async () => {
    const p = withScript()
    const prompts: string[] = []
    const llm = async (_s: string, u: string) => (prompts.push(u), prompts.length === 1 ? '抱歉，这里没有 JSON' : '```json\n' + JSON.stringify(rawShots) + '\n```')
    const r = await generateStoryboardChecked(llm, p, p.outline[0], p.scripts[1].fullText, { maxRepairs: 2 })
    assert.ok(prompts.length >= 2)
    assert.ok(prompts[1].includes('无法解析为 JSON 数组'))
    assert.equal(r.shots.length, 4)
    const next = applyDialogueAuditToProject({ ...p, storyboards: { 1: r.shots } }, 1)
    assert.equal(next.dialogueAudit![1].status, 'checked')
  })

  await ta('LLM 始终不可解析：generateStoryboardChecked 抛错，原项目不被改动（调用方 catch 后不写项目）', async () => {
    const p = withScript()
    const before = deepCopy(p)
    let n = 0
    const llm = async () => (n++, '完全不是 JSON')
    await assert.rejects(
      generateStoryboardChecked(llm, p, p.outline[0], p.scripts[1].fullText, { maxRepairs: 1 }),
      /no parseable output/,
    )
    assert.equal(n, 2)
    assert.deepEqual(p, before)
  })

  await ta('LLM 调用抛错（网络失败）：无可用输出时 generateStoryboardChecked 整体拒绝，不产生部分结果', async () => {
    const p = withScript()
    const llm = async () => {
      throw new Error('network down')
    }
    // llm 抛错与解析失败走同一 catch 分支；最终无可用输出时抛 no parseable output
    await assert.rejects(generateStoryboardChecked(llm, p, p.outline[0], '', { maxRepairs: 0 }), /no parseable output/)
  })

  await ta('检查入口：剧本只有场次与动作（F12）→ unparseable，不计确定缺词、不拦截，且不改分镜', async () => {
    const fx = fixture('f12-unparseable-script.json')
    const p = base()
    p.scripts[1] = { episode: 1, title: '一', beats: [], fullText: fx.script.fullText }
    p.storyboards[1] = fx.shots
    const snap = deepCopy(p.storyboards[1])
    const next = applyDialogueAuditToProject(p, 1)
    assert.equal(next.dialogueAudit![1].status, 'unparseable')
    assert.ok(next.dialogueAudit![1].findings.some((f) => f.code === 'dialogue_unparseable'))
    assert.equal(hasDefiniteMissing(next.dialogueAudit![1].findings), false)
    assert.deepEqual(next.storyboards[1], snap)
    assert.equal(isPipelineJsonBlocked(next), false)
  })

  await ta('检查入口：有剧本无分镜 → no_storyboard；重新检查（recheck 同一入口）幂等，且不抛错', async () => {
    const p = withScript()
    const a = applyDialogueAuditToProject(p, 1)
    assert.equal(a.dialogueAudit![1].status, 'no_storyboard')
    const b = applyDialogueAuditToProject(a, 1)
    assert.equal(b.dialogueAudit![1].status, 'no_storyboard')
    assert.deepEqual(b.scripts, p.scripts)
  })

  await ta('检查入口：分镜被手动改写后重新检查，状态随之更新（缺词 → 补齐）', async () => {
    const p = withScript()
    p.storyboards[1] = f01.shots
    const missing = applyDialogueAuditToProject(p, 1)
    assert.equal(missing.dialogueAudit![1].findings.filter((f) => f.code === 'dialogue_missing').length, 2)
    const fixed = deepCopy(missing)
    fixed.storyboards[1] = [
      ...fixed.storyboards[1],
      { ...fixed.storyboards[1][0], id: 's1-5', shotNo: 5, dialogue: '小李：我等了很久。' },
      { ...fixed.storyboards[1][0], id: 's1-6', shotNo: 6, dialogue: '小李：我们谈谈正事。' },
    ]
    const after = applyDialogueAuditToProject(fixed, 1)
    const afterFindings = after.dialogueAudit![1].findings
    assert.equal(afterFindings.filter((f) => f.code === 'dialogue_missing').length, 0)
    assert.equal(afterFindings.filter((f) => f.code === 'dialogue_dropped_silent').length, 0)
    assert.equal(hasDefiniteMissing(afterFindings), false)
    assert.equal(isPipelineJsonBlocked(after), false)
  })

  console.log(`\n${pass} tests passed`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
