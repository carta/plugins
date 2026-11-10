// ── Connection states: what Home shows when Carta data can't load ──
// Two treatments, split by how much of Home is affected:
//   · a card note — one card's data failed, or a Carta tool that card needs is off. Amber, never
//     red: a card that couldn't load isn't a destructive failure, and red read as "broken".
//   · the reconnect panel — the whole connection is gone (signed out, not added). It replaces the
//     sections that read Carta data; prompts, skills and Plugin news stay, so Home is never empty.

// The reconnect panel's words per code: signed out means reconnect; never added means add it.
const ADD_CONNECTOR = {
  heading: "Connect Carta to view dashboards",
  body: "Carta isn't connected in Claude. Add it to load your fund performance and portfolio dashboards.",
  how: "In Claude, go to Settings → Connectors and add the Carta connector.",
};
const RECONNECT_COPY = {
  needs_reauth: {
    heading: "Reconnect to view dashboards",
    body: "We lost connection to your Carta account. Reconnect to load your fund performance and portfolio dashboards.",
    how: "In Claude, go to Settings → Connectors → Carta and select Reconnect.",
  },
  server_not_connected: ADD_CONNECTOR,
  no_connector: ADD_CONNECTOR,
};

// Connector codes that mean every Carta call on the page will fail the same way.
const CONNECTION_LOST_CODES = new Set(Object.keys(RECONNECT_COPY));
// Codes where the host turned off a Carta tool the page uses; the connection itself works.
const TOOL_OFF_CODES = new Set(["not_in_manifest", "not_granted", "consent_required", "capability_disabled"]);

// One place for each card's subject, so every cause reads the same on every card.
const CARD_SUBJECT = { soi: "your portfolio", perf: "fund performance", lp: "your investors" };

const CHECK_AGAIN = { label: "Check again", event: "CheckAgain" };
const TRY_AGAIN = { label: "Try again", event: "TryAgain" };

function cardNoteFor(card, code) {
  const subject = CARD_SUBJECT[card];
  if (TOOL_OFF_CODES.has(code)) {
    return { text: `A Carta tool this card uses is turned off in Claude. Turn it on in Settings → Connectors → Carta.`, action: CHECK_AGAIN };
  }
  if (code === "blocked_by_policy") return { text: `Your organization's Claude settings block Carta, so ${subject} can't load.`, action: null };
  if (code === "approval_required") return { text: `Your organization needs to approve Carta before ${subject} can load.`, action: null };
  if (code === "no_firm") return { text: `There's no active firm in your Carta account, so ${subject} can't load.`, action: CHECK_AGAIN };
  if (code === "selection_required") return { text: `Choose which Carta connector to use in Settings → Connectors.`, action: CHECK_AGAIN };
  const slow = code === "server_unavailable" || code === "read_timeout";
  return { text: `Couldn't load ${subject}. ${slow ? "Carta took too long to answer." : "Something went wrong reaching Carta."}`, action: TRY_AGAIN };
}

// Returns the note's markup. Every string comes from cardNoteFor, never from data, so it's
// inserted as is. The button reloads Home, which re-runs every card's load.
function cardNoteHtml(card, code) {
  const note = cardNoteFor(card, code);
  const button = note.action
    ? `<button type="button" class="card-note-action" data-card="${card}" data-event="${note.action.event}" onclick="cardNoteRetry(this)">${note.action.label}</button>`
    : "";
  return `<div class="card-note" role="status"><span class="card-note-dot" aria-hidden="true"></span><span>${note.text} ${button}</span></div>`;
}

function cardNoteRetry(btn) {
  trackHome("click", `CartaHome.CardNote.${btn.dataset.event}`, { value: btn.dataset.card });
  reloadHome();
}

function reloadHome() { window.location.reload(); }

let _reconnectShown = false;
// Replaces the Carta-data sections with one panel. Safe to call from every card's failure path;
// the first code sets the words. Only called with a CONNECTION_LOST_CODES code.
function showReconnectPanel(code) {
  if (_reconnectShown) return;
  const pane = document.getElementById("tab-recommended");
  if (!pane) return;
  _reconnectShown = true;
  const copy = RECONNECT_COPY[code];
  for (const id of ["ca-section-v2", "dashboards-section"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  const panel = document.createElement("section");
  panel.id = "reconnect-panel";
  panel.className = "reconnect-panel";
  panel.setAttribute("aria-labelledby", "reconnect-title");
  panel.innerHTML = `
    <div class="reconnect-ghost" aria-hidden="true"><div></div><div></div></div>
    <div class="reconnect-card">
      <h2 id="reconnect-title">${copy.heading}</h2>
      <p>${copy.body}</p>
      <button type="button" class="reconnect-btn" onclick="reconnectCheckAgain()">Check again</button>
      <p class="reconnect-how">${copy.how}</p>
    </div>`;
  pane.insertBefore(panel, pane.firstChild);
  trackHome("render", "CartaHome.Reconnect.Shown");
}

function reconnectCheckAgain() {
  trackHome("click", "CartaHome.Reconnect.CheckAgain");
  reloadHome();
}

// The single entry for a connector-level failure: the whole page, or this card's note.
function renderConnectionFailure(card, code) {
  if (CONNECTION_LOST_CODES.has(code)) { showReconnectPanel(code); return null; }
  return cardNoteHtml(card, code);
}
