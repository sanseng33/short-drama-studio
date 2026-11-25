/**
 * 三层分开记账的校验：
 *   structural  结构确定性（集合、可见性种类、事件时序、字段角色）
 *   template    受控派生文本的 sourceHash/textHash 是否仍匹配
 *   semantic    人工/LLM 审查记录；无记录是 unknown，不是 fail，也不是 pass
 * 不用正则或词面相等判断散文语义；结构字段一致不能推出散文一致。
 */
import { sameSet } from './hashing'
import { semanticFieldStatus, textStatus } from './texts'
import {
  SHOT_STATE_SPEC,
  type FieldDecl,
  type FirstFrameEntry,
  type SemanticStatus,
  type ShotEvent,
  type ShotStateDoc,
  type ShotStateIssue,
  type ShotStateMode,
  type ShotStateReport,
} from './types'

type Layer = ShotStateIssue['layer']
const mk = (
  layer: Layer,
  code: string,
  severity: ShotStateIssue['severity'],
  message: string,
  extra: Partial<ShotStateIssue> = {},
): ShotStateIssue => ({ layer, code, severity, message, confidence: 'definite', ...extra })

const VISIBLE = new Set(['full', 'partial'])
const HIDDEN = new Set(['offscreen', 'absent'])

type Vis = 'visible' | 'hidden' | 'unknown'

function structural(doc: ShotStateDoc, mode: ShotStateMode): { issues: ShotStateIssue[]; unverified: string[] } {
  const issues: ShotStateIssue[] = []
  const s = doc.source
  const cast = new Set(s.cast)

  // 集合：displayOrder 与 cast 必须集合相等（顺序只是显示信息）
  if (!sameSet(s.displayOrder, s.cast)) {
    issues.push(mk('structural', 'display_order_set_mismatch', 'error', 'displayOrder 与 cast 集合不一致', { field: 'displayOrder' }))
  }

  const ffById = new Map<string, FirstFrameEntry>()
  for (const e of s.firstFrame) {
    if (ffById.has(e.id)) issues.push(mk('structural', 'firstframe_duplicate', 'error', `首帧重复声明 ${e.id}`, { characterId: e.id }))
    ffById.set(e.id, e)
    if (!cast.has(e.id)) issues.push(mk('structural', 'firstframe_not_in_cast', 'error', `首帧角色 ${e.id} 不在 cast`, { characterId: e.id }))
    if (e.kind === 'partial' && !(e.parts && e.parts.some((p) => p.trim()))) {
      issues.push(mk('structural', 'partial_missing_parts', 'error', `${e.id} 局部可见必须写 parts`, { characterId: e.id }))
    }
    if (e.kind !== 'partial' && e.parts && e.parts.length) {
      issues.push(mk('structural', 'parts_on_non_partial', 'warning', `${e.id} 非 partial 却带 parts`, { characterId: e.id }))
    }
  }
  for (const e of s.speech) {
    if (!cast.has(e.id)) issues.push(mk('structural', 'speech_not_in_cast', 'error', `发声角色 ${e.id} 不在 cast`, { characterId: e.id }))
  }

  // 事件时序（逐角色）
  const evBy = new Map<string, ShotEvent[]>()
  for (const ev of s.events) {
    if (!cast.has(ev.id)) issues.push(mk('structural', 'event_not_in_cast', 'error', `事件角色 ${ev.id} 不在 cast`, { characterId: ev.id }))
    evBy.set(ev.id, [...(evBy.get(ev.id) || []), ev])
  }
  for (const [id, evs] of evBy) {
    const ff = ffById.get(id)
    let vis: Vis = !ff || ff.kind === 'unverified' ? 'unknown' : VISIBLE.has(ff.kind) ? 'visible' : 'hidden'
    let everVisible = vis === 'visible'
    let lastAt = -Infinity
    evs.forEach((ev, i) => {
      if (ev.atSec !== undefined) {
        if (ev.atSec < lastAt) issues.push(mk('structural', 'event_time_regression', 'error', `${id} 事件时间倒退`, { characterId: id }))
        lastAt = Math.max(lastAt, ev.atSec)
      }
      const bad = (code: string, msg: string) => issues.push(mk('structural', code, 'error', `${id} ${msg}`, { characterId: id }))
      switch (ev.kind) {
        case 'start_offscreen':
          if (i > 0) bad('start_event_not_first', 'start_offscreen 必须是该角色的首个事件')
          if (ff && VISIBLE.has(ff.kind)) bad('start_offscreen_but_visible', '声明 start_offscreen 却在首帧 full/partial')
          vis = 'hidden'
          break
        case 'start_visible':
          if (i > 0) bad('start_event_not_first', 'start_visible 必须是该角色的首个事件')
          if (ff && HIDDEN.has(ff.kind)) bad('start_visible_but_hidden', '声明 start_visible 却在首帧 offscreen/absent')
          vis = 'visible'
          everVisible = true
          break
        case 'enter':
          if (vis === 'visible') bad('enter_while_visible', '已在画内却 enter')
          vis = 'visible'
          everVisible = true
          break
        case 'exit':
          if (vis === 'hidden') bad('exit_while_hidden', '不在画内却 exit')
          vis = 'hidden'
          everVisible = true
          break
        case 'reenter':
          if (vis === 'visible') bad('reenter_while_visible', '已在画内却 reenter')
          else if (!everVisible) bad('reenter_without_exit', 'reenter 之前没有出现过或离画')
          vis = 'visible'
          break
      }
    })
  }

  const unverified = s.cast.filter((id) => {
    const e = ffById.get(id)
    return !e || e.kind === 'unverified'
  })
  for (const id of unverified) {
    const sev = mode === 'compat' ? 'info' : 'error'
    issues.push(mk('structural', 'firstframe_unverified', sev, `${id} 首帧可见性未核验`, { characterId: id }))
  }
  return { issues, unverified }
}

