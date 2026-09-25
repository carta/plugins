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

import { useEffect, useRef, useState } from "react";
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
function Working() {
  return (
    <span role="status" aria-live="polite">
      Working
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

export default function AskBar({ token, page, placeholder = PLACEHOLDER }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [done, setDone] = useState(false);
  // A previous turn still holds the session lock. Distinct from `busy`, which is
  // about THIS tab's request — the stuck turn may belong to a tab that is gone.
  const [stuck, setStuck] = useState(false);
  // Set by the server on the terminal frame when the turn edited app source. The
  // reload is what makes the change visible (source is transpiled in-browser, so
  // there is no HMR), and it is skipped otherwise — a question that changed
  // nothing must not cost the user their tab and filters.
  const [reloading, setReloading] = useState(false);
  const inputRef = useRef(null);
  const replyRef = useRef(null);
  // Streaming setState on every token would re-render the whole console per token.
  // Accumulate here and flush on a frame instead.
  const textRef = useRef("");
  const frameRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

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

  function flushText() {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      setReply(textRef.current);
      // Keep the newest line in view. The panel is capped at REPLY_LINES, so
      // without this a streaming reply scrolls its own answer out of sight and
      // the user watches three stale lines while the real one arrives below.
      const el = replyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function stop() {
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

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setStuck(false);
    setReply("");
    setDone(false);
    textRef.current = "";
    setSubmitted(text);
    setPrompt("");

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dash-Token": token },
        body: JSON.stringify({ prompt: text, sessionId: "default", page }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // A turn left holding the lock (a closed tab mid-stream, a client that
        // vanished) would otherwise wedge the box permanently: every later prompt
        // 409s and the only escape is restarting the server. Offer the way out.
        if (body.error === "turn_in_progress") setStuck(true);
        throw new Error(ERRORS[body.error] || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let shouldReload = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSE(buffer);
        buffer = rest;
        for (const ev of events) {
          textRef.current += eventText(ev);
          if (ev.type === "result") {
            if (ev.ctcReload) shouldReload = true;
            if (ev.is_error || ev.subtype === "error") {
              setError(ev.result || "Claude reported an error.");
            }
          }
        }
        flushText();
      }
      // Commit synchronously: reload below isn't deferred, so flushText's
      // requestAnimationFrame can lose the race and never paint.
      cancelAnimationFrame(frameRef.current);
      setReply(textRef.current);
      setDone(true);

      if (shouldReload) {
        // Persist first: reload drops in-memory state. App.jsx restores the
        // tab from sessionStorage on mount.
        setReloading(true);

        // Delayed so the browser can paint the answer before navigating away.
        setTimeout(() => window.location.reload(), 1400);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const showPanel = busy || reply || error || stuck || submitted;

  return (
    <div>
      {showPanel && (
        <div ref={replyRef} style={{
          marginBottom: 10, fontSize: FS.sm,
          color: error ? C.feedbackNegative : C.textSubtle,
          whiteSpace: "pre-wrap", lineHeight: REPLY_LINE_HEIGHT,
          // Three lines, then scroll. Expressed in em rather than a pixel value so
          // it stays three lines if the type scale moves. The box now sits inside a
          // card next to other controls, and a reply that grew to eight lines
          // pushed the card's own content around every time a turn ran.
          maxHeight: `${REPLY_LINE_HEIGHT * REPLY_LINES}em`,
          overflowY: "auto",
        }}>
          {submitted && (
            <div style={{ marginBottom: 4, color: C.textQuiet }}>
              You: {submitted}
            </div>
          )}
          {error
            ? `⚠️ ${error}`
            : done && reply
              ? <><span style={{ color: C.feedbackPositive }}>✓ Done</span> — {reply}</>
              : (reply || <Working />)
          }
          {stuck && (
            <button
              type="button"
              onClick={async () => { await stop(); setStuck(false); setError(""); }}
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
          {reloading && <div style={{ color: C.textQuiet }}>Reloading to show the change…</div>}
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
