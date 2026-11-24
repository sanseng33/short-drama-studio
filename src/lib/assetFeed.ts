/**
 * H3 asset feed contract (`assetContract`, version `h3-feed@1`), attached to the video-pipeline@1 export.
 *
 * What it is: an additive, immutable manifest. Old export fields stay as they were; old H3 parsers ignore this key.
 *   - characters: one row per `characterId x wardrobeState` that appears on screen -> refSet id + file binding
 *   - scenes:     one row per shot `sceneId` (never `sceneIdExport`) -> plate file binding
 *   - gaps / divergences: everything missing or contradictory is listed here AND pushed into `warnings`
 *
 * Hash rules (fail closed):
 *   - sha256 is the SHA-256 of FILE BYTES the caller holds (`origin: local_computed`), or a hash copied from a user
 *     manifest (`origin: imported_manifest`, hex format checked, kept as given).
 *   - `/mnt/...`, `C:\...`, `http(s)://...` and bare file names are never hashed: `sha256: null`, `origin: external_unverified`.
 *   - A hash without bytes that is not `imported_manifest` throws. `sha1Hex` (text fingerprint) is never used here.
 *   - `trainingAssets` is not read. Training stills are never promoted to a refSet or plate.
 *
 * What strict mode (`assetContractStrict`) means. It checks that the on-screen BINDINGS are complete:
 *   - every on-screen character x wardrobeState has a refSet AND its file is not `missing`;
 *   - every exported shot has a `sceneId` AND that scene's plate file is not `missing`;
 *   - the exported character list has no duplicate `characterId`, and the manifest rows hold no contradictory duplicates.
 * Strict mode does NOT claim that a file is readable on this machine or that a hash was verified by the studio.
 * Only `local_computed` (hash of bytes the caller held) and `imported_manifest` (hash copied from a user manifest,
 * format-checked only) carry a hash. `external_unverified` (external locator, `sha256: null`) passes strict mode but is
 * never "verified": every such row is listed in `notices` (`asset_hash_unverified`) and pushed into `warnings`.
 * Unused `assetBindings` keys (matching no on-screen `${characterId}:${wardrobeState}` and no shot `sceneId`) are only
 * reported as `asset_binding_unused` notices; they never fail an export, in default or strict mode.
 * Limit: a `Project` object holds one entry per binding key, so a duplicate key inside JSON text that was already
 * `JSON.parse`d (later key overwrites the earlier one) cannot be detected here. Only the duplicates visible in the
 * exported character list and in the manifest rows are checked.
 *
 * Studio side scope: export + static validation only. The studio does not generate lockcards, does not compute
 * remote hashes and does not read any H3 run product.
 *
 * ---- H3 comparison fields (documentation only; the H3 receiver is a separate task) ----
 * A later single-shot dry run / real run must match the following. Any item the contract requires but the run drops
 * must carry an explicit reason code. Silent disappearance is a defect.
 *   jobs:      characterIds, wardrobeState, refSet, refSetImage / image / image_source, sceneId, scenePlate,
 *              scenePlateDropped, firstFrame, prefixstreamRole, lockCard, lockBody, submitted prompt, seed, frames,
 *              prefixstream latent scene dir name (derived from sceneId, not sceneIdExport)
 *   lockcard (H3 run product): lock_card.costumes after override must agree with the binding text of the contract;
 *              the `<Picture 1>` / `<Picture 2>` declarations in lockBody
 *   live graph (the real submitted graph): MiniMaxH3ReferenceToVideo prompt text; ref_images.ref_image_* LoadImage
 *              paths and count; length / noise_seed; PrefixStream LoadLatent path scene slug
 * Visible-drop rules (receiver side, recorded here):
 *   - scenePlateDropped=closeup may keep the plate out of the tensor, but jobs must record the reason code, and the
 *     submitted prompt must not declare an unattached `<Picture 2>` (or must mark that Picture 2 was removed).
 *   - A costume override must not change only the prompt while the contract still claims the script-costume bytes.
 *
 * Repo tests for this module check the static manifest only. They never claim a live graph was verified.
 */
import { isSha256Hex, sha256Hex } from './contentHash'
import type { AssetBindingInput, Project, ProjectAssetBindings } from '../types'
import type { VideoPipelineExport, VideoPipelineWarning } from './videoExport'

export const ASSET_CONTRACT_VERSION = 'h3-feed@1' as const

export type AssetOrigin = 'local_computed' | 'imported_manifest' | 'external_unverified' | 'missing'

