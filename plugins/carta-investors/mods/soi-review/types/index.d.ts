/** One booked position at the period end: a key per fund and asset group, its company, its value. */
export type Position = [key: string, company: string, value: string | number]

/** What carta-mcp's `fa__get__soi-review-state` read returns for one SOI review. */
export type SoiReviewState = {
  soi_report_id: string
  report_label: string
  period: { start: string; end: string }
  status: 'waiting-on-you' | 'with-fund-admin' | 'approved' | 'closed' | 'open'
  status_label: string
  status_message: string | null
  /** `currency` is null when the report's funds differ in currency; there is then no total. */
  fair_value: { current: string | number | null; prior?: string | number | null; change?: string | number | null; currency: string | null }
  positions: Position[]
  companion_url: string | null
}

/** The SOI review this session opened, and the last read of it. */
export type SoiReview = {
  server: string
  firmUuid: string
  soiReportId: string
  state: SoiReviewState | null
  /** The session's first read's positions, which "changed this session" counts against. */
  first: Position[] | null
  changedCompanies: string[]
  readAt: number | null
  failedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'carta-investors': { soiReview: SoiReview | null }
  }
}
