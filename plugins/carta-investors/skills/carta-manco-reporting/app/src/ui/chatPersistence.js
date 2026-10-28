// The chat state that has to outlive a page reload, kept in this tab's
// sessionStorage (gone when the tab closes). App reloads the page after a turn
// that edited a screen, so the edit shows (see App.jsx's onChatTurnEnd).
//
// A saved transcript is only as good as the server session behind it: serve.py
// keeps one `claude` subprocess per session id, and a reload rejoins that
// conversation only while serve.py still holds it. A page unloaded mid-turn
// (serve.py closes that session), a session evicted as the least recently used
// past MAX_CHAT_SESSIONS, or a serve.py restart leaves Claude with no memory of
// it. ChatPanel covers the first case by keeping no transcript saved while a
// turn is in flight; the other two show the old transcript to a fresh session.
//
// Every read and write is best-effort: storage can be full, disabled or throw
// in a locked-down browser, and chat must still work, just without surviving a
// reload.

const SESSION_ID_KEY = "manco-chat:session-id";
const OPEN_KEY = "manco-chat:open";
const transcriptKey = (sessionId) => "manco-chat:transcript:" + sessionId;

function read(key) {
  try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
}

function write(key, value) {
  try { window.sessionStorage.setItem(key, value); } catch (e) { /* best-effort */ }
}

function remove(key) {
  try { window.sessionStorage.removeItem(key); } catch (e) { /* best-effort */ }
}

function newSessionId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}

// This tab's chat session id: the stored one, or a new one stored for next time.
export function chatSessionId() {
  return read(SESSION_ID_KEY) || newChatSessionId();
}

// Starts this tab on a new session id, stored in place of the old one — what
// "New conversation" does, since serve.py binds a session to its first model.
export function newChatSessionId() {
  const id = newSessionId();
  write(SESSION_ID_KEY, id);
  return id;
}

export function loadChatOpen() {
  return read(OPEN_KEY) === "1";
}

export function saveChatOpen(open) {
  write(OPEN_KEY, open ? "1" : "0");
}

// { messages, model } as saved for this session, or null when nothing usable is.
export function loadTranscript(sessionId) {
  const raw = read(transcriptKey(sessionId));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return Array.isArray(saved.messages) ? saved : null;
  } catch (e) {
    return null;
  }
}

export function saveTranscript(sessionId, { messages, model }) {
  write(transcriptKey(sessionId), JSON.stringify({ messages, model }));
}

export function clearTranscript(sessionId) {
  remove(transcriptKey(sessionId));
}
