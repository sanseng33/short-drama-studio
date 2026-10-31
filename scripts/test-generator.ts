/** npx tsx scripts/test-generator.ts — generator compliance rules, repair loop, character identity / auto voice, episode cap */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { autoFixStoryboard, complianceBlock, episodeCapCheck, lineFits, repairPrompt, validateStoryboard, type RawShotLike } from '../src/lib/generatorRules'
import { generateStoryboardChecked, parseJsonArray } from '../src/lib/generator'
import { ageBand, charGender, withCharacterIdentity } from '../src/lib/voice'
import { storyboardUser } from '../src/lib/prompts'
import type { Character, Project } from '../src/types'

let pass = 0
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); pass++; console.log(`✓ ${name}`) }
const chars = [{ name: '甲' }, { name: '乙' }]
const LOCS = ['病房', '客厅']
const ok = (p: Partial<RawShotLike> = {}): RawShotLike => ({ durationSec: 7, visual: '病房里', action: '甲抬头', dialogue: '', seedancePrompt: '', characters: ['甲'], location: '病房', timeOfDay: '白天', ...p })
const ctx = { characters: chars, locations: LOCS, secondsPerEp: 75 }
const rules = (xs: RawShotLike[]) => validateStoryboard(xs, ctx).map((x) => x.rule)

