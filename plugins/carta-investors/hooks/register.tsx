import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SoiReview, SoiReviewState } from '../types'
import { changedCompanies, companyValue } from './changes'

const soiReview = atom({ plugin: 'carta-investors', key: 'soiReview' } as const, null)

// The server's name differs per install (a UUID, `claude_ai_Carta`, `carta-local`), so it is
// read off the tool name rather than listed.
const VIEW_TOOL = /^mcp__(.+)__view_remote$/
export const VIEW_APP = 'updateInvestmentsMcpApps'
export const READ_COMMAND = 'fa__get__soi-review-state'
export const TICK_MS = 5000
export const SLOW_MS = 15000
export const IDLE_MS = 30 * 60 * 1000
export const STALE_MS = 60 * 1000
const DONE = new Set(['approved', 'closed'])
// More companies than this in one read collapse into a single toast.
export const TOAST_LIMIT = 3

// An MCP result's JSON: structured content, else its first text block, unwrapped from the
// `{ result }` envelope FastMCP puts around a tool's return value.
function payload(json: unknown): any {
  const value = typeof json === 'string' ? JSON.parse(json) : json
  const inner = value?.result
  return inner === undefined ? value : typeof inner === 'string' ? JSON.parse(inner) : inner
}

function reviewFrom(server: string, text: string): SoiReview | null {
  const view = payload(text)
  const review = view?.args?.review
  if (view?.resource?.moduleFederation?.remoteName !== VIEW_APP || !review?.soi_report_id || !review.firm_uuid) return null
  return { server, firmUuid: review.firm_uuid, soiReportId: review.soi_report_id, state: null, first: null, changedCompanies: [], readAt: null, failedAt: null }
}

// Two records are the same SOI review when they name the same report on the same server.
const isSameReview = (a: SoiReview | null, b: SoiReview) => a?.soiReportId === b.soiReportId && a.server === b.server

// `SOI Q3 2026 · Waiting on you`; the quarter is the period end's.
function statusLine(state: SoiReviewState): string {
  const quarter = Math.ceil(Number(state.period.end.slice(5, 7)) / 3)
  return `SOI Q${quarter} ${state.period.end.slice(0, 4)} · ${state.status_label}`
}

async function readState($: EngineInterface, review: SoiReview): Promise<SoiReviewState | null> {
  try {
    const result = await $.mcp.call(review.server, 'read_tool', {
      name: READ_COMMAND,
      arguments: { firm_uuid: review.firmUuid, soi_report_id: review.soiReportId, include_baseline: review.state === null },
      // Marks the poll as the plugin's own, so carta-mcp does not count it as Claude's usage.
      _instrumentation_v2: { from_hook: true },
    })
    if (result.isError) return null
    const state = payload(result.structuredContent ?? result.content.find(block => block.type === 'text')?.text)
    return typeof state?.status === 'string' ? state : null
  } catch {
    return null
  }
}

function companyToast(company: string, before: SoiReviewState, after: SoiReviewState): string {
  const { currency } = after.fair_value
  if (currency === null) return `${company} updated`
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
  const was = money.format(companyValue(before.positions, company))
  return `${company} updated: ${was} → ${money.format(companyValue(after.positions, company))}`
}

// One toast per company changed since the last read, and one for a status move in the
// read command's own words. The session's first read has nothing before it to compare.
function toastChanges($: EngineInterface, before: SoiReviewState, after: SoiReviewState) {
  if (after.status !== before.status) $.ui.toast(after.status_message ?? after.status_label)
  const companies = changedCompanies(before.positions, after.positions)
  if (companies.length > TOAST_LIMIT) $.ui.toast(`${companies.length} companies updated`)
  else for (const company of companies) $.ui.toast(companyToast(company, before, after))
}

// Reset by a reload, which only means the next tick reads at once. The cadence counts
// ticks rather than comparing clock times, so timer jitter never pushes a read a tick late.
let ticksSinceRead = Infinity
let lastPrompt = 0
// One poll at a time: a read slower than a tick would otherwise overlap the next one, and
// the two could land out of order. A poll holding the lock for STALE_MS, whatever step it is
// stuck on, gives it to a fresh poll: at most one takeover per STALE_MS, counted from when the
// holder took it. Only the newest poll (pollGen) writes or releases the lock.
let isPolling = false
let ticksHeld = 0
let pollGen = 0

async function poll($: EngineInterface) {
  ticksSinceRead += 1
  if (isPolling && ++ticksHeld * TICK_MS < STALE_MS) return
  ticksHeld = 0
  const gen = ++pollGen
  isPolling = true
  try {
    const review = await read($, soiReview)
    // Opening the view forces one read (ticksSinceRead is Infinity), even of a review held as done.
    const isForced = ticksSinceRead === Infinity
    if (review === null || (DONE.has(review.state?.status ?? '') && !isForced)) return
    const now = await $.clock.now()
    const every = review.state?.status === 'waiting-on-you' ? TICK_MS : SLOW_MS
    if (now - lastPrompt > IDLE_MS || ticksSinceRead * TICK_MS < every) return
    ticksSinceRead = 0

    const state = await readState($, review)
    if (gen !== pollGen) return
    await update($, soiReview, prev => {
      if (prev === null || !isSameReview(prev, review)) return prev
      if (state === null) return { ...prev, failedAt: now }
      const first = prev.first ?? state.positions
      return { ...prev, state, first, changedCompanies: changedCompanies(first, state.positions), readAt: now, failedAt: null }
    })
    if (state === null || gen !== pollGen || !isSameReview(await read($, soiReview), review)) return
    $.ui.status(statusLine(state))
    if (review.state !== null) toastChanges($, review.state, state)
  } finally {
    if (gen === pollGen) isPolling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastPrompt = await $.clock.now()
    $.clock.every(TICK_MS, () => poll($).catch(() => undefined))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    lastPrompt = await $.clock.now()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const server = VIEW_TOOL.exec(e.tool)?.[1]
    const review = server !== undefined && ran.text !== undefined ? reviewFrom(server, ran.text) : null
    if (review !== null) {
      // Claude reopens the view on the same review after booking from the chat: keep its
      // state and the session's changes, so that booking is still compared and counted.
      if (!isSameReview(await read($, soiReview), review)) {
        await update($, soiReview, () => review)
        $.ui.status(undefined)
      }
      ticksSinceRead = Infinity // read it on the next tick
    }
    return ran
  }).catch(($, e, next) => next(e))
}
