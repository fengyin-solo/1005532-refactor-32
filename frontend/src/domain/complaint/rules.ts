/**
 * 质量投诉统一规则（登记 / 受理 / 回复 / 关闭共用一份）。
 *
 * 背景：受理与关闭过去各写了一套规则——投诉编号是否重复、投诉来源和投诉内容
 * 齐不齐、回复日期写没写，两套并行各跑各的，改一处漏一处，结论容易分岔。
 * 本文件是唯一规则源：任何入口都只能走 validateComplaint 与 canTransition，
 * 不允许在页面里再各写一份口径。
 *
 * 纯函数、不读写存储，方便两个入口和自动化核对共用同一份结论。
 */

export type ComplaintStage = 'register' | 'accept' | 'reply' | 'close'
export type ComplaintStatus = '待受理' | '调查中' | '已回复' | '已关闭'
export type ComplaintAction = '受理投诉' | '回复投诉' | '关闭投诉'

export const COMPLAINT_STATUSES: ComplaintStatus[] = ['待受理', '调查中', '已回复', '已关闭']

/** 状态只能按次序向前走一步；越级、回退、原地重复都由 canTransition 拦下。 */
const NEXT_STATUS: Record<ComplaintStatus, ComplaintStatus | null> = {
  待受理: '调查中',
  调查中: '已回复',
  已回复: '已关闭',
  已关闭: null,
}

export const COMPLAINT_ACTION_TARGET: Record<ComplaintAction, ComplaintStatus> = {
  受理投诉: '调查中',
  回复投诉: '已回复',
  关闭投诉: '已关闭',
}

const STAGE_LABEL: Record<ComplaintStage, string> = {
  register: '登记',
  accept: '受理',
  reply: '回复',
  close: '关闭',
}

/** 各阶段必填字段只在此声明一次，受理与关闭共用同一份字段口径。 */
const STAGE_REQUIRED_FIELDS: Record<ComplaintStage, string[]> = {
  register: ['投诉编号', '投诉来源', '投诉内容'],
  accept: ['投诉编号', '投诉来源', '投诉内容'],
  reply: ['投诉编号', '投诉来源', '投诉内容', '调查结论', '结论出具部门', '回复日期'],
  close: ['投诉编号', '投诉来源', '投诉内容', '调查结论', '处理措施', '结论出具部门', '回复日期'],
}

export type ComplaintSource = {
  code: string
  name: string
  /** 投诉按来源归口：来源登记在谁名下，就由谁跟进。 */
  owner: string
}

/**
 * 投诉来源登记表（两个入口核来源都查这一张表）。
 * 表外取值、极值取值一律挡回，避免受理处和关闭处各查到一个说法。
 */
export const COMPLAINT_SOURCES: ComplaintSource[] = [
  { code: 'CUSTOMER', name: '客户来函', owner: '销售部' },
  { code: 'HOTLINE', name: '客服热线', owner: '销售部' },
  { code: 'DISTRIBUTOR', name: '经销商', owner: '市场部' },
  { code: 'MEDICAL', name: '医疗机构', owner: '医学事务部' },
  { code: 'REGULATOR', name: '监管部门', owner: '质量部' },
  { code: 'INTERNAL', name: '内部反馈', owner: '质量部' },
]

/** 调查结论统一由质量部出具，其他部门出具的结论在回复/关闭时不予认可。 */
export const QA_DEPARTMENT = '质量部'

/** 来源极值阈值：超过这个字数即视为异常极值，挡回。 */
export const SOURCE_MAX_LENGTH = 50

export type ComplaintRuleVersion = {
  version: string
  publishedAt: string
  status: 'active' | 'archived'
  summary: string
}

/**
 * 受理口径版本履历：旧版全部留痕可查，但任何时刻只按最新一版受理，
 * 受理处不再保留第二份口径。
 */
const RULE_VERSIONS: ComplaintRuleVersion[] = [
  { version: 'QS-COM-2024.1', publishedAt: '2024-03-01', status: 'archived', summary: '受理、关闭两套口径并行（已停用）' },
  { version: 'QS-COM-2025.1', publishedAt: '2025-02-10', status: 'archived', summary: '统一编号查重与必填校验（已停用）' },
  { version: 'QS-COM-2026.1', publishedAt: '2026-10-01', status: 'active', summary: '登记/受理/回复/关闭合并为一套统一规则' },
]

export function listComplaintRuleVersions(): ComplaintRuleVersion[] {
  return RULE_VERSIONS.map((item) => ({ ...item }))
}

