// Client side of /api/budget-upload. The Worker does the checking; these return its
// message so the user sees why a file was refused.
import { withFirmParam } from "../state/firmParam.js";

const URL_PATH = "/api/budget-upload";
// The stored bundle as a file download (the Worker sets Content-Disposition). A function,
// not a module-load-time constant: the page's ?firm= can change (a chooser pick, a new deep
// link) after this module first loads, and the link must always name the firm the page is
// showing, not whichever one was in the URL on first import.
export const budgetDownloadUrl = () => withFirmParam(`${URL_PATH}?download=1`);

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
  const res = await fetch(withFirmParam(URL_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await file.text(),
  });
  return outcome(res);
}

export async function removeBudget() {
  return outcome(await fetch(withFirmParam(URL_PATH), { method: "DELETE" }));
}

// One line for the sidebar. `upload` is snapshot.budgetUpload.
export function describeUpload(upload) {
  if (!upload) return null;
  const when = String(upload.uploadedAt || "").slice(0, 10);
  const who = upload.uploadedBy ? ` by ${upload.uploadedBy}` : "";
  if (upload.status === "currency_mismatch") {
    return { warn: true, text: `Uploaded budget not shown: it is in ${upload.currency}, this firm reports in ${upload.snapshotCurrency}.` };
  }
  if (upload.status === "all_hidden") {
    return { warn: true, text: "Uploaded budget not shown: you have hidden all of its reports." };
  }
  return { warn: false, text: `Workbook budget${upload.workbook ? ` (${upload.workbook})` : ""}, uploaded ${when}${who}. Variance chart as of ${upload.asOf}.` };
}
