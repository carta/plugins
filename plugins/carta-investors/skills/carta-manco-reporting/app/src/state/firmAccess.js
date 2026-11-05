// Which firms the signed-in user can open — the one place useLoadFirm.js (which firm to
// auto-load) and App.jsx (whether to offer "Switch firm" once one is loaded) each read this
// from, so the two can't drift on what "pinned to one firm" means. Mirrors carta-fund-modeling's
// own firm-access.js.

// The chooser's own data: who the signed-in user is and which firms they hold.
export async function fetchFirmAccess(signal) {
  const [me, firms] = await Promise.all([
    fetch("/api/me", { signal }).then((r) => r.json()).catch(() => ({ isStaff: null, userName: null })),
    fetch("/api/firms", { signal }).then((r) => r.json()).catch(() => []),
  ]);
  return { isStaff: me?.isStaff ?? null, userName: me?.userName ?? null, firms: Array.isArray(firms) ? firms : [] };
}

// The one firm a resolved, non-staff user may open with no extra click — and the only case
// where there is no firm to switch to. `isStaff` must be the literal false Carta returned,
// not merely falsy: null (unknown, or the lookup failed) must never pin.
export function pinnedFirm(isStaff, firms) {
  return isStaff === false && firms.length === 1 ? firms[0]?.slug ?? null : null;
}