const main = async () => {
  await t('clean episode passes', () => assert.deepEqual(rules([ok(), ok(), ok({ location: '客厅' })]), []))
  await t('duration outside 5–9 / dialogue too long / two speakers', () => {
    assert.ok(rules([ok({ durationSec: 4 })]).includes('duration'))
    assert.ok(rules([ok({ durationSec: 5, dialogue: '甲：这是一句非常非常长的台词，长到五秒钟根本说不完，必须拆开。' })]).includes('dialogueFit'))
    assert.ok(rules([ok({ dialogue: '甲：走。乙：好。' })]).includes('speakers'))
    assert.ok(lineFits('我知道了。', 5) && !lineFits('我知道了我知道了我知道了我知道了我知道了我知道了', 6))
  })
  await t('two-person shot with 他/她 → pronoun issue; names / screen positions pass', () => {
    assert.ok(rules([ok({ characters: ['甲', '乙'], action: '她看向他' })]).includes('pronoun'))
    assert.ok(!rules([ok({ characters: ['甲', '乙'], action: '甲看向画面右侧的乙' })]).includes('pronoun'))
    assert.ok(!rules([ok({ characters: ['甲'], action: '她抬头' })]).includes('pronoun'), 'single cast may use a pronoun')
  })
  await t('cast > 2, unknown character, location not in the list, missing timeOfDay', () => {
    const r = rules([ok({ characters: ['甲', '乙', '丙'], location: '天台', timeOfDay: '' })])
    for (const k of ['cast', 'unknownCharacter', 'location', 'timeOfDay']) assert.ok(r.includes(k as never), k)
  })
  await t('ping-pong A→B→A and episode seconds over the cap', () => {
    assert.ok(rules([ok(), ok({ location: '客厅' }), ok()]).includes('pingPong'))
    assert.ok(rules(Array.from({ length: 11 }, () => ok({ durationSec: 9 }))).includes('episodeSeconds'))
  })
  await t('actions: > 2 visible actions in one beat', () => {
    assert.ok(rules([ok({ action: '甲转身，推开门，冲出去，摔倒' })]).includes('actions'))
  })
  await t('autoFix: canonical location, establishing at place / time-band change, carry otherwise', () => {
    const f = autoFixStoryboard([ok({ location: '病房（梦中）' }), ok(), ok({ timeOfDay: '夜' }), ok({ location: '客厅', timeOfDay: '夜' })], ctx)
    assert.deepEqual(f.map((s) => s.location), ['病房', '病房', '病房', '客厅'])
    assert.deepEqual(f.map((s) => s.establishing), [true, false, true, true])
    assert.deepEqual(f.map((s) => s.carryFromPrev), [false, true, false, false])
  })
  await t('repair loop: re-prompts with issues until the storyboard passes', async () => {
    const prompts: string[] = []
    const bad = JSON.stringify([ok({ durationSec: 3 })])
    const good = JSON.stringify([ok(), ok()])
    const llm = async (_s: string, u: string) => (prompts.push(u), prompts.length === 1 ? bad : good)
    const p = { id: 'p', title: 'T', genre: '都市逆袭', platform: '红果', episodeCount: 1, secondsPerEp: 75, style: '真人都市', logline: '', settingFacts: [], locations: LOCS, characters: [{ id: 'c1', name: '甲', role: '主角', visualLock: '', costume: '', signatureProp: '' }, { id: 'c2', name: '乙', role: '', visualLock: '', costume: '', signatureProp: '' }], outline: [], scripts: {}, storyboards: {}, selectedEpisode: 1, updatedAt: '' } as unknown as Project
    const r = await generateStoryboardChecked(llm, p, { episode: 1, title: '', hook: '', summary: '', cliffhanger: '' }, '', { maxRepairs: 2 })
    assert.equal(r.attempts, 2)
    assert.deepEqual(r.issues, [])
    assert.ok(/\[duration\]/.test(prompts[1]), 'repair prompt lists the issue')
    assert.equal(r.shots.length, 2)
    assert.deepEqual(r.shots[0].characterIds, ['c1'])
    assert.ok(storyboardUser(p, { episode: 1, title: '', hook: '', summary: '', cliffhanger: '' }, '').includes('病房 / 客厅'), 'location list in the prompt')
    assert.ok(complianceBlock(p).includes('90'))
    assert.ok(repairPrompt([{ shot: 1, rule: 'duration', detail: 'x' }]).includes('第1镜'))
    assert.deepEqual(parseJsonArray('```json\n[1,2,]\n```'), [1, 2])
  })
  await t('identity: characterKey shared by variants, refImage prefix, gender, auto voice from gender + age', () => {
    const cs = withCharacterIdentity([
      { id: 'c1', name: '甲（梦中）', baseName: '甲', role: '主角', age: '18岁', gender: 'female' },
      { id: 'c2', name: '甲（现实）', baseName: '甲', role: '主角', age: '18岁' },
      { id: 'c3', name: '乙', role: '父亲', age: '45' },
      { id: 'c4', name: '丙', role: '路人', voice: 'lib_x' },
    ] as (Character & { voice?: string })[], 'p1', { refImage: true })
    assert.equal(cs[0].characterKey, cs[1].characterKey)
    assert.deepEqual([cs[0].refImage, cs[1].refImage], [`${cs[0].characterKey}_v1`, `${cs[0].characterKey}_v2`])
    assert.deepEqual(cs[0].lookVariants, ['c2']); assert.equal(cs[0].ageBand, '青少年')
    assert.deepEqual(cs[0].voice, cs[1].voice, 'variants share one voice')
    assert.match((cs[0].voice as { description: string }).description, /青少年女声/)
    assert.match((cs[2].voice as { description: string }).description, /中年人男声/)
    assert.equal(cs[3].voice, 'lib_x', 'explicit voice wins')
    assert.equal(charGender({ id: 'x', role: '母亲' }), 'female')
    assert.deepEqual([ageBand('8'), ageBand('26岁'), ageBand('70'), ageBand('老师')], ['儿童', '青年', '老年人', '成年人'])
    assert.equal(withCharacterIdentity([{ id: 'a', name: 'A' }])[0].refImage, undefined, 'export path never invents a refImage')
  })
  await t('lookalikeOf: explicit name, or visualLock says it resembles another person; distinct voices', () => {
    const cs = withCharacterIdentity([
      { id: 'a', name: '甲一', role: '学生', age: '19', visualLock: '短发' },
      { id: 'b', name: '乙', role: '男人', age: '26', visualLock: '五官与甲一极为相似却更成熟' },
      { id: 'c', name: '丙', role: '男人', age: '30', lookalikeOf: '甲一' },
    ] as Character[], 'p')
    assert.deepEqual(cs.map((c) => c.lookalikeOf), [null, 'a', 'a'])
    assert.notDeepEqual(cs[0].voice, cs[1].voice)
  })
  await t('episode cap check', () => assert.deepEqual(episodeCapCheck([{ episode: 1, durationSec: 50 }, { episode: 1, durationSec: 45 }, { episode: 2, durationSec: 90 }]), [{ episode: 1, seconds: 95 }]))
  await t('repack: episode over the 90s cap → exit 8 (opt-out --allow-episode-overrun)', () => {
    let code = 0
    let err = ''
    try {
      execFileSync('npx', ['tsx', 'scripts/repack.ts', 'scripts/fixtures/real-export-meitian2.json', '/tmp/gen-cap.json', '--beat-only'], { encoding: 'utf8', stdio: 'pipe' })
    } catch (x) {
      code = (x as { status: number }).status
      err = String((x as { stderr: string }).stderr)
    }
    assert.equal(code, 8)
    assert.match(err, /ep1 [\d.]+s/)
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', 'scripts/fixtures/real-export-meitian2.json', '/tmp/gen-cap.json', '--beat-only', '--allow-episode-overrun', '--allow-missing-voice'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
    assert.equal(rep.episodeCap.capSec, 90)
    assert.equal(rep.episodeCap.overruns[0].episode, 1)
    assert.ok(rep.characterVoices.every((c: { voice: unknown }) => c.voice), 'every listed character voiced')
  })
  console.log(`${pass} generator tests passed`)
}
main()