export interface AssetFile {
  /** logical / relative name (e.g. refsets/<refSet>/00_000.png); null when nothing is named. Never a machine absolute path. */
  logicalPath: string | null
  /** 64 lowercase hex or null */
  sha256: string | null
  hashAlg: 'sha256'
  origin: AssetOrigin
  note: string
}

export interface CharacterAssetRow {
  characterId: string
  characterKey?: string
  wardrobeState: string
  refSet: string | null
  file: AssetFile
}

export interface SceneAssetRow {
  sceneId: string
  sceneLabel: string
  placeKey?: string
  plate: { file: AssetFile }
}

/** gaps fail strict mode */
export type AssetGapCode =
  | 'asset_refset_missing'
  | 'asset_plate_missing'
  | 'asset_ref_file_missing'
  | 'asset_scene_id_missing'
  | 'asset_character_id_duplicate'
  | 'asset_reference_conflict'
/** notices are visible warnings that never fail strict mode */
export type AssetNoticeCode = 'asset_hash_unverified' | 'asset_binding_unused'
export type AssetDivergenceCode = 'asset_costume_placeholder' | 'asset_costume_divergence'

export interface AssetNotice {
  code: AssetNoticeCode
  message: string
  characterId?: string
  wardrobeState?: string
  sceneId?: string
  /** the `assetBindings` key for asset_binding_unused */
  bindingKey?: string
}

export interface AssetGap {
  code: AssetGapCode
  message: string
  episode: number
  shotId?: string
  characterId?: string
  wardrobeState?: string
  sceneId?: string
}

export interface AssetDivergence {
  code: AssetDivergenceCode
  message: string
  characterId: string
  wardrobeState: string
}

export interface AssetContract {
  version: typeof ASSET_CONTRACT_VERSION
  hashAlg: 'sha256'
  /** this manifest is a static export; it says nothing about a live graph */
  verification: 'static_only'
  strict: boolean
  characters: CharacterAssetRow[]
  scenes: SceneAssetRow[]
  gaps: AssetGap[]
  /** non-blocking: unverified (external) files and unused bindings */
  notices: AssetNotice[]
  divergences: AssetDivergence[]
}

export class AssetContractError extends Error {
  readonly gaps: AssetGap[]
  constructor(message: string, gaps: AssetGap[] = []) {
    super(message)
    this.name = 'AssetContractError'
    this.gaps = gaps
  }
}

const EXTERNAL_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\|https?:\/\/|s3:\/\/|file:\/\/)/i
const PLACEHOLDER_COSTUME = /user[- ]?provided|owner[ -]?photo|replaces? script costume|用户提供|本人照片|替代剧本服装|替换剧本服装|待补充/i

/** true for absolute / remote references and bare file names (no directory part) */
export function isExternalReference(p: string): boolean {
  const s = p.trim()
  if (!s) return false
  if (EXTERNAL_PATH.test(s)) return true
  return !/[\\/]/.test(s)
}

function externalCategory(p: string): string {
  const s = p.trim()
  if (/^https?:\/\//i.test(s)) return '远端 URL'
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(s)) return 'Windows 路径'
  if (/^\/mnt\//.test(s)) return '历史云端路径'
  if (s.startsWith('/')) return '绝对路径'
  return '仅文件名'
}

function missingFile(note: string): AssetFile {
  return { logicalPath: null, sha256: null, hashAlg: 'sha256', origin: 'missing', note }
}

/** Resolve one binding. Throws on any hash/origin combination that would fabricate a hash. */
export function resolveAssetFile(binding: AssetBindingInput | undefined, defaultLogicalPath: string | null, what: string): AssetFile {
  const { bytes, sha256, origin, note: userNote } = binding ?? ({} as AssetBindingInput)
  const path = binding?.path?.trim() || ''
  const extra = userNote?.trim() ? `；${userNote.trim()}` : ''
  const fail = (msg: string): never => {
    throw new AssetContractError(`${what}：${msg}`)
  }
  if (sha256 !== undefined && !isSha256Hex(sha256)) fail('sha256 必须是 64 位小写十六进制')

  if (bytes) {
    if (origin && origin !== 'local_computed') fail(`已提供文件字节，origin 只能是 local_computed（收到 ${origin}）`)
    const computed = sha256Hex(bytes)
    if (sha256 !== undefined && sha256 !== computed) fail('传入的 sha256 与文件字节不一致')
    const logical = path && !isExternalReference(path) ? path : defaultLogicalPath
    const from = path && isExternalReference(path) ? `；来源 ${externalCategory(path)}：${path}` : ''
    return { logicalPath: logical, sha256: computed, hashAlg: 'sha256', origin: 'local_computed', note: `对本机持有的 ${bytes.length} 字节计算${from}${extra}` }
  }

  if (origin === 'local_computed') fail('origin=local_computed 需要文件字节')
  if (sha256 !== undefined) {
    if (origin !== 'imported_manifest') fail('只有 imported_manifest 可以在没有字节时带 sha256')
    const logical = path && !isExternalReference(path) ? path : defaultLogicalPath
    return { logicalPath: logical, sha256, hashAlg: 'sha256', origin: 'imported_manifest', note: `来自用户导入清单，未重算${extra}` }
  }
  if (origin === 'imported_manifest') fail('origin=imported_manifest 需要 sha256')

  if (origin === 'missing') return missingFile(`未绑定文件${extra}`)
  if (path) {
    const category = externalCategory(path)
    const where = isExternalReference(path) ? `${category}，未在本机核验` : '仅有逻辑路径，无文件字节，未核验'
    return { logicalPath: isExternalReference(path) ? defaultLogicalPath : path, sha256: null, hashAlg: 'sha256', origin: 'external_unverified', note: `${where}：${path}${extra}` }
  }
  if (origin === 'external_unverified') {
    return { logicalPath: defaultLogicalPath, sha256: null, hashAlg: 'sha256', origin: 'external_unverified', note: `外部引用，未在本机核验${extra}` }
  }
  return missingFile('')
}

const norm = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, '').toLowerCase()

