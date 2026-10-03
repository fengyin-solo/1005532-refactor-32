<template>
  <section class="page" data-module="complaint">
    <header class="page-head">
      <div>
        <h2>质量投诉管理</h2>
        <p class="page-desc">
          受理与关闭共用同一份统一规则（V{{ policyVersion }}）：编号查重、来源归口核对、内容完整、回复日期留档、状态按次序流转。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记投诉记录</button>
        <button class="btn" type="button" @click="exportRows">导出质量投诉清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
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

    <table class="data-table">
      <thead>
        <tr>
          <th>投诉编号</th>
          <th>投诉来源 / 归口</th>
          <th>涉及产品</th>
          <th>投诉内容</th>
          <th>调查结论（出具部门）</th>
          <th>处理措施</th>
          <th>回复日期 / 留档</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            {{ row['投诉编号'] ?? '—' }}
            <span v-if="!isRuleStamped(row)" class="tag tag-legacy" title="重构前的历史记录，统一规则不迁移老数据">历史数据</span>
          </td>
          <td>
            <div>{{ row['投诉来源'] ?? '—' }}</div>
            <div class="cell-sub">
              <span
                class="tag"
                :class="sourceCheck(row).consistent ? 'tag-ok' : 'tag-bad'"
                :title="sourceCheck(row).message"
              >
                来源核对：{{ sourceCheck(row).consistent ? '一致' : '不一致' }}
              </span>
              <span class="tag tag-muted">归口：{{ ownerOfSource(String(row['投诉来源'] ?? '')) ?? '待核定' }}</span>
            </div>
          </td>
          <td>{{ row['涉及产品'] ?? '—' }}</td>
          <td class="cell-content">{{ row['投诉内容'] ?? '—' }}</td>
          <td>
            <div class="cell-content">{{ row['调查结论'] || '—' }}</div>
            <div class="cell-sub">
              <span class="tag" :class="row['结论部门'] === conclusionOwner ? 'tag-ok' : 'tag-muted'">
                {{ row['结论部门'] ? `结论部门：${row['结论部门']}` : '结论部门：待出具' }}
              </span>
            </div>
          </td>
          <td class="cell-content">{{ row['处理措施'] || '—' }}</td>
          <td>
            <div>{{ row['回复日期'] || '—' }}</div>
            <div v-if="row['回复留档时间']" class="cell-sub">留档 {{ row['回复留档时间'] }}</div>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="nextAction(row.status) === '受理投诉'"
              class="link"
              type="button"
              @click="runDirect('受理投诉', row)"
            >
              受理投诉
            </button>
            <button
              v-if="nextAction(row.status) === '回复投诉'"
              class="link"
              type="button"
              @click="openReply(row)"
            >
              回复投诉
            </button>
            <button
              v-if="nextAction(row.status) === '关闭投诉'"
              class="link"
              type="button"
              @click="openClose(row)"
            >
              关闭投诉
            </button>
            <span v-if="!nextAction(row.status)" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">暂无质量投诉数据，可先登记投诉记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条质量投诉记录（同一投诉编号重复复核只计一次）</span>
      <span class="muted-text">统一受理/关闭口径：仅保留最新版 V{{ policyVersion }}，历史数据不迁移</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 受理入口一：登记弹窗。与行内「受理投诉」共用同一份受理校验。 -->
    <div v-if="dialog && dialog.kind === 'register'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>登记投诉记录（受理）</h3>
        <p class="modal-hint">投诉按来源归口接待；调查结论统一由{{ conclusionOwner }}出具（关闭时校验）。</p>
        <label class="form-item">
          <span>投诉编号 *</span>
          <input v-model="registerForm.投诉编号" placeholder="如 COMP-0101，4-32 位字母数字" />
        </label>
        <label class="form-item">
          <span>投诉来源 *</span>
          <select v-model="registerForm.投诉来源">
            <option value="" disabled>请选择归口来源</option>
            <option v-for="source in registeredSources" :key="source" :value="source">
              {{ source }}（归口：{{ ownerOfSource(source) }}）
            </option>
          </select>
        </label>
        <label class="form-item">
          <span>涉及产品</span>
          <input v-model="registerForm.涉及产品" placeholder="选填，最多 60 字" />
        </label>
        <label class="form-item">
          <span>投诉内容 *</span>
          <textarea v-model="registerForm.投诉内容" rows="3" maxlength="520" placeholder="5-500 字，内容不全或超极值将被挡回"></textarea>
        </label>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitRegister">提交受理资料</button>
        </div>
      </div>
    </div>

    <div v-if="dialog && dialog.kind === 'reply'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>回复投诉</h3>
        <p class="modal-hint">回复日期必须填写并留档，缺日期不能进入「已回复」。</p>
        <label class="form-item">
          <span>回复日期 *</span>
          <input v-model="replyDate" type="date" />
        </label>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitReply">确认回复并留档</button>
        </div>
      </div>
    </div>

    <div v-if="dialog && dialog.kind === 'close'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>关闭投诉</h3>
        <p class="modal-hint">
          调查结论须由<strong>{{ conclusionOwner }}</strong>出具；关闭后结论同步为人员培训待办（同一投诉重复复核只同步一次）。
        </p>
        <label class="form-item">
          <span>调查结论 *</span>
          <textarea v-model="closeForm.调查结论" rows="3" maxlength="520" placeholder="5-500 字，由质量部出具"></textarea>
        </label>
        <label class="form-item">
          <span>处理措施</span>
          <textarea v-model="closeForm.处理措施" rows="2" maxlength="520"></textarea>
        </label>
        <label class="form-item">
          <span>结论出具部门</span>
          <input :value="conclusionOwner" disabled />
        </label>
        <label class="form-item">
          <span>回复日期（留档）</span>
          <input :value="dialog.row['回复日期'] || '尚未回复'" disabled />
        </label>
        <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitClose">确认关闭并同步培训待办</button>
        </div>
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
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  COMPLAINT_POLICY_VERSION,
  CONCLUSION_OWNER,
  allowedAction,
  complaintStats,
  crossCheckSource,
  isRuleStamped,
  listRegisteredSources,
  ownerOfSource,
  registerComplaint,
} from '@/domain/complaint/service'
import type { ComplaintIntakeDraft } from '@/domain/complaint/policy'

