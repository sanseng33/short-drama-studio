/** 状态：未执行。
 * 建议命令：npx tsc -b && npx --yes tsx scripts/test-script-dialogue.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditEpisodeDialogue, hasDefiniteMissing } from '../src/lib/dialogueAudit'
import { parseScriptDialogue } from '../src/lib/scriptDialogue'
import { migrateProject } from '../src/lib/consistency/migrate'
import { normalizeDialogueKey } from '../src/lib/consistency/dialogueNormalize'
import type { AcceptedRisk, CheckFinding } from '../src/lib/consistency/types'
import type { Character } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const auditDir = join(here, 'fixtures/dialogue-audit')
const legacyDir = join(here, 'fixtures/legacy-projects')

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

type ExpectFinding = {
  code: string
  lineText?: string
  occurrence?: number
  confidence?: string
  accepted?: boolean
  evidence?: string
  shotIds?: string[]
}

type Expect = {
  status: string
  definiteMissingCount: number
  findings: ExpectFinding[]
  shotsUnchanged?: boolean
}

type Fixture = {
  id: string
  episode?: number
  script?: { fullText?: string; beats?: { label?: string; content?: string; dialogue?: string }[]; episode?: number }
  characters?: Character[]
  shots?: unknown
  shotsBefore?: unknown
  acceptedRisks?: AcceptedRisk[]
  settingFacts?: string[]
  expect?: Expect
  cases?: (Fixture & { id: string })[]
  legacyFiles?: { path: string; expectAuditStatus: string }[]
}

function loadJson(path: string): Fixture {
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture
}

function lineKey(text: string | undefined): string {
  return normalizeDialogueKey(text || '')
}

function matchFinding(actual: CheckFinding & { lineText?: string; occurrence?: number; accepted?: boolean; shotIds?: string[] }, exp: ExpectFinding): boolean {
  if (actual.code !== exp.code) return false
  if (exp.occurrence != null && (actual.occurrence || 1) !== exp.occurrence) return false
  if (exp.confidence && actual.confidence !== exp.confidence) return false
  if (exp.accepted != null && Boolean(actual.accepted) !== exp.accepted) return false
  if (exp.lineText && exp.code !== 'dialogue_order_changed') {
    if (lineKey(actual.lineText || actual.message || '') !== lineKey(exp.lineText)) return false
  }
  // M2 在多条等长 LCS 之间只要求 1 条 order_changed，具体是哪一句取决于并列取舍；键集合仍须来自剧本。
  return true
}

function runCase(fx: Fixture, label: string) {
  const script = fx.script || { fullText: '' }
  const shots = fx.shots ?? []
  const characters = fx.characters || []
  const scriptSnap = JSON.parse(JSON.stringify(script))
  const shotsSnap = JSON.parse(JSON.stringify(shots))
  const result = auditEpisodeDialogue(script, shots, characters, fx.acceptedRisks, {
    previousShots: fx.shotsBefore,
    episode: fx.episode || script.episode || 1,
  })
  const result2 = auditEpisodeDialogue(JSON.parse(JSON.stringify(script)), JSON.parse(JSON.stringify(shots)), characters, fx.acceptedRisks, {
    previousShots: fx.shotsBefore ? JSON.parse(JSON.stringify(fx.shotsBefore)) : undefined,
    episode: fx.episode || script.episode || 1,
  })
  assert.deepEqual(result, result2, `${label} 非确定`)
  assert.deepEqual(script, scriptSnap, `${label} 改写了 script`)
  assert.deepEqual(shots, shotsSnap, `${label} 改写了 shots`)

  const exp = fx.expect
  if (!exp) return
  assert.equal(result.status, exp.status, `${label} status 实际 ${result.status} 期望 ${exp.status}`)
  assert.equal(result.definiteMissingCount, exp.definiteMissingCount, `${label} definiteMissingCount 实际 ${result.definiteMissingCount} 期望 ${exp.definiteMissingCount} findings=${JSON.stringify(result.findings, null, 2)}`)

  const unused = result.findings.map((f) => f)
  for (const e of exp.findings || []) {
    const idx = unused.findIndex((a) => matchFinding(a as CheckFinding & { lineText?: string; occurrence?: number; accepted?: boolean }, e))
    assert.ok(idx >= 0, `${label} 缺少 finding ${JSON.stringify(e)}；实际 ${JSON.stringify(result.findings, null, 2)}`)
    unused.splice(idx, 1)
  }
  // 允许实现多给 speaker_unresolved 等附加项？编排测试说按期望输出。严格：不得多出未声明的 definite 缺失，其他附加 warning 先报错以便对齐。
  const unexpected = unused.filter((f) => f.code !== 'ignore')
  assert.equal(unexpected.length, 0, `${label} 多出 finding ${JSON.stringify(unexpected, null, 2)}`)

  if (exp.shotsUnchanged) assert.deepEqual(shots, shotsSnap)
}

t('空输入不抛错', () => {
  const a = auditEpisodeDialogue(undefined, undefined, undefined)
  assert.equal(a.status, 'no_script')
  const b = auditEpisodeDialogue({ fullText: '' }, [], [])
  assert.equal(b.status, 'no_script')
  const c = auditEpisodeDialogue({ fullText: '小李：你好。' }, [], [])
  assert.equal(c.status, 'no_storyboard')
  const d = auditEpisodeDialogue({ fullText: '小李：你好。' }, [{ dialogue: undefined }], [])
  assert.ok(d)
  parseScriptDialogue(null)
})

const files = readdirSync(auditDir).filter((f) => f.endsWith('.json')).sort()
for (const file of files) {
  const fx = loadJson(join(auditDir, file))
  if (fx.id === 'F23') {
    t('F23 不在本包断言 voice_missing / export（只确认可加载且台词审计不崩溃）', () => {
      const r = auditEpisodeDialogue(fx.script, fx.shots, fx.characters || [])
      assert.equal(r.status, 'checked')
      assert.equal(r.definiteMissingCount, 0)
    })
    continue
  }
  if (fx.id === 'F22') {
    t('F22 旧项目全部不崩溃且状态明确', () => {
      const statuses: string[] = []
      for (const item of fx.legacyFiles || []) {
        const raw = JSON.parse(readFileSync(join(auditDir, item.path), 'utf8'))
        const migrated = migrateProject(raw)
        assert.equal(migrated.ok, true, item.path)
        if (!migrated.ok) continue
        const p = migrated.project
        const scripts = Object.values(p.scripts || {})
        const script = scripts[0] || { fullText: '' }
        const shots = (p.storyboards && p.storyboards[1]) || []
        const r = auditEpisodeDialogue(script, shots, p.characters)
        assert.equal(r.status, item.expectAuditStatus, `${item.path} ${r.status}`)
        statuses.push(r.status)
        assert.equal(r.definiteMissingCount, 0)
      }
      assert.deepEqual(statuses, fx.expect?.statuses)
    })
    continue
  }
  if (fx.cases) {
    for (const c of fx.cases) {
      t(`${fx.id}/${c.id} ${file}`, () => runCase({ ...fx, ...c, id: c.id, characters: c.characters || fx.characters }, `${fx.id}/${c.id}`))
    }
  } else {
    t(`${fx.id} ${file}`, () => runCase(fx, fx.id))
  }
}

t('hasDefiniteMissing 忽略已接受风险', () => {
  const fx = loadJson(join(auditDir, 'f21-accepted-risk.json'))
  const r = auditEpisodeDialogue(fx.script, fx.shots, fx.characters, fx.acceptedRisks)
  assert.equal(hasDefiniteMissing(r.findings, fx.acceptedRisks), true)
  assert.equal(r.definiteMissingCount, 1)
})

// 源码不含网络 / LLM
t('实现源码只含本地字符串与数值计算', () => {
  const src = [
    readFileSync(join(here, '../src/lib/dialogueAudit.ts'), 'utf8'),
    readFileSync(join(here, '../src/lib/scriptDialogue.ts'), 'utf8'),
    readFileSync(join(here, '../src/lib/consistency/dialogueNormalize.ts'), 'utf8'),
  ].join('\n')
  assert.equal(/fetch\(|axios|openai|chatCompletion/i.test(src), false)
})

console.log(`\n${pass} tests passed`)