export function buildAssetContract(project: Project, exp: VideoPipelineExport, strict: boolean): { contract: AssetContract; warnings: VideoPipelineWarning[] } {
  const bindings = project.assetBindings
  const chars = new Map(exp.characters.map((c) => [c.id, c]))
  const charRows: CharacterAssetRow[] = []
  const charSeen = new Map<string, CharacterAssetRow>()
  const sceneRows: SceneAssetRow[] = []
  const sceneSeen = new Map<string, SceneAssetRow>()

  for (const shot of exp.shots) {
    for (const id of shot.characterIds || []) {
      const c = chars.get(id)
      const state = shot.wardrobeState?.[id]?.trim() || c?.wardrobeState?.trim() || 'default'
      const key = `${id}:${state}`
      if (charSeen.has(key)) continue
      const ref = c?.wardrobeRefs?.[state]
      const refSet = ref?.refSet?.trim() || ref?.fallbackRefSet?.trim() || null
      const logical = refSet ? `refsets/${refSet}/00_000.png` : null
      const binding = bindings?.characters?.[key]
      let file: AssetFile
      if (binding) file = resolveAssetFile(binding, logical, `角色 ${id} × ${state} 的文件绑定`)
      else if (refSet) file = { logicalPath: logical, sha256: null, hashAlg: 'sha256', origin: 'external_unverified', note: 'refSet 名称来自 wardrobeRefs，没有文件字节，未在本机核验' }
      else file = missingFile('没有 refSet，也没有文件')
      const row: CharacterAssetRow = { characterId: id, ...(c?.characterKey ? { characterKey: c.characterKey } : {}), wardrobeState: state, refSet, file }
      charSeen.set(key, row)
      charRows.push(row)
    }
    const sid = shot.sceneId
    // a shot without sceneId gets no row; verifyAssetContract reports it. The key is never generated or repaired here.
    if (sid && sid.trim() && !sceneSeen.has(sid)) {
      const binding = bindings?.scenes?.[sid]
      const file = binding ? resolveAssetFile(binding, `plates/${sid}/plate.png`, `场景 ${sid} 的 plate 绑定`) : missingFile('没有 plate 文件')
      const row: SceneAssetRow = { sceneId: sid, sceneLabel: shot.sceneLabel || '', ...(shot.placeKey ? { placeKey: shot.placeKey } : {}), plate: { file } }
      sceneSeen.set(sid, row)
      sceneRows.push(row)
    }
  }

  const divergences: AssetDivergence[] = []
  for (const row of charRows) {
    const c = chars.get(row.characterId)
    if (!c) continue
    const ref = c.wardrobeRefs?.[row.wardrobeState]
    const texts: [string, string | undefined][] = [
      ['角色 costume', c.costume],
      ['wardrobeRefs.costume', ref?.costume],
      ['wardrobeRefs.note', ref?.note],
      ['绑定 note', bindings?.characters?.[`${row.characterId}:${row.wardrobeState}`]?.note],
    ]
    const hit = texts.find(([, t]) => t && PLACEHOLDER_COSTUME.test(t))
    if (hit) {
      divergences.push({
        code: 'asset_costume_placeholder',
        characterId: row.characterId,
        wardrobeState: row.wardrobeState,
        message: `角色 ${row.characterId} × ${row.wardrobeState}：${hit[0]} 只有占位说明（${hit[1]!.trim().slice(0, 40)}），与剧本服装可能不一致；导出未改写任何服装或提示词`,
      })
    }
    const own = c.wardrobeState?.trim() || 'default'
    if (row.wardrobeState === own && ref?.costume && c.costume && norm(ref.costume) !== norm(c.costume) && !hit) {
      divergences.push({
        code: 'asset_costume_divergence',
        characterId: row.characterId,
        wardrobeState: row.wardrobeState,
        message: `角色 ${row.characterId} × ${row.wardrobeState}：costume 与 wardrobeRefs.costume 文本不一致；导出保留两者原文`,
      })
    }
  }

  const contract: AssetContract = {
    version: ASSET_CONTRACT_VERSION,
    hashAlg: 'sha256',
    verification: 'static_only',
    strict,
    characters: charRows,
    scenes: sceneRows,
    gaps: [],
    notices: [],
    divergences,
  }
  contract.gaps = verifyAssetContract(contract, exp)
  contract.notices = collectAssetNotices(contract, bindings)

  const warnings: VideoPipelineWarning[] = [
    ...contract.gaps.map((g) => ({ episode: g.episode, ...(g.shotId ? { shotId: g.shotId } : {}), ...(g.characterId ? { characterId: g.characterId } : {}), code: g.code, message: g.message })),
    ...contract.notices.map((n) => ({ episode: 0, ...(n.characterId ? { characterId: n.characterId } : {}), code: n.code, message: n.message })),
    ...divergences.map((d) => ({ episode: 0, characterId: d.characterId, code: d.code, message: d.message })),
  ]
  if (strict && contract.gaps.length) {
    throw new AssetContractError(`严格模式：资产清单有 ${contract.gaps.length} 处缺口（${[...new Set(contract.gaps.map((g) => g.code))].join(', ')}）；导出给视频流水线已阻断`, contract.gaps)
  }
  return { contract, warnings }
}

