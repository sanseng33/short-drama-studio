/** shot-state-ssot@0.1.0-draft 的公开入口。 */
export * from './types'
export { hashSource, hashText, sameSet, setDiff, canonicalSource, normalizeSource } from './hashing'
export { createShotState, firstFrameVisibleIds, castEqualsFirstFrameVisible, withFields, type CreateShotStateInput } from './state'
export { migrateLegacyShot, type CharLike, type LegacyShotLike } from './migrate'
export {
  COMPILER_VERSION,
  COMPILER_FIELDS,
  deriveText,
  setText,
  adoptUserText,
  addReview,
  textStatus,
  semanticFieldStatus,
  type CompilerField,
  type ReviewInput,
} from './texts'
export { validateShotState } from './validate'
export {
  compileAdapterText,
  adapterRecordMatches,
  compileModelAdapterText,
  assertModelAdapter,
  DEFAULT_ADAPTER_TEXT_FIELDS,
  type TextWrapper,
  type CompiledAdapterText,
  type ModelAdapterSpec,
  type CompiledModelAdapterText,
} from './adapter'
export {
  SHOT_STATE_EXPORT_SPEC,
  H3_SUPPORT_NOTICE,
  ShotStateExportRejectedError,
  buildShotStateExportPack,
  tryBuildShotStateExportPack,
  shotStatePromptView,
  renderShotStateAppendix,
  type ShotStateExportOptions,
  type ShotStateExportProject,
  type ShotStateExportPack,
  type ShotStateExportShot,
  type ShotStateExportText,
  type ShotStateExportBlocker,
  type ShotStateExportWarning,
  type ShotStateExportRejection,
  type ShotAdaptedEntry,
  type ExportPresentation,
  type TryShotStateExport,
} from './export'
export { recordShotStates, shotStateFindings, collectShotStateFindings, type ShotStateEpisodeRecord } from './record'

export { shotStateFromShot, hasExplicitShotState } from './fromShot'
