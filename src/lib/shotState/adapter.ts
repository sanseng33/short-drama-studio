/**
 * 声明式文本包装（可选辅助）。lockBody 逐字相等不是通用创作规范，这里只记录有声明的确定性包装：
 * wrapperId 必填，记录 inputHash/outputHash，不静默覆写输入。不接入导出默认路径。
 *
 * 模型特定限制（长度上限、字段支持声明）只写在 ModelAdapterSpec 里，不进入状态源 / 派生文本 / 默认导出。
 * 这是工作室侧的适配声明；H3 接收端未改，也没有声明支持任何 shot-state 字段。
 */
import { hashText } from './hashing'
import type { FieldDecl } from './types'

export interface TextWrapper {
  /** 必填：包装器标识 */
  wrapperId: string
  wrapperVersion: string
  /** 确定性包装（同输入同输出） */
  wrap: (input: string) => string
}

export interface CompiledAdapterText {
  text: string
  wrapperId: string
  wrapperVersion: string
  inputHash: string
  outputHash: string
}

export function compileAdapterText(input: string, wrapper: TextWrapper): CompiledAdapterText {
  if (!wrapper || typeof wrapper.wrapperId !== 'string' || !wrapper.wrapperId.trim()) {
    throw new Error('shot-state: compileAdapterText requires a non-empty wrapperId')
  }
  const text = wrapper.wrap(input)
  return {
    text,
    wrapperId: wrapper.wrapperId,
    wrapperVersion: wrapper.wrapperVersion,
    inputHash: hashText(input),
    outputHash: hashText(text),
  }
}

/** 记录是否仍与给定输入/输出一致（不判断语义）。 */
export function adapterRecordMatches(rec: CompiledAdapterText, input: string, output: string): boolean {
  return rec.inputHash === hashText(input) && rec.outputHash === hashText(output)
}

/** 版本化的模型适配声明（工作室侧）。 */
export interface ModelAdapterSpec extends TextWrapper {
  adapterId: string
  adapterVersion: string
  modelId: string
  /** 适配后文本的长度上限；超出只记警告，不截断、不改写 */
  maxPromptChars?: number
  /** 需要被适配的文本字段，默认 ['seedancePrompt'] */
  textFields?: string[]
  /** 该模型对字段的支持声明，并入每镜 fields（已有同名声明优先）；run_required 且不支持会阻断 run-ready */
  fieldDecls?: FieldDecl[]
}

export interface CompiledModelAdapterText extends CompiledAdapterText {
  adapterId: string
  adapterVersion: string
  modelId: string
  warnings: string[]
}

export const DEFAULT_ADAPTER_TEXT_FIELDS: readonly string[] = ['seedancePrompt']

export function assertModelAdapter(adapter: ModelAdapterSpec): void {
  if (!adapter || typeof adapter.adapterId !== 'string' || !adapter.adapterId.trim()) {
    throw new Error('shot-state: model adapter requires a non-empty adapterId')
  }
  if (typeof adapter.adapterVersion !== 'string' || !adapter.adapterVersion.trim()) {
    throw new Error('shot-state: model adapter requires a non-empty adapterVersion')
  }
  if (typeof adapter.modelId !== 'string' || !adapter.modelId.trim()) {
    throw new Error('shot-state: model adapter requires a non-empty modelId')
  }
}

export function compileModelAdapterText(input: string, adapter: ModelAdapterSpec): CompiledModelAdapterText {
  assertModelAdapter(adapter)
  const rec = compileAdapterText(input, adapter)
  const warnings: string[] = []
  if (adapter.maxPromptChars !== undefined && rec.text.length > adapter.maxPromptChars) {
    warnings.push(`prompt_exceeds_adapter_limit:${rec.text.length}/${adapter.maxPromptChars}`)
  }
  return { ...rec, adapterId: adapter.adapterId, adapterVersion: adapter.adapterVersion, modelId: adapter.modelId, warnings }
}
