/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-idea.ts */
import assert from 'node:assert/strict'
import {
  MAX_IDEA_EPISODES,
  applyDeclaredEpisodeCount,
  heuristicIdea,
  parseEpisodeCount,
  parseIdeaJson,
  toOutline,
  IDEA_SYSTEM,
} from '../src/lib/idea'
import type { IdeaResult } from '../src/lib/idea'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

t('parseEpisodeCount：常见写法（阿拉伯数字）', () => {
  assert.equal(parseEpisodeCount('1集'), 1)
  assert.equal(parseEpisodeCount('拍1集'), 1)
  assert.equal(parseEpisodeCount('想拍 6 集'), 6)
  assert.equal(parseEpisodeCount('共12集的都市爽剧'), 12)
  assert.equal(parseEpisodeCount('第1集'), 1)
})

t('parseEpisodeCount：中文数字 一到十及以上', () => {
  assert.equal(parseEpisodeCount('一集'), 1)
  assert.equal(parseEpisodeCount('拍一集'), 1)
  assert.equal(parseEpisodeCount('做两集'), 2)
  assert.equal(parseEpisodeCount('二集'), 2)
  assert.equal(parseEpisodeCount('想拍三集'), 3)
  assert.equal(parseEpisodeCount('四集'), 4)
  assert.equal(parseEpisodeCount('五集'), 5)
  assert.equal(parseEpisodeCount('六集'), 6)
  assert.equal(parseEpisodeCount('七集'), 7)
  assert.equal(parseEpisodeCount('八集'), 8)
  assert.equal(parseEpisodeCount('九集'), 9)
  assert.equal(parseEpisodeCount('十集'), 10)
  assert.equal(parseEpisodeCount('共十二集'), 12)
  assert.equal(parseEpisodeCount('二十集'), 20)
  assert.equal(parseEpisodeCount('第一集'), 1)
})

t('parseEpisodeCount：未写集数返回 undefined，非集数用法不误判', () => {
  assert.equal(parseEpisodeCount(''), undefined)
  assert.equal(parseEpisodeCount('富二代被同学欺负后逆袭。'), undefined)
  assert.equal(parseEpisodeCount('每集60秒'), undefined)
  assert.equal(parseEpisodeCount('他在一集团公司上班'), undefined)
  assert.equal(parseEpisodeCount('拍0集'), undefined)
})

t('parseEpisodeCount：「N集」优先于剧情里的「第N集」，上限 30', () => {
  assert.equal(parseEpisodeCount('想拍6集，第2集主角被陷害'), 6)
  assert.equal(parseEpisodeCount('第1集开场，第3集反转'), 3)
  assert.equal(parseEpisodeCount('拍50集'), MAX_IDEA_EPISODES)
  assert.equal(MAX_IDEA_EPISODES, 30)
})

t('heuristicIdea：「拍1集」只生成 1 集，大纲同为 1 集', () => {
  const r = heuristicIdea('拍1集：小李被同学欺负，他决定反击。')
  assert.equal(r.episodes.length, 1)
  assert.equal(toOutline(r.episodes).length, 1)
  assert.equal(toOutline(r.episodes)[0].cliffhanger.length > 0, true)
})

t('heuristicIdea：写明集数则用该集数（含超过句子数的情况）', () => {
  const six = heuristicIdea('想拍 6 集。小李被同学欺负。他决定反击。')
  assert.equal(six.episodes.length, 6)
  assert.deepEqual(
    six.episodes.map((e) => e.title),
    ['第1集', '第2集', '第3集', '第4集', '第5集', '第6集'],
  )
  assert.ok(six.episodes.every((e) => e.summary.length > 0))
  assert.equal(toOutline(six.episodes).length, 6)
  assert.equal(heuristicIdea('拍一集，小李逆袭。').episodes.length, 1)
  assert.equal(heuristicIdea('拍50集，小李逆袭。').episodes.length, 30)
})

t('heuristicIdea：未写集数时保持原默认（至少 3 集）', () => {
  assert.equal(heuristicIdea('小李被同学欺负。').episodes.length, 3)
  assert.equal(heuristicIdea('小李被同学欺负后逆袭。').episodes.length, 3)
  const long = Array.from({ length: 20 }, (_, i) => `事件${i}发生了。`).join('')
  assert.equal(heuristicIdea(long).episodes.length, 8)
})

const llmResult = (n: number): IdeaResult => ({
  title: 't',
  genre: '',
  artStyle: '',
  logline: '',
  world: '',
  settingFacts: [],
  characters: [],
  episodes: Array.from({ length: n }, (_, i) => ({ title: `标题${i + 1}`, summary: `摘要${i + 1}`, hook: `钩子${i + 1}` })),
})

t('applyDeclaredEpisodeCount：多则截断、少则补齐、未声明或相等原样返回', () => {
  const five = llmResult(5)
  assert.equal(applyDeclaredEpisodeCount(five, undefined), five)
  assert.equal(applyDeclaredEpisodeCount(five, 5), five)
  const one = applyDeclaredEpisodeCount(five, 1)
  assert.equal(one.episodes.length, 1)
  assert.equal(one.episodes[0].title, '标题1')
  const four = applyDeclaredEpisodeCount(llmResult(2), 4)
  assert.equal(four.episodes.length, 4)
  assert.equal(four.episodes[3].title, '第4集')
  assert.equal(four.episodes[1].summary, '摘要2')
  assert.equal(five.episodes.length, 5)
})

t('LLM 返回 JSON 经 parseIdeaJson + applyDeclaredEpisodeCount 后集数等于想法声明', () => {
  const json = JSON.stringify({
    title: 't',
    characters: [{ name: '小李' }],
    episodes: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }],
  })
  const fixed = applyDeclaredEpisodeCount(parseIdeaJson(json), parseEpisodeCount('拍1集，小李逆袭'))
  assert.equal(fixed.episodes.length, 1)
})

t('IDEA_SYSTEM 提示词写明「明确写出集数时必须等于该集数」', () => {
  assert.ok(IDEA_SYSTEM.includes('episodes 数组必须正好等于该集数'))
})

console.log(`\n${pass} tests passed`)