const meta = moduleMeta('complaint')
const policyVersion = COMPLAINT_POLICY_VERSION
const conclusionOwner = CONCLUSION_OWNER
const registeredSources = listRegisteredSources()
const filterFields = ['投诉编号', '投诉来源', '涉及产品']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

type DialogState =
  | { kind: 'register' }
  | { kind: 'reply'; id: number }
  | { kind: 'close'; id: number; row: EntryRow }
  | null

const dialog = ref<DialogState>(null)
const dialogError = ref('')
const registerForm = ref<ComplaintIntakeDraft>({
  投诉编号: '',
  投诉来源: '',
  涉及产品: '',
  投诉内容: '',
})
const replyDate = ref(todayISO())
const closeForm = ref({ 调查结论: '', 处理措施: '' })

const statsCards = computed(() => {
  const stats = complaintStats(rows.value)
  return [
    { label: '待受理投诉', value: stats.pendingAccept },
    { label: '调查中投诉', value: stats.investigating },
    { label: '本月关闭数', value: stats.closedThisMonth },
  ]
})

const statusSummary = computed(() =>
  ['待受理', '调查中', '已回复', '已关闭'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function sourceCheck(row: EntryRow) {
  return crossCheckSource(String(row['投诉来源'] ?? ''))
}

function nextAction(status: string): string | null {
  return allowedAction(status)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function closeDialog() {
  dialog.value = null
  dialogError.value = ''
}

function openRegister() {
  registerForm.value = { 投诉编号: '', 投诉来源: '', 涉及产品: '', 投诉内容: '' }
  dialogError.value = ''
  dialog.value = { kind: 'register' }
}

function openReply(row: EntryRow) {
  replyDate.value = todayISO()
  dialogError.value = ''
  dialog.value = { kind: 'reply', id: Number(row.id) }
}

function openClose(row: EntryRow) {
  closeForm.value = {
    调查结论: String(row['调查结论'] ?? ''),
    处理措施: String(row['处理措施'] ?? ''),
  }
  dialogError.value = ''
  dialog.value = { kind: 'close', id: Number(row.id), row }
}

function submitRegister() {
  dialogError.value = ''
  const result = registerComplaint(registerForm.value)
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialog()
  errorMessage.value = ''
  reload()
}

function submitReply() {
  if (dialog.value?.kind !== 'reply') {
    return
  }
  const result = applyAction(meta.key, dialog.value.id, '回复投诉', { 回复日期: replyDate.value })
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialog()
  reload()
}

function submitClose() {
  if (dialog.value?.kind !== 'close') {
    return
  }
  const result = applyAction(meta.key, dialog.value.id, '关闭投诉', { ...closeForm.value })
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialog()
  reload()
}

function runDirect(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
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
