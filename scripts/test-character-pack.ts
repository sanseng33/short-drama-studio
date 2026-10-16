/** npx tsx scripts/test-character-pack.ts — parse + auto-match + apply for h3-character-pack@1 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Character } from '../src/types'
import {
  applyCharacterPack,
  applyPackToCharacter,
  buildMatchRows,
  createCharacterFromPack,
  joinProps,
  matchPackCharacter,
  parseCharacterPack,
  parseCharacterPackJson,
  stripVariantParen,
  CHARACTER_PACK_SCHEMA,
} from '../src/lib/characterPack'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { mergeLockedCharacters } from '../src/lib/idea'
import type { Project } from '../src/types'

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id,
  name,
  role: '角色',
  visualLock: '旧外观',
  costume: '旧服装',
  signatureProp: '旧道具',
  ...extra,
})

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

const sampleText = readFileSync('samples/h3-character-pack.sample.json', 'utf8')
const pack = parseCharacterPackJson(sampleText)

t('schema + 3 characters', () => {
  assert.equal(pack.schema, CHARACTER_PACK_SCHEMA)
  assert.equal(pack.characters.length, 3)
  assert.deepEqual(
    pack.characters.map((c) => c.refImage),
    ['bai_pu_plain', 'bai_pu_glowup', 'wu_nai'],
  )
})

t('wu_nai tracksuit + new images.dir', () => {
  const wu = pack.characters.find((c) => c.refImage === 'wu_nai')!
  assert.ok(/运动校服|运动裤|拉链外套/.test(wu.costume || ''), wu.costume)
  assert.equal(wu.images?.dir, 'wu_nai_20261016_142838')
  assert.ok(wu.background?.includes('贫') || wu.background?.includes('穷') || (wu.background || '').length > 0, wu.background)
})

t('reject wrong schema / empty', () => {
  assert.throws(() => parseCharacterPack({ schema: 'x', characters: [{ displayName: 'a', refImage: 'r' }] }), /schema/)
  assert.throws(() => parseCharacterPack({ schema: CHARACTER_PACK_SCHEMA, characters: [] }), /不能为空/)
})

t('stripVariantParen + joinProps', () => {
  assert.equal(stripVariantParen('白朴（变帅前）'), '白朴')
  assert.equal(stripVariantParen('吴耐'), '吴耐')
  assert.equal(joinProps(['手机', '耳机']), '手机、耳机')
  assert.equal(joinProps([]), '')
})

const cast: Character[] = [
  C('c1', '白朴（变帅前）', { baseName: '白朴', tags: ['protagonist'] }),
  C('c2', '白朴（变帅后）', { baseName: '白朴' }),
  C('c3', '吴耐', { role: '同学' }),
  C('c4', '路人甲'),
]

t('auto-match by exact displayName', () => {
  const rows = buildMatchRows(pack, cast)
  assert.equal(rows[0].suggested.kind, 'apply')
  assert.equal(rows[0].suggested.kind === 'apply' && rows[0].suggested.targetId, 'c1')
  assert.equal(rows[1].suggested.kind === 'apply' && rows[1].suggested.targetId, 'c2')
  assert.equal(rows[2].suggested.kind === 'apply' && rows[2].suggested.targetId, 'c3')
})

t('auto-match by refImage when names differ', () => {
  const alt = [C('x1', '少年A', { refImage: 'bai_pu_plain' }), C('x2', '少年B', { refImage: 'bai_pu_glowup' }), C('x3', '同学', { refImage: 'wu_nai' })]
  const rows = buildMatchRows(pack, alt)
  assert.deepEqual(
    rows.map((r) => (r.suggested.kind === 'apply' ? r.suggested.targetId : r.suggested.kind)),
    ['x1', 'x2', 'x3'],
  )
})

t('fuzzy: baseName / name prefix for variants', () => {
  const alt = [C('a', '白朴甲', { baseName: '白朴' }), C('b', '白朴乙', { baseName: '白朴' }), C('c', '吴耐')]
  // displayNames are 白朴（变帅前）/白朴（变帅后）/吴耐 → match via baseName 白朴 then 吴耐
  const r0 = matchPackCharacter(pack.characters[0], alt, new Set())
  assert.equal(r0, 'a')
  const r1 = matchPackCharacter(pack.characters[1], alt, new Set(['a']))
  assert.equal(r1, 'b')
  const r2 = matchPackCharacter(pack.characters[2], alt, new Set(['a', 'b']))
  assert.equal(r2, 'c')
})

t('unmatched → skip suggestion', () => {
  const rows = buildMatchRows(pack, [C('z', '完全无关')])
  assert.ok(rows.every((r) => r.suggested.kind === 'skip'))
})

t('apply updates fields + locked + imagesDir', () => {
  const actions = buildMatchRows(pack, cast).map((r) => r.suggested)
  const { characters, updated, created, skipped } = applyCharacterPack(cast, pack, actions)
  assert.equal(updated, 3)
  assert.equal(created, 0)
  assert.equal(skipped, 0)
  const c1 = characters.find((c) => c.id === 'c1')!
  assert.equal(c1.refImage, 'bai_pu_plain')
  assert.equal(c1.visualLock, pack.characters[0].appearance)
  assert.equal(c1.costume, pack.characters[0].costume)
  assert.equal(c1.age, '17')
  assert.equal(c1.background, pack.characters[0].background)
  assert.equal(c1.negative, pack.characters[0].negative)
  assert.equal(c1.characterKey, 'bai_pu')
  assert.equal(c1.imagesDir, 'bai_piao_plain_20261016_115346')
  assert.equal(c1.baseName, '白朴')
  assert.equal(c1.locked, true)
  assert.equal(c1.signatureProp, '')
  const wu = characters.find((c) => c.id === 'c3')!
  assert.equal(wu.refImage, 'wu_nai')
  assert.equal(wu.imagesDir, 'wu_nai_20261016_142838')
  assert.ok(/运动校服/.test(wu.costume))
  assert.equal(wu.age, '17')
  assert.ok(/贫困|邻居/.test(wu.background || ''), wu.background)
  // unmatched cast member preserved
  assert.ok(characters.some((c) => c.id === 'c4'))
})

t('create action appends new character', () => {
  const actions = pack.characters.map(() => ({ kind: 'create' as const }))
  const { characters, created, updated } = applyCharacterPack([C('only', '仅有')], pack, actions)
  assert.equal(created, 3)
  assert.equal(updated, 0)
  assert.equal(characters.length, 4)
  assert.equal(characters[1].name, '白朴（变帅前）')
  assert.equal(characters[1].locked, true)
})

t('skip leaves cast unchanged for that row', () => {
  const actions = [{ kind: 'skip' as const }, { kind: 'skip' as const }, { kind: 'skip' as const }]
  const { characters, skipped, updated } = applyCharacterPack(cast, pack, actions)
  assert.equal(skipped, 3)
  assert.equal(updated, 0)
  assert.equal(characters[0].visualLock, '旧外观')
})

t('video-pipeline export includes negative/characterKey/imagesDir', () => {
  const applied = applyCharacterPack(cast, pack, buildMatchRows(pack, cast).map((r) => r.suggested)).characters
  const project: Project = {
    id: 'p',
    title: 't',
    genre: '都市逆袭',
    platform: '红果',
    episodeCount: 1,
    secondsPerEp: 60,
    style: '真人都市',
    logline: '',
    characters: applied,
    outline: [],
    scripts: {},
    storyboards: {},
    selectedEpisode: 1,
    updatedAt: '',
  }
  const out = buildVideoPipelineExport(project)
  const e1 = out.characters.find((c) => c.id === 'c1')!
  assert.equal(e1.refImage, 'bai_pu_plain')
  assert.equal(e1.characterKey, 'bai_pu')
  assert.equal(e1.imagesDir, 'bai_piao_plain_20261016_115346')
  assert.ok(e1.negative && e1.negative.includes('破旧'))
  const e3 = out.characters.find((c) => c.id === 'c3')!
  assert.equal(e3.imagesDir, 'wu_nai_20261016_142838')
})

t('mergeLocked keeps pack fields on regen', () => {
  const prev = [
    applyPackToCharacter(C('c1', '白朴（变帅前）', { baseName: '白朴' }), pack.characters[0]),
  ]
  const next = [C('c1', '白朴（变帅前）', { visualLock: 'NEW', costume: 'NEW', age: '99', background: 'wrong' })]
  const m = mergeLockedCharacters(prev, next)
  assert.equal(m[0].visualLock, pack.characters[0].appearance)
  assert.equal(m[0].costume, pack.characters[0].costume)
  assert.equal(m[0].refImage, 'bai_pu_plain')
  assert.equal(m[0].age, '17')
  assert.equal(m[0].background, pack.characters[0].background)
  assert.equal(m[0].negative, pack.characters[0].negative)
  assert.equal(m[0].imagesDir, 'bai_piao_plain_20261016_115346')
})

t('age null clears existing age', () => {
  const pc = { ...pack.characters[0], age: null as null }
  const got = applyPackToCharacter(C('z', '白朴（变帅前）', { age: '99' }), pc)
  assert.equal(got.age, undefined)
})

t('createCharacterFromPack sets locked + imagesDir', () => {
  const neu = createCharacterFromPack(pack.characters[2], [])
  assert.equal(neu.name, '吴耐')
  assert.equal(neu.refImage, 'wu_nai')
  assert.equal(neu.locked, true)
  assert.equal(neu.imagesDir, 'wu_nai_20261016_142838')
})

console.log(`\n${pass} character-pack tests passed`)
