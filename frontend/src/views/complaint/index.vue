<template>
  <section class="page" data-module="complaint">
    <header class="page-head">
      <div>
        <h2>质量投诉管理</h2>
        <p class="page-desc">
          登记、受理、回复、关闭共用一套统一规则：编号查重、来源与内容齐全、来源归口核对、
          质量部出结论、回复日期留档；状态按次序流转，越级操作一律拦下。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openModal('register')">登记投诉记录</button>
        <button class="btn" type="button" @click="exportRows">导出质量投诉清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>来源归口</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
            <td>{{ ownerOf(row) }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="nextActionFor(String(row.status))"
                class="link"
                type="button"
                @click="openModal(stageOfAction(nextActionFor(String(row.status))), row)"
              >
                {{ nextActionFor(String(row.status)) }}
              </button>
              <span v-else class="muted-text">已关闭，不可再操作</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无质量投诉数据，可先登记投诉记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条质量投诉记录 ｜ 统一受理口径：{{ ruleVersion.version }}
        （{{ ruleVersion.publishedAt }} 生效，仅最新一版有效，历史版本全部归档留痕）
      </span>
      <span v-if="notice" class="ok-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="mode" class="modal-mask" @click.self="closeModal">
      <div class="modal-card" role="dialog" aria-modal="true">
        <header class="modal-head">
          <h3>{{ modalTitle }}</h3>
          <button class="btn ghost" type="button" @click="closeModal">关闭</button>
        </header>

        <p class="modal-note">
          本入口按统一规则 {{ ruleVersion.version }} 校验，受理/回复/关闭结论一致，不另开口径。
        </p>

        <form class="modal-form" @submit.prevent="submitModal">
          <fieldset v-if="mode === 'register' || mode === 'accept'" class="form-group">
            <label>
              <span>投诉编号<i>*</i></span>
              <input v-model="form['投诉编号']" required :readonly="mode === 'accept'" />
            </label>
            <label>
              <span>投诉来源<i>*</i>（按来源归口）</span>
              <select v-model="form['投诉来源']" required>
                <option value="" disabled>请选择来源登记表内的来源</option>
                <option v-for="source in sources" :key="source.code" :value="source.name">
                  {{ source.name }}（归口：{{ source.owner }}）
                </option>
              </select>
            </label>
            <label>
              <span>涉及产品</span>
              <input v-model="form['涉及产品']" />
            </label>
            <label class="full-row">
              <span>投诉内容<i>*</i></span>
              <textarea v-model="form['投诉内容']" required rows="3"></textarea>
            </label>
          </fieldset>

          <fieldset v-if="mode === 'reply' || mode === 'close'" class="form-group">
            <dl class="readonly-summary">
              <div><dt>投诉编号</dt><dd>{{ form['投诉编号'] }}</dd></div>
              <div><dt>投诉来源 / 归口</dt><dd>{{ form['投诉来源'] }} / {{ form['_归口'] }}</dd></div>
              <div><dt>涉及产品</dt><dd>{{ form['涉及产品'] || '—' }}</dd></div>
              <div><dt>投诉内容</dt><dd>{{ form['投诉内容'] }}</dd></div>
            </dl>
            <label class="full-row">
              <span>调查结论<i>*</i>（质量部出具）</span>
              <textarea v-model="form['调查结论']" required rows="3"></textarea>
            </label>
            <label>
              <span>结论出具部门<i>*</i></span>
              <input v-model="form['结论出具部门']" required readonly />
            </label>
            <label v-if="mode === 'close'">
              <span>处理措施<i>*</i></span>
              <textarea v-model="form['处理措施']" required rows="2"></textarea>
            </label>
            <label>
              <span>回复日期<i>*</i>（留档）</span>
              <input v-model="form['回复日期']" type="date" required />
            </label>
          </fieldset>

          <p v-if="modalError" class="error-text modal-error">{{ modalError }}</p>

          <footer class="modal-actions">
            <button class="btn ghost" type="button" @click="closeModal">取消</button>
            <button class="btn primary" type="submit">{{ submitLabel }}</button>
          </footer>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  activeComplaintRuleVersion,
  COMPLAINT_SOURCES,
  isSameMonth,
  nextActionFor,
  reconcileSource,
  todayISO,
  type ComplaintAction,
} from '@/domain/complaint/rules'
import { registerComplaint, runComplaintAction } from '@/domain/complaint/service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('complaint')
const columns = ['投诉编号', '投诉来源', '涉及产品', '投诉内容', '调查结论', '结论出具部门', '处理措施', '回复日期', '关闭日期']
const statuses = ['待受理', '调查中', '已回复', '已关闭']
const sources = COMPLAINT_SOURCES
const ruleVersion = activeComplaintRuleVersion()

