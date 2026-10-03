/**
 * 质量投诉统一规则（受理与关闭两个入口共用这一份）。
 *
 * 历史上受理、关闭各写过一套校验：编号重复与否、来源与内容全不全、回复日期写没写，
 * 两套同时跑、改一边漏一边，结论容易分岔。这里收拢成唯一口径：
 *  - 只保留最新一版（COMPLAINT_POLICY_VERSION），不并放历史版本，不存在新旧并行；
 *  - 登记入口与行内「受理投诉」入口都走 validateIntake；
 *  - 「关闭投诉」入口走 validateClose；
 *  - 状态流转只认 STATUS_FLOW，越级一律拦下。
 */

export const COMPLAINT_KEY = 'complaint'
export const TRAINING_KEY = 'training'

/** 统一受理/关闭口径版本：只有当前这一版，老数据不刷版本号。 */
export const COMPLAINT_POLICY_VERSION = '2026-10-03'

/** 出具调查结论的唯一责任部门：投诉按来源归口接待，调查结论统一由质量部出具。 */
export const CONCLUSION_OWNER = '质量部'

/**
 * 投诉来源归口台账：是来源的唯一出处。
 * 登记下拉框与受理校验「两处」都查同一张表，保证两处查到的对得上；
 * 台账外（含超长、乱填等极值来源）一律挡回。
 */
export const SOURCE_LEDGER: Record<string, { ownerDept: string; channelCode: string }> = {
  医疗机构: { ownerDept: '医学事务部', channelCode: 'SRC-HOSP' },
  经营企业: { ownerDept: '销售部', channelCode: 'SRC-DIST' },
  患者来电: { ownerDept: '客户服务部', channelCode: 'SRC-CALL' },
  监管转办: { ownerDept: '质量部', channelCode: 'SRC-REG' },
  内部反馈: { ownerDept: '质量部', channelCode: 'SRC-INNER' },
}

/** 极值约束：越过上下限的录入一律挡回，不做截断兜底。 */
export const COMPLAINT_LIMITS = {
  codeMinLength: 4,
  codeMaxLength: 32,
  sourceMaxLength: 20,
  productMaxLength: 60,
  contentMinLength: 5,
  contentMaxLength: 500,
  conclusionMinLength: 5,
  conclusionMaxLength: 500,
} as const

/** 状态机：只允许按次序推进一步，缺省动作即越级/逆向，拦下。 */
export const STATUS_FLOW: Record<string, Record<string, string>> = {
  待受理: { 受理投诉: '调查中' },
  调查中: { 回复投诉: '已回复' },
  已回复: { 关闭投诉: '已关闭' },
  已关闭: {},
}

export const INITIAL_STATUS = '待受理'

export type ComplaintIntakeDraft = {
  投诉编号: string
  投诉来源: string
  涉及产品: string
  投诉内容: string
}

