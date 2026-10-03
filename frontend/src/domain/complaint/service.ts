/**
 * 质量投诉业务编排：两个入口（登记页弹窗、列表行内动作）都经由这里落库。
 * 规则只有 policy.ts 一份，本文件只负责取数、写库和跨模块同步，不再写第二套校验。
 * 重构不碰老数据：seed 里的历史行原样保留、不迁移、不补字段；新登记行才打规则版本戳。
 */
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

import {
  COMPLAINT_KEY,
  COMPLAINT_POLICY_VERSION,
  CONCLUSION_OWNER,
  TRAINING_KEY,
  INITIAL_STATUS,
  nextStatusAfter,
  validateClose,
  validateIntake,
  validateReply,
} from './policy'
import type { ComplaintIntakeDraft } from './policy'

export {
  COMPLAINT_POLICY_VERSION,
  CONCLUSION_OWNER,
  allowedAction,
  crossCheckSource,
  listRegisteredSources,
  ownerOfSource,
} from './policy'

function complaintRows(): EntryRow[] {
  return listRows(COMPLAINT_KEY)
}

function trainingRows(): EntryRow[] {
  return listRows(TRAINING_KEY)
}

function persistComplaint(rows: EntryRow[]): void {
  saveRows(COMPLAINT_KEY, rows)
}

/** 行是否走统一规则：重构不碰老数据，历史行不刷版本号；新登记行打戳。 */
export function isRuleStamped(row: EntryRow): boolean {
  return String(row.规则版本 ?? '') === COMPLAINT_POLICY_VERSION
}

function uniqueCodes(rows: EntryRow[]): Set<string> {
  const codes = new Set<string>()
  for (const row of rows) {
    const code = String(row.投诉编号 ?? '').trim()
    if (code) {
      codes.add(code)
    }
  }
  return codes
}

/** 同一份投诉重复只算一次：登记按编号查重，统计按编号去重。 */
function distinctCount(rows: EntryRow[], predicate: (row: EntryRow) => boolean): number {
  const codes = new Set<string>()
  for (const row of rows) {
    if (predicate(row)) {
      codes.add(String(row.投诉编号 ?? `id-${row.id}`))
    }
  }
  return codes.size
}

export type ComplaintStats = {
  pendingAccept: number
  investigating: number
  closedThisMonth: number
}

/** 看板统计：同编号多次出现/重复复核只计一次。 */
export function complaintStats(rows: EntryRow[], today = new Date()): ComplaintStats {
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  return {
    pendingAccept: distinctCount(rows, (row) => String(row.status) === '待受理'),
    investigating: distinctCount(rows, (row) => String(row.status) === '调查中'),
    closedThisMonth: distinctCount(
      rows,
      (row) =>
        String(row.status) === '已关闭' &&
        String(row.关闭日期 ?? '').startsWith(monthPrefix),
    ),
  }
}

/**
 * 登记投诉（受理入口一）：统一受理校验通过后落库，初态「待受理」。
 * 与行内「受理投诉」入口共用 validateIntake 这一份口径。
 */
export function registerComplaint(draft: ComplaintIntakeDraft): ActionResult {
  const rows = complaintRows()
  const issues = validateIntake(draft, rows.map((row) => String(row.投诉编号 ?? '')))
  if (issues.length > 0) {
    return { ok: false, message: issues.map((item) => item.message).join('；') }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: INITIAL_STATUS,
    pending: true,
    abnormal: false,
    投诉编号: draft.投诉编号.trim(),
    投诉来源: draft.投诉来源.trim(),
    涉及产品: draft.涉及产品.trim(),
    投诉内容: draft.投诉内容.trim(),
    调查结论: '',
    结论部门: '',
    处理措施: '',
    回复日期: '',
    回复留档时间: '',
    关闭日期: '',
    投诉状态: INITIAL_STATUS,
    规则版本: COMPLAINT_POLICY_VERSION,
  }
  persistComplaint([...rows, row])
  return { ok: true, message: `投诉「${row.投诉编号}」已登记受理资料，状态「${INITIAL_STATUS}」` }
}

