// Ask box — one textfield, mounted inside whichever tab the user is looking at.
//
// It sits with that surface's own controls rather than in a bar pinned to the
// window, because it acts ON that surface: a bottom bar reads as chrome, while the
// same box under the Benchmarks filters reads as "change this". It therefore
// carries NO horizontal styling of its own — every view already supplies the 24px
// gutter, so one component lines up across all three.
//
// The point is to keep a small change ("add an interpolated P60") in the app
// instead of sending the user back to their Claude session for it. So this is
// deliberately NOT a chat surface: no transcript, no model picker, no history.
// One prompt, one reply, and the reply is transient — the durable output is the
// change Claude makes to the app's own source, which the page then reloads to show.
//
// Streaming arrives as SSE from POST /api/ask. fetch + a reader is used rather
// than EventSource because the prompt has to go up as a POST body with the
// X-Dash-Token header, and EventSource can do neither.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { C, FS, RADIUS } from "./theme.js";

// Split an SSE buffer into complete `data:` payloads, returning any trailing
// partial frame so the next chunk can finish it. A frame split across two network
// reads is normal, not an error — parsing eagerly here drops tokens mid-word.
export function parseSSE(buffer) {
  const events = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop();
  for (const part of parts) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()));
      } catch {
        // A malformed frame is skipped rather than killing the turn: the reply is
        // cosmetic, and the edit Claude made is still on disk either way.
      }
    }
  }
  return { events, rest };
}

// Pull the human-readable text out of one stream-json event. Token deltas arrive as
// stream_event/content_block_delta. The `assistant` events carry the full accumulated
// message (--include-partial-messages is always on) and are intentionally ignored here
// — appending both the delta and the accumulated text would duplicate every sentence.
export function eventText(ev) {
  if (ev.type === "stream_event") {
    const d = ev.event?.delta;
    return d?.type === "text_delta" ? d.text || "" : "";
  }
  return "";
}

// Text blocks between tool calls start with no leading space. Joined as-is, they
// run sentences together ("…each row.Now update…"), so each new block gets one.
export function appendEvent(acc, ev) {
  const e = ev.type === "stream_event" ? ev.event : null;
  if (e?.type === "content_block_start" && e.content_block?.type === "text"
      && acc && !/\s$/.test(acc)) {
    return acc + " ";
  }
  return acc + eventText(ev);
}

const PLACEHOLDER = "Ask Claude to change this console — e.g. add an interpolated P60 column";

// The reply is transient — the durable output is the edit, which the page reloads to
// show. So it gets a few lines and a scrollbar, not room to grow: this control lives
// among a tab's other controls, and a panel that resizes on every turn shifts them.
/** "Working" plus three pulsing dots, for the gap before the first token arrives.
 *
 *  The dots are staggered by delay rather than by three separate animations, and
 *  each is aria-hidden: a screen reader should hear "Working" once, not read three
 *  full stops. `prefers-reduced-motion` is honoured in GLOBAL_CSS, where the dots
 *  hold a mid-opacity instead of pulsing.
 */
function Working({ label = "Working" }) {
  return (
    <span role="status" aria-live="polite">
      {label}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="ctc-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

const REPLY_LINES = 3;
const REPLY_LINE_HEIGHT = 1.5;

// A turn that edited source ends in a reload, which would wipe its own "Done" before
// the user sees it — so the finished turn is parked here and picked up once on mount.
export const LAST_KEY = "ctc.ask.last";

function parkTurn(page, submitted, reply) {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ page, submitted, reply }));
  } catch {
    // Private browsing and some webviews throw; losing the Done line is fine.
  }
}

// One-shot, so a later manual refresh can't resurrect an old reply.
function takeParkedTurn() {
  try {
    const parked = JSON.parse(sessionStorage.getItem(LAST_KEY));
    if (typeof parked?.reply !== "string" || !parked.reply) return null;
    sessionStorage.removeItem(LAST_KEY);
    return {
      page: parked.page,
      submitted: typeof parked.submitted === "string" ? parked.submitted : "",
      reply: parked.reply,
    };
  } catch {
    return null;
  }
}

// The turn lives here, not in AskBar state: switching tabs unmounts the view's
// AskBar while the request keeps streaming, and the box it remounts must show it.
const IDLE = {
  page: null, submitted: "", reply: "", done: false,
  error: "", stuck: false, reloading: false, busy: false,
};
let turn = IDLE;
let parkedAdopted = false;
let streamText = "";
let frame = 0;
const listeners = new Set();

function setTurn(patch) {
  turn = { ...turn, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getTurn = () => turn;

function adoptParkedTurn() {
  if (parkedAdopted) return;
  parkedAdopted = true;
  const parked = takeParkedTurn();
  if (parked) turn = { ...IDLE, ...parked, done: true };
}

export function __resetAskStore() {
  cancelAnimationFrame(frame);
  turn = IDLE;
  parkedAdopted = false;
  streamText = "";
}

// Per-token setState would re-render the console per token; flush once per frame.
function flushStream() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => setTurn({ reply: streamText }));
}

async function stopTurn(token) {
  // Interrupt rather than abort the fetch: the turn ends with a normal result
  // frame, so the subprocess survives and the next prompt reuses its context.
  try {
    await fetch("/api/ask/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dash-Token": token },
      body: JSON.stringify({ sessionId: "default" }),
    });
  } catch {
    // Nothing to stop, or the turn already ended — not worth surfacing.
  }
}

