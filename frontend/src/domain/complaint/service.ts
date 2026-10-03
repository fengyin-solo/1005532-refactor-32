/**
 * 质量投诉服务层：投诉页的受理、回复、关闭、登记四个入口共用这里的实现。
 * 页面不再各自判断字段、各自改状态，避免两套规则各跑各的。
 */
import { listRows, saveRows } from '../../data/local-store'
import type { ActionResult, EntryRow } from '../../data/types'
import {
  canTransition,
  QA_DEPARTMENT,
  reconcileSource,
  todayISO,
  validateComplaint,
  type ComplaintAction,
  type ComplaintStage,
} from './rules'

const COMPLAINT_KEY = 'complaint'
const TRAINING_KEY = 'training'

/** 投诉记录允许写入的业务字段，页面多带的字段不会进库。 */
const COMPLAINT_FIELDS = [
  '投诉编号',
  '投诉来源',
  '涉及产品',
  '投诉内容',
  '调查结论',
  '处理措施',
  '结论出具部门',
  '回复日期',
  '关闭日期',
] as const

const ACTION_STAGE: Record<ComplaintAction, ComplaintStage> = {
  受理投诉: 'accept',
  回复投诉: 'reply',
  关闭投诉: 'close',
}

const ACTION_LABEL: Record<ComplaintAction, string> = {
  受理投诉: '受理',
  回复投诉: '回复',
  关闭投诉: '关闭',
}

function toResult(check: { ok: boolean; message?: string }): ActionResult {
  return check.ok
    ? { ok: true, message: check.message ?? '' }
    : { ok: false, message: check.message ?? '投诉规则校验未通过' }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function pickPatch(patch: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const field of COMPLAINT_FIELDS) {
    const value = patch[field]
    if (typeof value === 'string') {
      picked[field] = value.trim()
    }
  }
  return picked
}

/**
 * 登记投诉：走与受理/关闭完全相同的 validateComplaint。
 * 投诉编号重复、来源/内容缺失、来源极值在这里就挡掉，不污染老数据。
 */
export function registerComplaint(input: Record<string, unknown>): ActionResult {
  const payload: Record<string, unknown> = { ...pickPatch(input) }
  const rows = listRows(COMPLAINT_KEY)
  const check = validateComplaint('register', payload, { existing: rows })
  if (!check.ok) {
    return toResult(check)
  }
  const row: EntryRow = {
    id: nextId(rows),
    status: '待受理',
    pending: true,
    abnormal: false,
    投诉编号: '',
    投诉来源: '',
    涉及产品: '',
    投诉内容: '',
    调查结论: '',
    处理措施: '',
    结论出具部门: '',
    回复日期: '',
    关闭日期: '',
    ...payload,
  }
  saveRows(COMPLAINT_KEY, [...rows, row])
  return { ok: true, message: `投诉 ${row['投诉编号']} 已登记，状态「待受理」` }
}

/**
 * 受理/回复/关闭的唯一执行入口：
 * 先拦越级流转，再跑统一字段校验（编号查重、来源/内容齐全、结论归口、回复日期留档），
 * 通过后才落库；关闭时把结论同步成人员培训待办（同一份投诉只同步一次）。
 */
export function runComplaintAction(
  id: number,
  action: ComplaintAction,
  input: Record<string, unknown> = {},
): ActionResult {
  const rows = listRows(COMPLAINT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的投诉记录` }
  }
  const current = rows[index]
  const transition = canTransition(String(current.status), action)
  if (!transition.ok) {
    return toResult(transition)
  }

  const stage = ACTION_STAGE[action]
  const merged: Record<string, unknown> = { ...current, ...pickPatch(input) }

  // 回复动作负责把回复日期留档；页面没填时按当天补登，关闭前必须已经存在。
  if (action === '回复投诉' && !merged['回复日期']) {
    merged['回复日期'] = todayISO()
  }
  if (!merged['结论出具部门']) {
    merged['结论出具部门'] = QA_DEPARTMENT
  }

  const check = validateComplaint(
    stage,
    merged,
    { existing: rows, selfId: id },
  )
  if (!check.ok) {
    return toResult(check)
  }

  // 投诉来源与来源登记表两处核对：以登记表归口为准，对不上就不放行。
  const sourceCheck = reconcileSource(merged['投诉来源'])
  if (!sourceCheck.consistent) {
    return { ok: false, message: '投诉来源与来源登记表对不上，请按登记表归口后再操作' }
  }

  const target = transition.target
  const updated: EntryRow = {
    ...current,
    ...(pickPatch(input) as Record<string, string | number | boolean>),
    status: target,
    pending: target !== '已关闭',
    abnormal: false,
  }
  if (action === '回复投诉' && !updated['回复日期']) {
    updated['回复日期'] = todayISO()
  }
  if (!updated['结论出具部门']) {
    updated['结论出具部门'] = QA_DEPARTMENT
  }
  if (action === '关闭投诉') {
    updated['关闭日期'] = todayISO()
  }

  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(COMPLAINT_KEY, nextRows)

  if (action === '关闭投诉') {
    syncTrainingTodo(updated, sourceCheck.canonical.owner)
  }

  return {
    ok: true,
    message: `投诉已${ACTION_LABEL[action]}，当前状态「${target}」（归口：${sourceCheck.canonical.owner}）`,
  }
}

/**
 * 结论同步到人员培训待办：投诉关闭时，按来源归口给对应岗位建一条待培训记录。
 * 同一份投诉重复复核/重复关闭只算一次——已存在同来源投诉编号的待办就不再建。
 */
function syncTrainingTodo(complaint: EntryRow, owner: string): ActionResult {
  const trainings = listRows(TRAINING_KEY)
  const complaintNumber = String(complaint['投诉编号'] ?? '')
  // 同一份投诉只同步一次：已存在相同来源投诉编号的待办就不再追加（重复复核只算一次）。
  const already = trainings.some(
    (row) => String(row['来源投诉编号'] ?? '') === complaintNumber,
  )
  if (already) {
    return { ok: true, message: '培训待办此前已生成，重复复核只算一次' }
  }

  const id = nextId(trainings)
  const todo: EntryRow = {
    id,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: `TRAI-COMP-${String(id).padStart(3, '0')}`,
    培训主题: `投诉 ${complaintNumber} 结论宣贯：${String(complaint['调查结论'] ?? '')}`,
    受训岗位: `${owner}相关岗位`,
    培训方式: '待安排',
    考核成绩: '',
    培训日期: '',
    有效期至: '',
    培训状态: '待培训',
    来源投诉编号: complaintNumber,
    待办来源: '质量投诉关闭同步',
  }
  saveRows(TRAINING_KEY, [...trainings, todo])
  return { ok: true, message: '已同步人员培训待办' }
}
