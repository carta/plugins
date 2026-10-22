/** What carta-mcp's `fa__get__soi-review-state` read returns for one SOI review. */
export type SoiReviewState = {
  soi_report_id: string
  report_label: string
  period: { start: string; end: string }
  status: 'waiting-on-you' | 'with-fund-admin' | 'approved' | 'closed' | 'open'
  status_label: string
  status_message: string | null
  companion_url: string | null
}

/** The SOI review this session opened, and the last read of it. */
export type SoiReview = {
  server: string
  firmUuid: string
  soiReportId: string
  state: SoiReviewState | null
}

declare module 'claude-code' {
  interface PluginState {
    'carta-investors': { soiReview: SoiReview | null }
  }
}
