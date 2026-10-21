/** The `?firm=` suffix an app request names its firm with, or "" when there is none. */
export const firmQuery = (firm) => (firm ? `?firm=${encodeURIComponent(firm)}` : "");