async function runTurn({ token, page, text }) {
  streamText = "";
  setTurn({ ...IDLE, page, submitted: text, busy: true });
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dash-Token": token },
      body: JSON.stringify({ prompt: text, sessionId: "default", page }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // A turn left holding the lock (e.g. a closed browser tab) makes every later
      // prompt 409 until the server restarts, so offer a way out.
      if (body.error === "turn_in_progress") setTurn({ stuck: true });
      throw new Error(ERRORS[body.error] || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let shouldReload = false;
    let failed = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSSE(buffer);
      buffer = rest;
      for (const ev of events) {
        streamText = appendEvent(streamText, ev);
        if (ev.type === "result") {
          if (ev.ctcReload) shouldReload = true;
          if (ev.is_error || ev.subtype === "error") {
            failed = true;
            setTurn({ error: ev.result || "Claude reported an error." });
          }
        }
      }
      flushStream();
    }
    // Commit synchronously: reload below isn't deferred, so the frame flush can
    // lose the race and never paint.
    cancelAnimationFrame(frame);
    setTurn({ reply: streamText, done: true });

    if (shouldReload) {
      // Reload drops memory, so park the turn for the store to re-adopt. A failed
      // turn isn't parked: it would come back reading "Done".
      if (!failed) parkTurn(page, text, streamText);
      setTurn({ reloading: true });

      // Delayed so the browser can paint the answer before navigating away.
      setTimeout(() => window.location.reload(), 1400);
    }
  } catch (e) {
    setTurn({ error: e.message || String(e) });
  } finally {
    setTurn({ busy: false });
  }
}

const PAGE_LABEL = { "RefreshPlanner:SettingsStep": "Refresh Grant Planner" };
const pageLabel = (p) => PAGE_LABEL[p] || p || "other";

export default function AskBar({ token, page, placeholder = PLACEHOLDER }) {
  useState(adoptParkedTurn);
  const t = useSyncExternalStore(subscribe, getTurn);
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef(null);
  const replyRef = useRef(null);

  // There is one server session, so a turn from any page makes every box busy.
  const busy = t.busy;
  const mine = t.page === page;
  const elsewhere = busy && !mine;

  // Keep the newest line in view: the panel is capped at REPLY_LINES.
  useEffect(() => {
    const el = replyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [t.reply]);

  // Cmd/Ctrl-K focuses the box from anywhere, so the feature is reachable without
  // taking a hand off the keyboard mid-analysis.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function send() {
    const text = prompt.trim();
    if (!text || getTurn().busy) return;
    setPrompt("");
    runTurn({ token, page, text });
  }

  const stop = () => stopTurn(token);
  const showPanel = elsewhere || (mine && (busy || t.reply || t.error || t.stuck || t.submitted));

  return (
    <div>
      {showPanel && (
        <div ref={replyRef} style={{
          marginBottom: 10, fontSize: FS.sm,
          color: !elsewhere && t.error ? C.feedbackNegative : C.textSubtle,
          whiteSpace: "pre-wrap", lineHeight: REPLY_LINE_HEIGHT,
          // Three lines, then scroll, in em so it tracks the type scale. A panel
          // that grows each turn would push the card's other controls around.
          maxHeight: `${REPLY_LINE_HEIGHT * REPLY_LINES}em`,
          overflowY: "auto",
        }}>
          {elsewhere ? (
            <Working label={`Claude is still working on your ${pageLabel(t.page)} request`} />
          ) : (
            <>
              {t.submitted && (
                <div style={{ marginBottom: 4, color: C.textQuiet }}>
                  You: {t.submitted}
                </div>
              )}
              {t.error
                ? `⚠️ ${t.error}`
                : t.done && t.reply
                  ? <><span style={{ color: C.feedbackPositive }}>✓ Done</span> — {t.reply}</>
                  : (t.reply || <Working />)
              }
              {t.stuck && (
                <button
                  type="button"
                  onClick={async () => { await stop(); setTurn({ stuck: false, error: "" }); }}
                  style={{
                    marginLeft: 8, padding: "1px 7px",
                    fontSize: FS.sm, fontFamily: "inherit",
                    color: C.textDefault, background: C.surfaceDefault,
                    border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
                    cursor: "pointer",
                  }}
                >
                  Stop it and retry
                </button>
              )}
              {t.reloading && <div style={{ color: C.textQuiet }}>Reloading to show the change…</div>}
            </>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          disabled={busy}
          placeholder={placeholder}
          aria-label="Ask Claude to change this console"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          style={{
            flex: 1, height: 40, padding: "0 12px",
            fontSize: FS.md, fontFamily: "inherit",
            color: C.textDefault, background: C.surfaceDefault,
            border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
          }}
        />
        <button
          type="button"
          onClick={busy ? stop : send}
          disabled={!busy && !prompt.trim()}
          style={{
            height: 40, padding: "0 15px",
            fontSize: FS.md, fontWeight: 500, fontFamily: "inherit",
            color: !busy && !prompt.trim() ? C.textQuiet : C.textDefault,
            background: C.surfaceDefault,
            border: `1px solid ${!busy && !prompt.trim() ? C.borderSubtle : C.borderDefault}`,
            borderRadius: RADIUS,
            cursor: !busy && !prompt.trim() ? "default" : "pointer",
          }}
        >
          {busy ? "Stop" : "Ask"}
        </button>
      </div>
    </div>
  );
}

// Server error codes → what the user should actually do about them.
const ERRORS = {
  claude_unavailable:
    "Couldn't start Claude. Check that the `claude` CLI is installed, on your PATH, and logged in.",
  turn_in_progress: "Still working on the previous request.",
  empty_prompt: "Type a request first.",
  unauthorized: "Session expired — relaunch the dashboard from your Claude session.",
};