/**
 * Static check of a contract against the export it belongs to. Pure; reads no files and no H3 products.
 * Reports:
 *   - duplicate `characterId` in the exported character list (asset_character_id_duplicate)
 *   - contradictory duplicate rows for one `${characterId}:${wardrobeState}` or one `sceneId` (asset_reference_conflict)
 *   - on-screen character x state without a row / without refSet (asset_refset_missing) or with a refSet whose file is `missing` (asset_ref_file_missing)
 *   - shot without sceneId (asset_scene_id_missing); shot sceneId without a plate row or with a missing plate (asset_plate_missing)
 * `external_unverified` files are not gaps here; they are listed by `collectAssetNotices`.
 */
export function verifyAssetContract(contract: AssetContract, exp: VideoPipelineExport): AssetGap[] {
  const gaps: AssetGap[] = []

  const idCount = new Map<string, number>()
  for (const c of exp.characters) idCount.set(c.id, (idCount.get(c.id) || 0) + 1)
  for (const [id, count] of idCount) {
    if (count > 1) gaps.push({ code: 'asset_character_id_duplicate', episode: 0, characterId: id, message: `角色表中 characterId「${id}」出现 ${count} 次，资产绑定有歧义；导出未合并或改写任何角色` })
  }

  // First row wins in the lookup; a later row that disagrees is reported. (A `Project` holds one binding per key, and a
  // duplicate key inside JSON text is already overwritten by JSON.parse, so only duplicate manifest rows can be seen here.)
  const fileSig = (f: AssetFile) => JSON.stringify([f.logicalPath, f.sha256, f.origin])
  const charRows = new Map<string, CharacterAssetRow>()
  for (const r of contract.characters) {
    const k = `${r.characterId}:${r.wardrobeState}`
    const first = charRows.get(k)
    if (!first) charRows.set(k, r)
    else if (first.refSet !== r.refSet || fileSig(first.file) !== fileSig(r.file)) {
      gaps.push({ code: 'asset_reference_conflict', episode: 0, characterId: r.characterId, wardrobeState: r.wardrobeState, message: `角色 ${r.characterId} × ${r.wardrobeState} 在清单中有互相矛盾的多行（refSet / path / sha256 / origin 不一致）` })
    }
  }
  const sceneRows = new Map<string, SceneAssetRow>()
  for (const r of contract.scenes) {
    const first = sceneRows.get(r.sceneId)
    if (!first) sceneRows.set(r.sceneId, r)
    else if (fileSig(first.plate.file) !== fileSig(r.plate.file)) {
      gaps.push({ code: 'asset_reference_conflict', episode: 0, sceneId: r.sceneId, message: `场景 ${r.sceneId} 在清单中有互相矛盾的多行（path / sha256 / origin 不一致）` })
    }
  }
  const chars = new Map(exp.characters.map((c) => [c.id, c]))
  const seenChar = new Set<string>()
  const seenScene = new Set<string>()
  for (const shot of exp.shots) {
    for (const id of shot.characterIds || []) {
      const state = shot.wardrobeState?.[id]?.trim() || chars.get(id)?.wardrobeState?.trim() || 'default'
      const key = `${id}:${state}`
      if (seenChar.has(key)) continue
      seenChar.add(key)
      const row = charRows.get(key)
      if (!row || !row.refSet) {
        gaps.push({
          code: 'asset_refset_missing',
          episode: shot.episode,
          shotId: shot.id,
          characterId: id,
          wardrobeState: state,
          message: `镜头 ${shot.id}：角色 ${id} × ${state} ${row ? '没有 refSet' : '在资产清单中没有对应行'}`,
        })
      } else if (row.file.origin === 'missing') {
        gaps.push({
          code: 'asset_ref_file_missing',
          episode: shot.episode,
          shotId: shot.id,
          characterId: id,
          wardrobeState: state,
          message: `镜头 ${shot.id}：角色 ${id} × ${state} 有 refSet「${row.refSet}」，但文件绑定为 missing`,
        })
      }
    }
    const sid = shot.sceneId
    if (!sid || !sid.trim()) {
      // reported only; the scene key is never generated, repaired or filled from sceneIdExport
      gaps.push({ code: 'asset_scene_id_missing', episode: shot.episode, shotId: shot.id, message: `镜头 ${shot.id} 没有 sceneId；导出未生成或改写场景键，该镜无法对应 plate` })
    } else if (!seenScene.has(sid)) {
      seenScene.add(sid)
      const row = sceneRows.get(sid)
      if (!row || row.plate.file.origin === 'missing') {
        gaps.push({
          code: 'asset_plate_missing',
          episode: shot.episode,
          shotId: shot.id,
          sceneId: sid,
          message: `镜头 ${shot.id}：场景 ${sid} ${row ? '没有 plate 文件' : '在资产清单中没有对应行'}`,
        })
      }
    }
  }
  return gaps
}

