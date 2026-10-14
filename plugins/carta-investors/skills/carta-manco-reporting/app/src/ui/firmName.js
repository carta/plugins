// The firm's name as the dashboard shows it: without a trailing legal suffix
// ("Acme Ventures, LLC" → "Acme Ventures"). Missing or non-string names come
// back as a string, so callers can render or slugify the result directly.
export function displayFirmName(firmName) {
  return String(firmName || "").replace(/,?\s+(LLC|LP|L\.P\.|L\.L\.C\.|Inc\.?|Ltd\.?|Corp\.?)$/i, "");
}
