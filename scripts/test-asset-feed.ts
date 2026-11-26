/**
 * npx --yes tsx scripts/test-asset-feed.ts
 * Static checks of the `assetContract` (h3-feed@1) manifest on the video-pipeline@1 export.
 * Nothing here reads H3 jobs / lockcard / a live graph, and no assertion claims any of them was verified.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildVideoPipelineExport, VIDEO_PIPELINE_SCHEMA } from '../src/lib/videoExport'
import { AssetContractError, buildAssetContract, verifyAssetContract, isExternalReference } from '../src/lib/assetFeed'
import { sha256Hex } from '../src/lib/contentHash'
import type { Character, Project, ProjectAssetBindings, Shot } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('✓', name) }
const nodeSha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const nodeSha1 = (b: string) => createHash('sha1').update(b).digest('hex')

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id, name, role: '角色', visualLock: '短发', costume: '黑夹克', signatureProp: '芯片', ...extra,
})
let n = 0
const S = (p: Partial<Shot>): Shot => ({
  id: `a${++n}`, shotNo: n, size: '中景', durationSec: 4, visual: '室内', action: '站立', dialogue: '',
  camera: '固定', emotion: '', seedancePrompt: '', ...p,
})
const P = (characters: Character[], shots: Shot[], extra: Partial<Project> = {}): Project => ({
  id: 'p_asset', title: '资产清单', genre: '都市逆袭', platform: '红果', episodeCount: 1, secondsPerEp: 60, style: '真人都市',
  logline: '', characters, outline: [], scripts: {}, storyboards: { 1: shots }, selectedEpisode: 1, updatedAt: '', ...extra,
})
const OPTS = { mergeToSegments: false } as const
const BYTES_REF = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
const BYTES_PLATE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6, 5, 4, 3, 2, 1])

const shotLiving = () => S({ characterIds: ['c1'], location: '客厅', timeOfDay: '白天', visual: '客厅', action: '林川站在沙发旁', dialogue: '林川：「早。」' })
const boundChar = (extra: Partial<Character> = {}) =>
  C('c1', '林川', { characterKey: 'linwei', wardrobeState: 'formal', wardrobeRefs: { formal: { refSet: 'linwei_formal', costume: '白衬衫' } }, ...extra })

// the scene id the builder derives for the fixture shot (never hard-coded; the id comes from the export)
const sceneIdOf = (): string => {
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()]), OPTS)
  return e.shots[0].sceneId as string
}

t('sha256Hex matches node:crypto on known and random-length inputs', () => {
  assert.equal(sha256Hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  for (const len of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 4097]) {
    const b = new Uint8Array(len)
    for (let i = 0; i < len; i++) b[i] = (i * 31 + len) & 0xff
    assert.equal(sha256Hex(b), nodeSha256(b), `len ${len}`)
  }
})

t('legacy project: default export succeeds, schema and old fields unchanged, contract is visible', () => {
  const legacy = P([C('c1', '林川'), C('c2', '赵泽')], [S({ characterIds: ['c1'], dialogue: '林川：「你好。」' }), S({ characterIds: ['c2'] })])
  const e = buildVideoPipelineExport(legacy, OPTS)
  assert.equal(e.schema, VIDEO_PIPELINE_SCHEMA)
  assert.equal(e.schema, 'short-drama-studio/video-pipeline@1')
  assert.equal(e.characters.length, 2)
  assert.equal(e.shots.length, 2)
  for (const k of ['id', 'name', 'role', 'tags', 'visualLock', 'costume', 'signatureProp', 'refImage']) assert.ok(k in e.characters[0], k)
  for (const k of ['id', 'characterIds', 'prompt']) assert.ok(k in e.shots[0], k)
  assert.equal(e.assetContract?.version, 'h3-feed@1')
  assert.equal(e.assetContract?.strict, false)
  assert.equal(e.assetContract?.verification, 'static_only')
  const rows = e.assetContract!.characters
  assert.ok(rows.length >= 2)
  for (const r of rows) {
    assert.equal(r.refSet, null)
    assert.equal(r.file.origin, 'missing')
    assert.equal(r.file.sha256, null)
  }
  const codes = e.assetContract!.gaps.map((g) => g.code)
  assert.ok(codes.includes('asset_refset_missing'))
  for (const g of e.assetContract!.gaps) {
    assert.ok(e.warnings.some((w) => w.code === g.code && w.shotId === g.shotId), `warning for ${g.code} ${g.shotId}`)
  }
})

t('legacy project: assetContract is the only top-level key added', () => {
  const legacy = P([C('c1', '林川')], [S({ characterIds: ['c1'] })])
  const e = buildVideoPipelineExport(legacy, OPTS)
  const { assetContract: _ac, ...rest } = e
  void _ac
  for (const k of ['schema', 'project', 'characters', 'shots', 'warnings']) assert.ok(k in rest, k)
  assert.ok(!('trainingAssets' in e))
  assert.ok(!('trainingAssets' in (e.assetContract as object)))
})

t('local bytes: c1 x formal and the scene plate become local_computed with the independent SHA-256', () => {
  const sid = sceneIdOf()
  const bindings: ProjectAssetBindings = {
    characters: { 'c1:formal': { path: 'refsets/linwei_formal/00_000.png', bytes: BYTES_REF } },
    scenes: { [sid]: { path: `plates/${sid}.png`, bytes: BYTES_PLATE } },
  }
  const p = P([boundChar()], [shotLiving()], { assetBindings: bindings })
  const e1 = buildVideoPipelineExport(p, OPTS)
  const e2 = buildVideoPipelineExport(p, OPTS)
  const row = e1.assetContract!.characters.find((r) => r.characterId === 'c1' && r.wardrobeState === 'formal')!
  assert.equal(row.characterKey, 'linwei')
  assert.equal(row.refSet, 'linwei_formal')
  assert.equal(row.file.origin, 'local_computed')
  assert.equal(row.file.hashAlg, 'sha256')
  assert.equal(row.file.sha256, nodeSha256(BYTES_REF))
  assert.equal(row.file.logicalPath, 'refsets/linwei_formal/00_000.png')
  assert.ok(row.file.note.length > 0)
  const sc = e1.assetContract!.scenes.find((r) => r.sceneId === sid)!
  assert.equal(sc.plate.file.origin, 'local_computed')
  assert.equal(sc.plate.file.sha256, nodeSha256(BYTES_PLATE))
  assert.equal(sc.sceneLabel, e1.shots[0].sceneLabel)
  assert.equal(JSON.stringify(e1), JSON.stringify(e2))
  assert.equal(e1.assetContract!.gaps.length, 0)
  assert.ok(!e1.warnings.some((w) => w.code === 'asset_refset_missing' || w.code === 'asset_plate_missing'))
})

t('local bytes: bound export passes strict mode', () => {
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  })
  const e = buildVideoPipelineExport(p, { ...OPTS, assetContractStrict: true })
  assert.equal(e.assetContract!.strict, true)
  assert.equal(e.assetContract!.gaps.length, 0)
})

t('local bytes: a sha256 that disagrees with the bytes is rejected', () => {
  const p = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF, sha256: nodeSha256(BYTES_PLATE) } } } })
  assert.throws(() => buildVideoPipelineExport(p, OPTS), AssetContractError)
})

t('external paths: sha256 stays null, origin external_unverified, note filled, no path hash in the output', () => {
  const sid = sceneIdOf()
  const mnt = '/mnt/drama_out/vw3_runtime_x/refsets/linwei_formal/00_000.png'
  const win = 'C:\\Users\\ROG\\Pictures\\plate.png'
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { path: mnt } }, scenes: { [sid]: { path: win } } },
  })
  const e = buildVideoPipelineExport(p, OPTS)
  const row = e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!
  const sc = e.assetContract!.scenes.find((r) => r.sceneId === sid)!
  for (const f of [row.file, sc.plate.file]) {
    assert.equal(f.sha256, null)
    assert.equal(f.origin, 'external_unverified')
    assert.ok(f.note.trim().length > 0)
    assert.ok(f.logicalPath === null || !isExternalReference(f.logicalPath) || !/^(\/mnt|[A-Za-z]:\\)/.test(f.logicalPath))
  }
  assert.ok(/历史云端路径/.test(row.file.note))
  assert.ok(/Windows/.test(sc.plate.file.note))
  const json = JSON.stringify(e.assetContract)
  for (const s of [mnt, win, 'https://example.invalid/a.png']) {
    for (const h of [nodeSha1(s), nodeSha256(s)]) assert.ok(!json.includes(h), `path hash ${h} must not appear`)
  }
  assert.ok(!/"sha256":"[0-9a-f]{64}"/.test(json))
})

t('external paths: http(s) and bare file names are unverified too', () => {
  for (const path of ['https://example.invalid/a.png', 'http://example.invalid/a.png', '00_000.png']) {
    const p = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { path } } } })
    const f = buildVideoPipelineExport(p, OPTS).assetContract!.characters.find((r) => r.wardrobeState === 'formal')!.file
    assert.equal(f.sha256, null, path)
    assert.equal(f.origin, 'external_unverified', path)
    assert.ok(f.note.length > 0, path)
  }
})

t('refSet named in wardrobeRefs without file bytes is unverified, never hashed', () => {
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()]), OPTS)
  const row = e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!
  assert.equal(row.refSet, 'linwei_formal')
  assert.equal(row.file.origin, 'external_unverified')
  assert.equal(row.file.sha256, null)
  assert.equal(row.file.logicalPath, 'refsets/linwei_formal/00_000.png')
})

t('hash without bytes is rejected unless origin is imported_manifest', () => {
  const h = nodeSha256('manifest-entry')
  for (const b of [{ sha256: h }, { sha256: h, origin: 'external_unverified' as const }, { sha256: h, origin: 'local_computed' as const }, { origin: 'local_computed' as const }]) {
    const p = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': b } } })
    assert.throws(() => buildVideoPipelineExport(p, OPTS), AssetContractError, JSON.stringify(b))
  }
})

t('imported manifest: valid sha256 is kept as given with origin imported_manifest', () => {
  const h = nodeSha256('manifest-entry')
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: {
      characters: { 'c1:formal': { path: 'refsets/linwei_formal/00_000.png', sha256: h, origin: 'imported_manifest' } },
      scenes: { [sid]: { sha256: h, origin: 'imported_manifest' } },
    },
  })
  const e = buildVideoPipelineExport(p, OPTS)
  const row = e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!
  assert.equal(row.file.sha256, h)
  assert.equal(row.file.origin, 'imported_manifest')
  assert.ok(row.file.note.length > 0)
  const sc = e.assetContract!.scenes.find((r) => r.sceneId === sid)!
  assert.equal(sc.plate.file.sha256, h)
  assert.equal(sc.plate.file.origin, 'imported_manifest')
})

t('imported manifest: malformed hashes fail closed', () => {
  const bad = ['', 'abc', 'Z'.repeat(64), nodeSha256('x').toUpperCase(), nodeSha256('x') + '0', 'sha256:' + nodeSha256('x')]
  for (const sha256 of bad) {
    const p = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { sha256, origin: 'imported_manifest' } } } })
    assert.throws(() => buildVideoPipelineExport(p, OPTS), AssetContractError, `hash "${sha256}"`)
  }
})

t('strict mode: missing refSet throws, default mode exports with the code in gaps and warnings', () => {
  const sid = sceneIdOf()
  const noRef = P([C('c1', '林川')], [shotLiving()], { assetBindings: { scenes: { [sid]: { bytes: BYTES_PLATE } } } })
  assert.throws(() => buildVideoPipelineExport(noRef, { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_refset_missing'))
  const e = buildVideoPipelineExport(noRef, OPTS)
  assert.ok(e.assetContract!.gaps.some((g) => g.code === 'asset_refset_missing' && g.characterId === 'c1'))
  assert.ok(e.warnings.some((w) => w.code === 'asset_refset_missing' && w.characterId === 'c1'))
})

t('strict mode: a scene without a plate throws, default mode lists asset_plate_missing', () => {
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } } } })
  assert.throws(() => buildVideoPipelineExport(p, { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_plate_missing' && g.sceneId === sid))
  const e = buildVideoPipelineExport(p, OPTS)
  const row = e.assetContract!.scenes.find((r) => r.sceneId === sid)!
  assert.equal(row.plate.file.origin, 'missing')
  assert.equal(row.plate.file.sha256, null)
  assert.ok(e.assetContract!.gaps.some((g) => g.code === 'asset_plate_missing' && g.sceneId === sid))
  assert.ok(e.warnings.some((w) => w.code === 'asset_plate_missing' && w.shotId === e.shots[0].id))
})

t('static check: a shot sceneId with no row at all in the manifest is a gap', () => {
  const sid = sceneIdOf()
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  }), OPTS)
  assert.equal(verifyAssetContract(e.assetContract!, e).length, 0)
  const stripped = { ...e.assetContract!, scenes: [], characters: [] }
  const gaps = verifyAssetContract(stripped, e)
  assert.ok(gaps.some((g) => g.code === 'asset_plate_missing' && g.sceneId === sid && /没有对应行/.test(g.message)))
  assert.ok(gaps.some((g) => g.code === 'asset_refset_missing' && g.characterId === 'c1' && /没有对应行/.test(g.message)))
})

t('new codes stay separate from the existing consistency codes', () => {
  const e = buildVideoPipelineExport(P([C('c1', '林川')], [shotLiving()]), OPTS)
  const assetCodes = new Set(['asset_refset_missing', 'asset_plate_missing', 'asset_ref_file_missing', 'asset_scene_id_missing', 'asset_character_id_duplicate', 'asset_reference_conflict', 'asset_costume_placeholder', 'asset_costume_divergence', 'asset_hidden_face_unqualified', 'asset_hidden_face_unverified'])
  for (const g of e.assetContract!.gaps) assert.ok(assetCodes.has(g.code))
  assert.ok(!e.warnings.some((w) => (w.code as string) === 'location_not_in_table' || (w.code as string) === 'character_look_not_in_shot'))
})

t('costume placeholder: visible divergence and warning, text left untouched', () => {
  const costume = '浅蓝连衣裙，赤脚'
  const action = '林川站在沙发旁'
  const placeholder = 'user-provided formal outfit (owner photo, replaces script costume)'
  const c = C('c1', '林川', { characterKey: 'linwei', wardrobeState: 'formal', costume, wardrobeRefs: { formal: { refSet: 'linwei_formal', costume: placeholder } } })
  const shot = shotLiving()
  const p = P([c], [shot])
  const before = JSON.stringify(p)
  const e = buildVideoPipelineExport(p, OPTS)
  assert.equal(JSON.stringify(p), before, 'input project is not mutated')
  const d = e.assetContract!.divergences.find((x) => x.code === 'asset_costume_placeholder')
  assert.ok(d && d.characterId === 'c1' && d.wardrobeState === 'formal')
  assert.ok(e.warnings.some((w) => w.code === 'asset_costume_placeholder' && w.characterId === 'c1'))
  assert.equal(e.characters[0].costume, costume)
  assert.ok(e.shots[0].action.includes(action))
  assert.ok(!/白衬衫/.test(e.shots[0].prompt) && !/白衬衫/.test(e.shots[0].action))
  assert.equal(e.characters[0].wardrobeRefs!.formal.costume, placeholder)
  // asset bindings never change shots or characters
  const withBindings = buildVideoPipelineExport(P([c], [shot], { assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } } } }), OPTS)
  assert.equal(JSON.stringify(withBindings.shots), JSON.stringify(e.shots.map((s) => s)))
  assert.equal(JSON.stringify(withBindings.characters), JSON.stringify(e.characters))
})

t('costume divergence: differing wardrobeRefs costume is listed and both texts are kept', () => {
  const c = C('c1', '林川', { characterKey: 'linwei', wardrobeState: 'formal', costume: '浅蓝连衣裙', wardrobeRefs: { formal: { refSet: 'linwei_formal', costume: '深灰西装' } } })
  const e = buildVideoPipelineExport(P([c], [shotLiving()]), OPTS)
  assert.ok(e.assetContract!.divergences.some((d) => d.code === 'asset_costume_divergence' && d.characterId === 'c1'))
  assert.ok(e.warnings.some((w) => w.code === 'asset_costume_divergence'))
  assert.equal(e.characters[0].costume, '浅蓝连衣裙')
  assert.equal(e.characters[0].wardrobeRefs!.formal.costume, '深灰西装')
})

t('wardrobe state resolution: shot state, then character state, then default', () => {
  const c = C('c1', '林川', { characterKey: 'linwei', wardrobeRefs: { pajama: { refSet: 'linwei_pajama' } } })
  const s1 = S({ characterIds: ['c1'], location: '客厅', timeOfDay: '白天' })
  const e = buildVideoPipelineExport(P([c], [s1]), OPTS)
  const states = e.assetContract!.characters.map((r) => r.wardrobeState)
  const shotState = e.shots[0].wardrobeState?.c1 || 'default'
  assert.ok(states.includes(shotState))
  const rows = e.assetContract!.characters.filter((r) => r.characterId === 'c1')
  assert.equal(new Set(rows.map((r) => `${r.characterId}:${r.wardrobeState}`)).size, rows.length, 'one row per character x state')
})

t('trainingAssets are not exported and never become a refSet or hash', () => {
  const stillPath = '/mnt/lora_materials/datasets/linwei_train/still_001.png'
  const training = { stills: { named: { front: stillPath } } } as unknown as Character['trainingAssets']
  const c = C('c1', '林川', { characterKey: 'linwei', trainingAssets: training })
  const e = buildVideoPipelineExport(P([c], [shotLiving()]), OPTS)
  assert.ok(!('trainingAssets' in e.characters[0]))
  const json = JSON.stringify(e.assetContract)
  assert.ok(!json.includes('trainingAssets'))
  assert.ok(!json.includes(stillPath))
  const row = e.assetContract!.characters.find((r) => r.characterId === 'c1')!
  assert.equal(row.refSet, null)
  assert.equal(row.file.origin, 'missing')
  assert.equal(row.file.sha256, null)
  assert.ok(e.assetContract!.gaps.some((g) => g.code === 'asset_refset_missing'))
})

// ---- strict-mode gaps: missing ref file, missing sceneId, duplicate ids, unverified and unused bindings ----

t('refSet name with file.origin=missing: default lists asset_ref_file_missing (gap + warning), strict throws', () => {
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { origin: 'missing' } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  })
  const e = buildVideoPipelineExport(p, OPTS)
  const row = e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!
  assert.equal(row.refSet, 'linwei_formal')
  assert.equal(row.file.origin, 'missing')
  assert.ok(e.assetContract!.gaps.some((g) => g.code === 'asset_ref_file_missing' && g.characterId === 'c1'))
  assert.ok(e.warnings.some((w) => w.code === 'asset_ref_file_missing' && w.characterId === 'c1'))
  assert.throws(() => buildVideoPipelineExport(p, { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_ref_file_missing'))
})

t('external_unverified only (no bytes): visible asset_hash_unverified warning, not local_computed, strict mode still passes', () => {
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { path: '/mnt/drama_out/refsets/linwei_formal/00_000.png' } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  })
  const e = buildVideoPipelineExport(p, { ...OPTS, assetContractStrict: true })
  const row = e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!
  assert.equal(row.file.origin, 'external_unverified')
  assert.notEqual(row.file.origin, 'local_computed')
  assert.equal(row.file.sha256, null)
  assert.equal(e.assetContract!.gaps.length, 0, 'strict mode checks bindings, not file bytes')
  assert.ok(e.assetContract!.notices.some((n) => n.code === 'asset_hash_unverified' && n.characterId === 'c1'))
  assert.ok(e.warnings.some((w) => w.code === 'asset_hash_unverified' && w.characterId === 'c1'))
  // the local plate carries a hash and is not reported as unverified
  assert.ok(!e.assetContract!.notices.some((n) => n.code === 'asset_hash_unverified' && n.sceneId === sid))
})

t('refSet name without any file binding is also reported as unverified', () => {
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()]), OPTS)
  assert.ok(e.assetContract!.notices.some((n) => n.code === 'asset_hash_unverified' && n.characterId === 'c1'))
  assert.ok(e.warnings.some((w) => w.code === 'asset_hash_unverified'))
})

t('shot without sceneId: asset_scene_id_missing, strict throws, sceneId is not generated or filled', () => {
  const sid = sceneIdOf()
  const base = buildVideoPipelineExport(P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  }), OPTS)
  for (const bad of [undefined, '', '  ']) {
    const exp = { ...base, shots: base.shots.map((s) => ({ ...s, sceneId: bad })) }
    const project = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } } })
    const loose = buildAssetContract(project, exp, false)
    assert.ok(loose.contract.gaps.some((g) => g.code === 'asset_scene_id_missing' && g.shotId === exp.shots[0].id), JSON.stringify(bad))
    assert.ok(loose.warnings.some((w) => w.code === 'asset_scene_id_missing' && w.shotId === exp.shots[0].id))
    assert.equal(loose.contract.scenes.length, 0, 'no scene row is invented')
    assert.ok(!loose.contract.gaps.some((g) => g.code === 'asset_plate_missing'))
    assert.equal(exp.shots[0].sceneId, bad, 'export shot is left as it was')
    assert.throws(() => buildAssetContract(project, exp, true), (err: unknown) =>
      err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_scene_id_missing'))
  }
})

t('duplicate characterId in the exported list: explicit gap, strict mode rejects', () => {
  const sid = sceneIdOf()
  const project = P([boundChar()], [shotLiving()], { assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } } })
  const base = buildVideoPipelineExport(project, OPTS)
  const exp = { ...base, characters: [...base.characters, { ...base.characters[0] }] }
  const loose = buildAssetContract(project, exp, false)
  assert.ok(loose.contract.gaps.some((g) => g.code === 'asset_character_id_duplicate' && g.characterId === 'c1'))
  assert.ok(loose.warnings.some((w) => w.code === 'asset_character_id_duplicate' && w.characterId === 'c1'))
  assert.throws(() => buildAssetContract(project, exp, true), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_character_id_duplicate'))
  assert.ok(!verifyAssetContract(base.assetContract!, base).some((g) => g.code === 'asset_character_id_duplicate'), 'unique ids stay clean')
})

t('contradictory duplicate manifest rows for one key are reported as asset_reference_conflict', () => {
  const sid = sceneIdOf()
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  }), OPTS)
  const c = e.assetContract!
  assert.equal(verifyAssetContract(c, e).length, 0)
  const sameCopy = { ...c, characters: [...c.characters, { ...c.characters[0] }], scenes: [...c.scenes, { ...c.scenes[0] }] }
  assert.equal(verifyAssetContract(sameCopy, e).length, 0, 'identical duplicate rows are not a conflict')
  const otherHash = nodeSha256(BYTES_PLATE)
  const conflicting = {
    ...c,
    characters: [...c.characters, { ...c.characters[0], file: { ...c.characters[0].file, sha256: otherHash } }],
    scenes: [...c.scenes, { ...c.scenes[0], plate: { file: { ...c.scenes[0].plate.file, origin: 'imported_manifest' as const } } }],
  }
  const gaps = verifyAssetContract(conflicting, e)
  assert.ok(gaps.some((g) => g.code === 'asset_reference_conflict' && g.characterId === 'c1' && g.wardrobeState === 'formal'))
  assert.ok(gaps.some((g) => g.code === 'asset_reference_conflict' && g.sceneId === sid))
})

t('unused binding keys: default export succeeds with visible asset_binding_unused warnings; strict mode does not throw for them', () => {
  const sid = sceneIdOf()
  const p = P([boundChar()], [shotLiving()], {
    assetBindings: {
      characters: { 'c1:formal': { bytes: BYTES_REF }, 'ghost:default': { bytes: BYTES_REF }, 'c1:pajama': { bytes: BYTES_REF } },
      scenes: { [sid]: { bytes: BYTES_PLATE }, nowhere_day: { bytes: BYTES_PLATE } },
    },
  })
  for (const strict of [false, true]) {
    const e = buildVideoPipelineExport(p, { ...OPTS, assetContractStrict: strict })
    assert.equal(e.assetContract!.gaps.length, 0)
    const unused = e.assetContract!.notices.filter((n) => n.code === 'asset_binding_unused').map((n) => n.bindingKey).sort()
    assert.deepEqual(unused, ['c1:pajama', 'ghost:default', 'nowhere_day'])
    assert.equal(e.warnings.filter((w) => w.code === 'asset_binding_unused').length, 3)
    // used bindings are untouched by the unused ones
    assert.equal(e.assetContract!.characters.find((r) => r.wardrobeState === 'formal')!.file.sha256, nodeSha256(BYTES_REF))
    assert.ok(!e.assetContract!.characters.some((r) => r.characterId === 'ghost'))
  }
})

t('fully bound export has no notices', () => {
  const sid = sceneIdOf()
  const e = buildVideoPipelineExport(P([boundChar()], [shotLiving()], {
    assetBindings: { characters: { 'c1:formal': { bytes: BYTES_REF } }, scenes: { [sid]: { bytes: BYTES_PLATE } } },
  }), OPTS)
  assert.deepEqual(e.assetContract!.notices, [])
  assert.ok(!e.warnings.some((w) => w.code === 'asset_hash_unverified' || w.code === 'asset_binding_unused'))
})

t('export without assetBindings is byte-stable across calls', () => {
  const p = P([boundChar()], [shotLiving()])
  assert.equal(JSON.stringify(buildVideoPipelineExport(p, OPTS)), JSON.stringify(buildVideoPipelineExport(p, OPTS)))
})


t('hidden_face 参考不合格：可见脸声明与缺认证均 fail closed；认证 hidden 才放行', () => {
  const hidden = C('c8', '母亲', {
    wardrobeState: 'hidden_face',
    wardrobeRefs: { hidden_face: { refSet: 'mother_temp_back', costume: '围裙家居装', facePolicy: 'hidden' } },
  })
  const shot = S({ characterIds: ['c8'], location: '客厅', timeOfDay: '白天', visual: '母亲肩背', action: '站立' })
  const visible = buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': { origin: 'external_unverified', path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'visible' } } },
  }), OPTS)
  assert.ok(visible.assetContract!.gaps.some((g) => g.code === 'asset_hidden_face_unqualified' && g.characterId === 'c8'))
  assert.ok(visible.warnings.some((w) => w.code === 'asset_hidden_face_unqualified'))
  assert.throws(() => buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': { origin: 'external_unverified', path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'visible' } } },
  }), { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_hidden_face_unqualified'))

  const unverified = buildVideoPipelineExport(P([hidden], [shot]), OPTS)
  assert.ok(unverified.assetContract!.gaps.some((g) => g.code === 'asset_hidden_face_unverified' && g.characterId === 'c8'))
  assert.throws(() => buildVideoPipelineExport(P([hidden], [shot]), { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_hidden_face_unverified'))

  const ok = buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': { origin: 'external_unverified', path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'hidden' } } },
  }), OPTS)
  assert.ok(!ok.assetContract!.gaps.some((g) => g.code === 'asset_hidden_face_unqualified' || g.code === 'asset_hidden_face_unverified'))

  const formal = boundChar()
  const formalExp = buildVideoPipelineExport(P([formal], [shotLiving()]), OPTS)
  assert.ok(!formalExp.assetContract!.gaps.some((g) => String(g.code).startsWith('asset_hidden_face_')))
})

t('hidden_face 允许耳廓例外；未批准部位仍 fail closed，行上保留认证元数据', () => {
  const hidden = C('c8', '母亲', {
    wardrobeState: 'hidden_face',
    wardrobeRefs: { hidden_face: { refSet: 'mother_temp_back', costume: '围裙家居装', facePolicy: 'hidden' } },
  })
  const shot = S({ characterIds: ['c8'], location: '客厅', timeOfDay: '白天', visual: '母亲肩背', action: '站立' })
  const ear = buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': { origin: 'external_unverified', path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'hidden', faceVisibilityAllow: ['ear'] } } },
  }), OPTS)
  const row = ear.assetContract!.characters.find((r) => r.characterId === 'c8')!
  assert.equal(row.faceVisibility, 'hidden')
  assert.deepEqual(row.faceVisibilityAllow, ['ear'])
  assert.ok(!ear.assetContract!.gaps.some((g) => String(g.code).startsWith('asset_hidden_face_')))

  const cheekBind = { origin: 'external_unverified' as const, path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'hidden' as const, faceVisibilityAllow: ['cheek'] as unknown as Array<'ear'> }
  const cheek = buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': cheekBind } },
  }), OPTS)
  assert.ok(cheek.assetContract!.gaps.some((g) => g.code === 'asset_hidden_face_unqualified' && /cheek/.test(g.message || '')))
  assert.throws(() => buildVideoPipelineExport(P([hidden], [shot], {
    assetBindings: { characters: { 'c8:hidden_face': { origin: 'external_unverified', path: 'refsets/mother_temp_back/00_000.jpg', faceVisibility: 'hidden', faceVisibilityAllow: ['jaw'] as unknown as Array<'ear'> } } },
  }), { ...OPTS, assetContractStrict: true }), (err: unknown) =>
    err instanceof AssetContractError && err.gaps.some((g) => g.code === 'asset_hidden_face_unqualified' && /jaw/.test(g.message || '')))
})

console.log(`\n${pass} tests passed`)
