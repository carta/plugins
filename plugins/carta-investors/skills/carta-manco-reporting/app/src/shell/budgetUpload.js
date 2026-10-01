// Client side of /api/budget-upload. The Worker does the checking; these return its
// message so the user sees why a file was refused.

const URL_PATH = "/api/budget-upload";

// null when the server has no upload route (the local server answers 404), so the
// control stays hidden there.
export async function fetchUploadState() {
  try {
    const res = await fetch(URL_PATH);
    if (!res.ok) return null;
    return { meta: await res.json() };
  } catch {
    return null;
  }
}

async function outcome(res) {
  if (res.ok) return { ok: true };
  let message = `Upload failed (${res.status}).`;
  try { message = (await res.json()).message || message; } catch { /* keep the status */ }
  return { ok: false, message };
}

// Runs a request and turns a throw (server unreachable, file unreadable) into a refusal,
// so the caller always gets a result to show.
export async function attempt(action) {
  try {
    return await action();
  } catch {
    return { ok: false, message: "Request failed. Please try again." };
  }
}

export async function uploadBudget(file) {
  const res = await fetch(URL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await file.text(),
  });
  return outcome(res);
}

export async function removeBudget() {
  return outcome(await fetch(URL_PATH, { method: "DELETE" }));
}

// One line for the sidebar. `upload` is snapshot.budgetUpload.
export function describeUpload(upload) {
  if (!upload) return null;
  const when = String(upload.uploadedAt || "").slice(0, 10);
  const who = upload.uploadedBy ? ` by ${upload.uploadedBy}` : "";
  if (upload.status === "currency_mismatch") {
    return { warn: true, text: `Uploaded budget not shown: it is in ${upload.currency}, this firm reports in ${upload.snapshotCurrency}.` };
  }
  return { warn: false, text: `Workbook budget${upload.workbook ? ` (${upload.workbook})` : ""}, uploaded ${when}${who}. Variance chart as of ${upload.asOf}.` };
}
