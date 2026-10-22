import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SoiReview, SoiReviewState } from '../types'

const soiReview = atom({ plugin: 'carta-investors', key: 'soiReview' } as const, null)

// The server's name differs per install (a UUID, `claude_ai_Carta`, `carta-local`), so it is
// read off the tool name rather than listed.
const VIEW_TOOL = /^mcp__(.+)__view_remote$/
export const VIEW_APP = 'updateInvestmentsMcpApps'
export const READ_COMMAND = 'fa__get__soi-review-state'
export const TICK_MS = 5000
const DONE = new Set(['approved', 'closed'])

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
  return { server, firmUuid: review.firm_uuid, soiReportId: review.soi_report_id, state: null }
}

// `SOI Q3 2026 · Waiting on you`; the quarter is the period end's.
function statusLine(state: SoiReviewState): string {
  const quarter = Math.ceil(Number(state.period.end.slice(5, 7)) / 3)
  return `SOI Q${quarter} ${state.period.end.slice(0, 4)} · ${state.status_label}`
}

async function readState($: EngineInterface, review: SoiReview): Promise<SoiReviewState | null> {
  try {
    const result = await $.mcp.call(review.server, 'read_tool', {
      name: READ_COMMAND,
      arguments: { firm_uuid: review.firmUuid, soi_report_id: review.soiReportId, include_baseline: true },
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

async function poll($: EngineInterface) {
  const review = await read($, soiReview)
  if (review === null || DONE.has(review.state?.status ?? '')) return
  const state = await readState($, review)
  if (state === null) return
  const isCurrent = (prev: SoiReview | null) => prev?.soiReportId === review.soiReportId && prev.server === review.server
  await update($, soiReview, prev => (prev !== null && isCurrent(prev) ? { ...prev, state } : prev))
  if (isCurrent(await read($, soiReview))) $.ui.status(statusLine(state))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(TICK_MS, () => poll($).catch(() => undefined))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const server = VIEW_TOOL.exec(e.tool)?.[1]
    const review = server !== undefined && ran.text !== undefined ? reviewFrom(server, ran.text) : null
    if (review !== null) {
      await update($, soiReview, () => review)
      $.ui.status(undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))
}