function template(doc: ShotStateDoc, mode: ShotStateMode) {
  const issues: ShotStateIssue[] = []
  const fields = doc.texts.map((t) => ({ field: t.field, status: textStatus(doc, t) }))
  for (const f of fields) {
    if (f.status === 'invalidated' || f.status === 'stale') {
      issues.push(
        mk('template', 'derived_invalidated', mode === 'compat' ? 'warning' : 'error', `${f.field} 派生文本已失效（${f.status}），需要重编译或审查`, { field: f.field }),
      )
    }
  }
  return { fields, issues }
}

function semantic(doc: ShotStateDoc, mode: ShotStateMode) {
  const issues: ShotStateIssue[] = []
  const fields = doc.texts.map((t) => ({ field: t.field, status: semanticFieldStatus(doc, t) }))
  for (const f of fields) {
    if (f.status === 'fail') {
      issues.push(mk('semantic', 'semantic_fail', 'error', `${f.field} 语义审查未通过`, { field: f.field }))
    } else if (f.status === 'review_required' || f.status === 'unknown') {
      const sev = mode === 'compat' ? 'info' : 'error'
      issues.push(
        mk('semantic', f.status === 'unknown' ? 'semantic_unknown' : 'semantic_review_required', sev, `${f.field} 缺少有效语义审查（${f.status}）`, {
          field: f.field,
          confidence: 'unknown',
        }),
      )
    }
  }
  let status: SemanticStatus = 'pass'
  if (fields.some((f) => f.status === 'fail')) status = 'fail'
  else if (fields.some((f) => f.status === 'review_required')) status = 'review_required'
  else if (fields.some((f) => f.status === 'unknown')) status = 'unknown'
  return { status, fields, issues }
}

function fieldRoles(decls: readonly FieldDecl[]) {
  const issues: ShotStateIssue[] = []
  const runRequiredUnsupported = decls.filter((d) => d.role === 'run_required' && !d.supported).map((d) => d.name)
  const capabilityUnsupported = decls.filter((d) => d.role === 'capability' && !d.supported).map((d) => d.name)
  const ignoredDocumented = decls.filter((d) => d.role === 'ignored_documented').map((d) => d.name)
  for (const n of runRequiredUnsupported) issues.push(mk('fields', 'run_required_unsupported', 'error', `运行所需字段 ${n} 未被支持，阻断 run-ready`, { field: n }))
  for (const n of capabilityUnsupported) issues.push(mk('fields', 'capability_unsupported', 'warning', `可选能力 ${n} 未被支持（仅警告）`, { field: n }))
  for (const n of ignoredDocumented) issues.push(mk('fields', 'ignored_documented', 'info', `字段 ${n} 已记录为忽略`, { field: n }))
  return { runRequiredUnsupported, capabilityUnsupported, ignoredDocumented, issues }
}

/** 返回 doc 的校验报告。不抛错；结构错误记为 error issue。 */
export function validateShotState(doc: ShotStateDoc, mode: ShotStateMode = 'compat'): ShotStateReport {
  const st = structural(doc, mode)
  const tp = template(doc, mode)
  const sm = semantic(doc, mode)
  const fl = fieldRoles(doc.fields)
  const issues = [...st.issues, ...tp.issues, ...sm.issues, ...fl.issues]

  // run-ready：语义整体必须 pass（派生有效文本与已审 pass 均计入）
  if (mode === 'run-ready' && sm.status !== 'pass' && !sm.issues.some((i) => i.severity === 'error')) {
    issues.push(mk('semantic', 'semantic_not_pass', 'error', `run-ready 需要语义 pass，当前 ${sm.status}`, { confidence: 'unknown' }))
  }

  return {
    spec: SHOT_STATE_SPEC,
    shotId: doc.shotId,
    mode,
    ok: !issues.some((i) => i.severity === 'error'),
    structural: { ok: !st.issues.some((i) => i.severity === 'error'), issues: st.issues },
    template: tp,
    semantic: sm,
    fields: fl,
    unverifiedCharacterIds: st.unverified,
    issues,
  }
}