export function activeComplaintRuleVersion(): ComplaintRuleVersion {
  const active = RULE_VERSIONS.find((item) => item.status === 'active')
  if (!active) {
    throw new Error('投诉受理口径没有处于生效状态的版本')
  }
  return { ...active }
}

export type ComplaintPayload = {
  投诉编号?: unknown
  投诉来源?: unknown
  涉及产品?: unknown
  投诉内容?: unknown
  调查结论?: unknown
  处理措施?: unknown
  结论出具部门?: unknown
  回复日期?: unknown
  关闭日期?: unknown
  [key: string]: unknown
}

export type ComplaintCheckResult = { ok: true } | { ok: false; code: string; message: string }

function fail(code: string, message: string): ComplaintCheckResult {
  return { ok: false, code, message }
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 回复日期必须是真实存在的日历日，2026-02-31 这类取值不放行。 */
export function isValidISODate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value.trim())) {
    return false
  }
  const [year, month, day] = value.trim().split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function todayISO(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isSameMonth(iso: unknown, reference: string = todayISO()): boolean {
  if (typeof iso !== 'string' || !isValidISODate(iso) || !isValidISODate(reference)) {
    return false
  }
  return iso.trim().slice(0, 7) === reference.slice(0, 7)
}

/** 两个入口共用的来源查表：按名称或编码都能定位到登记表里的同一条。 */
export function resolveComplaintSource(source: unknown): ComplaintSource | null {
  if (typeof source !== 'string') {
    return null
  }
  const normalized = source.trim()
  if (!normalized) {
    return null
  }
  const byName = COMPLAINT_SOURCES.find((item) => item.name === normalized)
  if (byName) {
    return byName
  }
  const byCode = COMPLAINT_SOURCES.find((item) => item.code === normalized.toUpperCase())
  return byCode ?? null
}

export type SourceReconcileResult =
  | { consistent: true; canonical: ComplaintSource }
  | { consistent: false; canonical: null }

/**
 * 受理、关闭两处核对来源都走这里：记录上写的来源与来源登记表对得上才算一致，
 * 两处共用一个函数，不可能各查出一个结论。
 */
export function reconcileSource(recordSource: unknown): SourceReconcileResult {
  const canonical = resolveComplaintSource(recordSource)
  return canonical ? { consistent: true, canonical } : { consistent: false, canonical: null }
}

export type ExtremeSourceReason =
  | 'empty'
  | 'too-long'
  | 'control-char'
  | 'saturated'
  | 'unregistered'

const EXTREME_SOURCE_MESSAGE: Record<ExtremeSourceReason, string> = {
  empty: '投诉来源未填写，已挡回',
  'too-long': `投诉来源超出 ${SOURCE_MAX_LENGTH} 字的允许极值，已挡回`,
  'control-char': '投诉来源含非法控制字符，已挡回',
  saturated: '投诉来源是同一字符重复的极值取值，已挡回',
  unregistered: '投诉来源不在来源登记表内，两处核对对不上，已挡回',
}

/** 极值来源识别：空值、超长、控制字符、单字符刷屏、表外来源一律挡回。 */
export function detectExtremeSource(source: unknown): ExtremeSourceReason | null {
  if (typeof source !== 'string' || source.trim() === '') {
    return 'empty'
  }
  const normalized = source.trim()
  if ([...normalized].length > SOURCE_MAX_LENGTH) {
    return 'too-long'
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(normalized)) {
    return 'control-char'
  }
  const compact = [...normalized.replace(/\s+/g, '')]
  if (compact.length >= 8 && compact.every((ch) => ch === compact[0])) {
    return 'saturated'
  }
  if (!resolveComplaintSource(normalized)) {
    return 'unregistered'
  }
  return null
}

export function extremeSourceMessage(reason: ExtremeSourceReason): string {
  return EXTREME_SOURCE_MESSAGE[reason]
}

/**
 * 投诉校验的唯一入口。登记、受理、回复、关闭都调它，字段要求只存在于本文件。
 *
 * @param stage    当前入口（登记/受理/回复/关闭）
 * @param payload  待校验的投诉内容
 * @param options.existing 已有投诉行，用于编号查重
 * @param options.selfId   当前投诉自身 id，自身不算重复（同一份投诉重复复核不算第二份）
 */
export function validateComplaint(
  stage: ComplaintStage,
  payload: ComplaintPayload,
  options: { existing?: ComplaintPayload[]; selfId?: number } = {},
): ComplaintCheckResult {
  // 1) 投诉编号：必填（受理、关闭共用的第一条）
  if (!isFilled(payload['投诉编号'])) {
    return fail('COMPLAINT_NUMBER_MISSING', `投诉编号未填写，不能${STAGE_LABEL[stage]}`)
  }
  const number = String(payload['投诉编号']).trim()

  // 2) 投诉编号重复：只和别的投诉比，自身重复复核不判重，只算一次
  const selfId = options.selfId
  const duplicated = (options.existing ?? []).some((row) => {
    if (selfId !== undefined && Number(row.id) === Number(selfId)) {
      return false
    }
    return String(row['投诉编号'] ?? '').trim() === number
  })
  if (duplicated) {
    return fail('COMPLAINT_NUMBER_DUPLICATED', `投诉编号 ${number} 已存在，不能重复${STAGE_LABEL[stage]}`)
  }

  // 3) 必填项：投诉来源/投诉内容齐不齐，按阶段取同一张字段表
  //    投诉来源、结论出具部门、回复日期有专属校验，不在此通用循环内重复判定。
  const DEDICATED_FIELDS = new Set(['投诉编号', '投诉来源', '结论出具部门', '回复日期'])
  for (const field of STAGE_REQUIRED_FIELDS[stage]) {
    if (DEDICATED_FIELDS.has(field)) {
      continue
    }
    if (!isFilled(payload[field])) {
      return fail('COMPLAINT_FIELD_MISSING', `${field}未填写，不能${STAGE_LABEL[stage]}`)
    }
  }

  // 4) 投诉来源：与来源登记表核对，极值取值挡回（受理、关闭共用）
  const extreme = detectExtremeSource(payload['投诉来源'])
  if (extreme) {
    return fail('COMPLAINT_SOURCE_EXTREME', EXTREME_SOURCE_MESSAGE[extreme])
  }

  // 5) 回复/关闭阶段：调查结论只能由质量部出具，回复日期必须留档且是有效日期
  if (stage === 'reply' || stage === 'close') {
    if (String(payload['结论出具部门'] ?? '').trim() !== QA_DEPARTMENT) {
      return fail('COMPLAINT_CONCLUSION_OWNER', `调查结论须由${QA_DEPARTMENT}出具，当前结论出具部门不符，不能${STAGE_LABEL[stage]}`)
    }
    if (!isValidISODate(payload['回复日期'])) {
      return fail('COMPLAINT_REPLY_DATE_MISSING', `回复日期未填写或不是有效日期(YYYY-MM-DD)，不能${STAGE_LABEL[stage]}`)
    }
  }

  return { ok: true }
}

export type TransitionResult =
  | { ok: true; target: ComplaintStatus }
  | { ok: false; code: string; message: string }

/**
 * 状态流转守卫：只允许沿 待受理→调查中→已回复→已关闭 向前走一步。
 * 越级跳转、回退、对已关闭投诉再操作一律拦下。
 */
export function canTransition(from: string, action: string): TransitionResult {
  const reject = (code: string, message: string): TransitionResult => ({ ok: false, code, message })
  if (!(action in COMPLAINT_ACTION_TARGET)) {
    return reject('COMPLAINT_ACTION_UNKNOWN', `没有登记「${action}」这个投诉动作`)
  }
  const current = from as ComplaintStatus
  if (!COMPLAINT_STATUSES.includes(current)) {
    return reject('COMPLAINT_STATUS_UNKNOWN', `投诉状态「${from}」不在规定流转序列内`)
  }
  const expectedNext = NEXT_STATUS[current]
  if (expectedNext === null) {
    return reject('COMPLAINT_ALREADY_CLOSED', '投诉已关闭，不能再流转；重复复核只算一次')
  }
  const target = COMPLAINT_ACTION_TARGET[action as ComplaintAction]
  if (current === target) {
    return reject('COMPLAINT_REPEATED', `投诉已处于「${current}」，重复操作不生效，只算一次`)
  }
  if (target !== expectedNext) {
    return reject(
      'COMPLAINT_STATUS_SKIPPED',
      `状态只能按 ${COMPLAINT_STATUSES.join(' → ')} 依次流转，不能从「${current}」越级到「${target}」`,
    )
  }
  return { ok: true, target }
}

/** 当前状态唯一允许执行的下一步动作；已关闭返回 null。 */
export function nextActionFor(status: string): ComplaintAction | null {
  const current = status as ComplaintStatus
  const target = NEXT_STATUS[current]
  if (!target) {
    return null
  }
  const entry = Object.entries(COMPLAINT_ACTION_TARGET).find(([, to]) => to === target)
  return (entry?.[0] as ComplaintAction) ?? null
}