/**
 * Non-blocking notices. Never throws and never changes strict-mode results.
 *   - asset_hash_unverified: a row whose file is `external_unverified` (locator only, `sha256: null`). It is not a verified file
 *     and not `local_computed`; strict mode still lets it through, but it stays visible.
 *   - asset_binding_unused: an `assetBindings` key that matches no on-screen `${characterId}:${wardrobeState}` row and no shot `sceneId` row.
 */
export function collectAssetNotices(contract: AssetContract, bindings: ProjectAssetBindings | undefined): AssetNotice[] {
  const notices: AssetNotice[] = []
  for (const r of contract.characters) {
    if (r.file.origin !== 'external_unverified') continue
    notices.push({
      code: 'asset_hash_unverified',
      characterId: r.characterId,
      wardrobeState: r.wardrobeState,
      message: `角色 ${r.characterId} × ${r.wardrobeState}：文件只有外部定位或 refSet 名称，sha256 为空，未核验（不是 local_computed）`,
    })
  }
  for (const r of contract.scenes) {
    if (r.plate.file.origin !== 'external_unverified') continue
    notices.push({
      code: 'asset_hash_unverified',
      sceneId: r.sceneId,
      message: `场景 ${r.sceneId}：plate 只有外部定位，sha256 为空，未核验（不是 local_computed）`,
    })
  }
  const usedChars = new Set(contract.characters.map((r) => `${r.characterId}:${r.wardrobeState}`))
  const usedScenes = new Set(contract.scenes.map((r) => r.sceneId))
  for (const key of Object.keys(bindings?.characters ?? {})) {
    if (!usedChars.has(key)) notices.push({ code: 'asset_binding_unused', bindingKey: key, message: `assetBindings.characters 的键「${key}」没有对应任何出镜的 角色ID:服装状态，已忽略` })
  }
  for (const key of Object.keys(bindings?.scenes ?? {})) {
    if (!usedScenes.has(key)) notices.push({ code: 'asset_binding_unused', bindingKey: key, sceneId: key, message: `assetBindings.scenes 的键「${key}」没有对应任何镜头的 sceneId，已忽略` })
  }
  return notices
}