function timestampNow(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toTimeString().slice(0, 8)
  return `${date} ${time}`
}

/**
 * 关闭投诉时，把调查结论同步成人员培训的一条待办。
 * 同一份投诉重复复核/重复关闭只同步一次：按投诉编号查已有映射。
 */
function syncTrainingTodo(row: EntryRow): void {
  const trainings = trainingRows()
  const complaintCode = String(row.投诉编号 ?? '')
  const already = trainings.some(
    (item) => String(item.来源投诉编号 ?? '') === complaintCode,
  )
  if (already) {
    return
  }

  const nextId = trainings.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const trainingNo = `TRAI-C${String(nextId).padStart(4, '0')}`
  const todo: EntryRow = {
    id: nextId,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: trainingNo,
    培训主题: `投诉${complaintCode}整改培训`,
    受训岗位: '相关岗位全员',
    培训方式: '专项培训',
    考核成绩: '',
    培训日期: '',
    有效期至: '',
    培训状态: '待培训',
    来源投诉编号: complaintCode,
  }
  saveRows(TRAINING_KEY, [...trainings, todo])
}

/**
 * 行内动作（受理入口二 / 回复 / 关闭共用）：
 * 先按状态机卡次序，再按所处阶段套用统一校验，最后写库。
 */
export function runComplaintAction(
  id: number,
  action: string,
  payload: Record<string, string> = {},
): ActionResult {
  const rows = complaintRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的投诉记录` }
  }
  const current = rows[index]
  const status = String(current.status)

  const flow = nextStatusAfter(status, action)
  if (!flow.ok || !flow.target) {
    return { ok: false, message: flow.message }
  }
  const target = flow.target

  let updated: EntryRow = { ...current }

  if (action === '受理投诉') {
    // 受理口：与登记入口同一份口径，对已在册（含历史）行再核一次编号/来源/内容。
    const issues = validateIntake(
      {
        投诉编号: String(current.投诉编号 ?? ''),
        投诉来源: String(current.投诉来源 ?? ''),
        涉及产品: String(current.涉及产品 ?? ''),
        投诉内容: String(current.投诉内容 ?? ''),
      },
      rows
        .filter((row) => Number(row.id) !== Number(current.id))
        .map((row) => String(row.投诉编号 ?? '')),
    )
    if (issues.length > 0) {
      return { ok: false, message: `受理被挡回：${issues.map((item) => item.message).join('；')}` }
    }
  }

  if (action === '回复投诉') {
    const replyDate = payload.回复日期 ?? ''
    const replyIssues = validateReply(replyDate)
    if (replyIssues.length > 0) {
      return { ok: false, message: replyIssues.map((item) => item.message).join('；') }
    }
    updated = {
      ...updated,
      回复日期: replyDate.trim(),
      回复留档时间: timestampNow(),
    }
  }

  if (action === '关闭投诉') {
    updated = {
      ...updated,
      调查结论: (payload.调查结论 ?? String(current.调查结论 ?? '')).trim(),
      处理措施: (payload.处理措施 ?? String(current.处理措施 ?? '')).trim(),
      // 调查结论统一由质量部出具：以规则常量为准，入口传什么都不能改写。
      结论部门: CONCLUSION_OWNER,
      关闭日期: timestampNow().slice(0, 10),
    }
    const closeIssues = validateClose(updated)
    if (closeIssues.length > 0) {
      return { ok: false, message: closeIssues.map((item) => item.message).join('；') }
    }
  }

  updated = {
    ...updated,
    status: target,
    pending: target !== '已关闭',
    投诉状态: target,
  }
  const next = [...rows]
  next[index] = updated
  persistComplaint(next)

  if (action === '关闭投诉') {
    syncTrainingTodo(updated)
  }

  const suffix =
    action === '关闭投诉' ? '；调查结论已同步为人员培训待办（同投诉重复复核只同步一次）' : ''
  return { ok: true, message: `${flow.message}${suffix}` }
}