type Mode = 'register' | 'accept' | 'reply' | 'close'
const ACTION_OF_MODE: Record<Mode, ComplaintAction | null> = {
  register: null,
  accept: '受理投诉',
  reply: '回复投诉',
  close: '关闭投诉',
}
const MODE_OF_ACTION: Record<ComplaintAction, Exclude<Mode, 'register'>> = {
  受理投诉: 'accept',
  回复投诉: 'reply',
  关闭投诉: 'close',
}
const MODE_TITLE: Record<Mode, string> = {
  register: '登记投诉记录',
  accept: '受理投诉',
  reply: '回复投诉（质量部出具调查结论）',
  close: '关闭投诉（核对结论、措施与回复日期）',
}
const MODE_SUBMIT: Record<Mode, string> = {
  register: '确认登记',
  accept: '确认受理',
  reply: '确认回复并留档',
  close: '确认关闭并同步培训待办',
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const mode = ref<Mode | null>(null)
const editingId = ref<number | null>(null)
const form = ref<Record<string, string>>({})
const modalError = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待受理投诉', value: rows.value.filter((row) => row.status === '待受理').length },
  { label: '调查中投诉', value: rows.value.filter((row) => row.status === '调查中').length },
  {
    label: '本月关闭数',
    value: rows.value.filter((row) => isSameMonth(row['关闭日期'])).length,
  },
])

const modalTitle = computed(() => (mode.value ? MODE_TITLE[mode.value] : ''))
const submitLabel = computed(() => (mode.value ? MODE_SUBMIT[mode.value] : ''))

function stageOfAction(action: ComplaintAction | null): Mode {
  return action ? MODE_OF_ACTION[action] : 'register'
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function ownerOf(row: EntryRow): string {
  const result = reconcileSource(row['投诉来源'])
  return result.consistent ? result.canonical.owner : '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function closeModal() {
  mode.value = null
  editingId.value = null
  form.value = {}
  modalError.value = ''
}

function openModal(nextMode: Mode, row?: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  modalError.value = ''
  mode.value = nextMode
  form.value = {}

  if (nextMode === 'register') {
    editingId.value = null
    form.value = {
      投诉编号: '',
      投诉来源: '',
      涉及产品: '',
      投诉内容: '',
    }
    return
  }

  if (!row) {
    modalError.value = '未选择投诉记录'
    return
  }
  editingId.value = Number(row.id)
  const cell = (field: string) => (typeof row[field] === 'string' ? String(row[field]) : '')
  const sourceMatched = reconcileSource(row['投诉来源'])

  if (nextMode === 'accept') {
    // 老记录上的来源若与登记表对不上，受理时按登记表重新核定归口，不改动已留档的其他内容。
    form.value = {
      投诉编号: cell('投诉编号'),
      投诉来源: sourceMatched.consistent ? sourceMatched.canonical.name : '',
      涉及产品: cell('涉及产品'),
      投诉内容: cell('投诉内容'),
    }
    return
  }

  form.value = {
    投诉编号: cell('投诉编号'),
    投诉来源: sourceMatched.consistent ? sourceMatched.canonical.name : cell('投诉来源'),
    _归口: sourceMatched.consistent ? sourceMatched.canonical.owner : '待核定',
    涉及产品: cell('涉及产品'),
    投诉内容: cell('投诉内容'),
    调查结论: cell('调查结论'),
    结论出具部门: cell('结论出具部门') || '质量部',
    处理措施: cell('处理措施'),
    回复日期: cell('回复日期') || todayISO(),
  }
}

function submitModal() {
  if (!mode.value) {
    return
  }
  const currentMode = mode.value
  const action = ACTION_OF_MODE[currentMode]

  const result = action
    ? runComplaintAction(Number(editingId.value), action, form.value)
    : registerComplaint(form.value)

  if (!result.ok) {
    modalError.value = result.message
    return
  }
  closeModal()
  notice.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '质量投诉列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.table-scroll {
  overflow-x: auto;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.ok-text {
  color: #067647;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 640px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: 0 10px 30px rgba(16, 24, 40, 0.2);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-note {
  margin: 8px 0;
  font-size: 12px;
  color: var(--muted);
}
.form-group {
  border: none;
  padding: 0;
  margin: 0 0 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}
.form-group label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.form-group label.full-row {
  grid-column: 1 / -1;
}
.form-group input,
.form-group select,
.form-group textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
}
.form-group i {
  color: #b42318;
  font-style: normal;
}
.readonly-summary {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin: 0;
  padding: 8px 10px;
  background: #f6f8fb;
  border-radius: 6px;
  font-size: 12px;
}
.readonly-summary div {
  display: flex;
  gap: 8px;
}
.readonly-summary dt {
  color: var(--muted);
  white-space: nowrap;
}
.readonly-summary dd {
  margin: 0;
}
.modal-error {
  margin: 4px 0 8px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
