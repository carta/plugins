import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { SoiReview, SoiReviewState } from './types'
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
const PILL: Record<string, Color> = { 'waiting-on-you': 'suggestion', 'with-fund-admin': 'merged', approved: 'success' }
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

// `$1.4M · +$410K (+41.4%)` against the prior period end kept from the session's first read.
function fairValue({ current, prior, currency }: SoiReviewState['fair_value']): string {
  if (currency === null) return 'Multi-currency'
  const money = (n: number, signDisplay: 'auto' | 'exceptZero' = 'auto') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1, signDisplay }).format(n)
  if (prior == null) return money(Number(current))
  const change = Number(current) - Number(prior)
  const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
  return `${money(Number(current))} · ${money(change, 'exceptZero')}${Number(prior) ? ` (${percent.format(change / Number(prior))})` : ''}`
}

function clockTime(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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
      // Reads after the first carry no prior period end (include_baseline=false); keep the first's.
      const fair_value = { ...state.fair_value, prior: state.fair_value.prior ?? prev.state?.fair_value.prior }
      return { ...prev, state: { ...state, fair_value }, first, changedCompanies: changedCompanies(first, state.positions), readAt: now, failedAt: null }
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
    await $.command.register({ name: 'soi-review', description: "Reopen this session's SOI review companion page" })
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

  on('command.run', { command: 'soi-review' }, async $ => {
    const state = (await read($, soiReview))?.state
    if (!state) return { text: 'No SOI review in this session yet.' }
    if (!state.companion_url) return { text: "The companion page isn't available for this review." }
    // Only the desktop app has a browser beside the chat; anywhere else the link is the answer.
    if (!(await $.session.surfaces()).includes('desktop')) return { text: `SOI review companion page: ${state.companion_url}` }
    // A prompt rather than a browser call: the browser tools are Claude's and load through ToolSearch.
    // Queued from a timer, as a command.run hook may not submit while it holds the turn.
    const text = `Open ${state.companion_url} in your built-in browser beside the chat.`
    $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
    return { text: `Opening the SOI review companion page: ${state.companion_url}` }
  })

  // Desktop only: the terminal has the status line. Drawn under whatever else is in the
  // band (carta-cli's environment row, which keeps its own next(e) too), so both show.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const review = await read($, soiReview)
    const state = review?.state
    if (e.surface !== 'desktop' || e.props.hasSurvey || !review || !state) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const changed = review.changedCompanies.length
    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          <Text bold>{state.report_label}</Text>
          <Text color="inverseText" backgroundColor={PILL[state.status] ?? 'inactive'}> {state.status_label} </Text>
          <Text dimColor>{fairValue(state.fair_value)}</Text>
          {changed > 0 && <Text color="success">● {changed} {changed === 1 ? 'company' : 'companies'} changed this session</Text>}
          {review.failedAt === null
            ? <Text dimColor>updated {clockTime(review.readAt)}</Text>
            : <Text color="warning">⚠ last updated {clockTime(review.readAt)}</Text>}
        </Box>
      </Box>
    )
  })
}