export type ValidationIssue = {
  field: string
  message: string
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type FlowResult = {
  ok: boolean
  target?: string
  message: string
}

/** 登记入口的来源选项：只能从台账取，避免两处各维护一份。 */
export function listRegisteredSources(): string[] {
  return Object.keys(SOURCE_LEDGER)
}

/** 来源归口查询：登记处、受理处两处核对都走这里。 */
export function ownerOfSource(source: string): string | null {
  const entry = SOURCE_LEDGER[source.trim()]
  return entry ? entry.ownerDept : null
}

/**
 * 来源两处核对：表单/列表里的来源与归口台账比对。
 * 对得上才允许继续；对不上给出挡回原因。
 */
export function crossCheckSource(source: string): { consistent: boolean; message: string } {
  const value = source.trim()
  if (value.length === 0) {
    return { consistent: false, message: '投诉来源未填写，受理资料不全' }
  }
  if (value.length > COMPLAINT_LIMITS.sourceMaxLength) {
    return { consistent: false, message: `投诉来源长度超过极值 ${COMPLAINT_LIMITS.sourceMaxLength} 字，已挡回` }
  }
  if (!SOURCE_LEDGER[value]) {
    return { consistent: false, message: `投诉来源「${value}」在归口台账中查无此项，两处来源核对不一致，已挡回` }
  }
  return { consistent: true, message: '来源与归口台账一致' }
}

/**
 * 统一受理校验：登记投诉、行内受理两个入口共用。
 * @param knownNumbers 已在册的投诉编号（受理动作调用时排除自身编号）
 */
export function validateIntake(
  draft: ComplaintIntakeDraft,
  knownNumbers: string[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const code = draft.投诉编号.trim()
  const content = draft.投诉内容.trim()
  const occupied = new Set(knownNumbers.map((item) => item.trim()))

  if (code.length === 0) {
    issues.push({ field: '投诉编号', message: '投诉编号未填写，受理资料不全' })
  } else {
    if (code.length < COMPLAINT_LIMITS.codeMinLength || code.length > COMPLAINT_LIMITS.codeMaxLength) {
      issues.push({
        field: '投诉编号',
        message: `投诉编号长度需在 ${COMPLAINT_LIMITS.codeMinLength}-${COMPLAINT_LIMITS.codeMaxLength} 字之间，极值录入已挡回`,
      })
    }
    if (!CODE_PATTERN.test(code)) {
      issues.push({ field: '投诉编号', message: '投诉编号只允许字母、数字与连字符' })
    }
    if (occupied.has(code)) {
      issues.push({ field: '投诉编号', message: `投诉编号「${code}」已存在，重复编号不予受理` })
    }
  }

  const sourceCheck = crossCheckSource(draft.投诉来源)
  if (!sourceCheck.consistent) {
    issues.push({ field: '投诉来源', message: sourceCheck.message })
  }

  const product = draft.涉及产品.trim()
  if (product.length > COMPLAINT_LIMITS.productMaxLength) {
    issues.push({
      field: '涉及产品',
      message: `涉及产品长度超过极值 ${COMPLAINT_LIMITS.productMaxLength} 字，已挡回`,
    })
  }

  if (content.length === 0) {
    issues.push({ field: '投诉内容', message: '投诉内容未填写，受理资料不全' })
  } else if (content.length < COMPLAINT_LIMITS.contentMinLength) {
    issues.push({ field: '投诉内容', message: '投诉内容过简，无法支撑调查，请补充完整' })
  } else if (content.length > COMPLAINT_LIMITS.contentMaxLength) {
    issues.push({
      field: '投诉内容',
      message: `投诉内容长度超过极值 ${COMPLAINT_LIMITS.contentMaxLength} 字，已挡回`,
    })
  }

  return issues
}

export function isValidISODate(value: string): boolean {
  const text = value.trim()
  if (!DATE_PATTERN.test(text)) {
    return false
  }
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  )
}

/** 回复动作校验：回复日期必须写上，且须是可归档的合法日期。 */
export function validateReply(replyDate: string): ValidationIssue[] {
  const value = replyDate.trim()
  if (value.length === 0) {
    return [{ field: '回复日期', message: '回复日期未填写，不能进入已回复，回复日期须留档' }]
  }
  if (!isValidISODate(value)) {
    return [{ field: '回复日期', message: '回复日期格式应为 YYYY-MM-DD 的合法日期' }]
  }
  return []
}

/**
 * 统一关闭校验：调查结论由质量部出具、内容齐全，回复日期已留档。
 * 受理口与关闭口共用同一份编号/来源口径，这里只补关闭阶段的硬性条件。
 */
export function validateClose(row: {
  [field: string]: string | number | boolean
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const conclusion = String(row.调查结论 ?? '').trim()
  const owner = String(row.结论部门 ?? '').trim()
  const replyDate = String(row.回复日期 ?? '').trim()

  if (conclusion.length === 0) {
    issues.push({ field: '调查结论', message: '调查结论未出具，投诉不能关闭' })
  } else if (
    conclusion.length < COMPLAINT_LIMITS.conclusionMinLength ||
    conclusion.length > COMPLAINT_LIMITS.conclusionMaxLength
  ) {
    issues.push({
      field: '调查结论',
      message: `调查结论长度需在 ${COMPLAINT_LIMITS.conclusionMinLength}-${COMPLAINT_LIMITS.conclusionMaxLength} 字之间，极值录入已挡回`,
    })
  }

  if (owner !== CONCLUSION_OWNER) {
    issues.push({ field: '结论部门', message: `调查结论须由${CONCLUSION_OWNER}出具并归口，当前「${owner || '未填写'}」不予关闭` })
  }

  if (replyDate.length === 0) {
    issues.push({ field: '回复日期', message: '回复日期未留档，投诉不能关闭' })
  } else if (!isValidISODate(replyDate)) {
    issues.push({ field: '回复日期', message: '留档的回复日期不是合法日期（YYYY-MM-DD）' })
  }

  return issues
}

/**
 * 状态次序流转：只放行 STATUS_FLOW 里登记的紧邻一步。
 * 重复点击同动作、跨步动作、逆向动作都在这里拦下。
 */
export function nextStatusAfter(current: string, action: string): FlowResult {
  const transitions = STATUS_FLOW[current]
  if (!transitions) {
    return { ok: false, message: `投诉当前状态「${current}」不可再流转` }
  }
  const target = transitions[action]
  if (!target) {
    return {
      ok: false,
      message: `投诉状态须按 待受理→调查中→已回复→已关闭 的次序流转，「${action}」不能从「${current}」发起，越级操作已拦下`,
    }
  }
  return { ok: true, target, message: `已${action}，当前状态「${target}」` }
}

/** 某状态下唯一允许的下一步动作（页面按此渲染，服务端仍会再拦一次）。 */
export function allowedAction(status: string): string | null {
  const transitions = STATUS_FLOW[status]
  if (!transitions) {
    return null
  }
  const actions = Object.keys(transitions)
  return actions.length === 1 ? actions[0] : null
}
