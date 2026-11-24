/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-check-entry.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { hasDefiniteMissing } from '../src/lib/dialogueAudit'
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
  // 分步 LLM 已改走 generateStoryboardChecked
  const hook = rf(join(here, '../src/hooks/useProject.ts'), 'utf8')
  assert.ok(hook.includes('generateStoryboardChecked'))
  const idea = rf(join(here, '../src/components/IdeaPanel.tsx'), 'utf8')
  assert.ok(idea.includes('applyDialogueAuditToProject'))
})

console.log(`\n${pass} tests passed`)
