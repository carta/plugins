import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "./markdown.jsx";
import { CloseIcon, StopIcon } from "./components.jsx";
import { FS, SANS } from "./theme.js";
import { trackClick } from "../analytics.js";

// Built-in fallback catalog, used when the outer shell's /api/models fetch
// hasn't resolved (or failed) — keeps the model picker usable offline. This
// mirrors chat_session.CLAUDE_MODELS on the server; that copy is the source
// of truth (served via GET /api/models), this is only the no-network fallback.
export const FALLBACK_MODELS = [
  { value: "haiku", label: "Haiku — fast" },
  { value: "sonnet", label: "Sonnet — balanced", default: true },
  { value: "opus", label: "Opus — most capable" },
];

// ChatPanel renders in the outer frame (no GLOBAL_CSS there), so the keyframes
// these animations need are injected once, here, rather than relying on a
// stylesheet the outer frame doesn't load.
let chatKeyframesInjected = false;
function injectChatKeyframes() {
  if (chatKeyframesInjected || typeof document === "undefined") return;
  chatKeyframesInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-fm-chat-keyframes", "");
  style.textContent =
    "@keyframes fm-dot{0%,80%,100%{opacity:.2}40%{opacity:1}}" +
    "@keyframes fm-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);
}

// Shown for the whole turn, not just the wait before the first token: with
// streaming, dots that stop at the first token read as "finished" while text is
// still arriving. `hasText` keeps it clear of the text it trails.
function Thinking({ hasText }) {
  return (
    <span data-testid="chat-thinking" aria-label="Claude is responding"
          style={{ display: "inline-flex", gap: 4, alignItems: "center",
                   marginTop: hasText ? 4 : 0 }}>
      {[0, 1, 2].map((n) => (
        <span key={n} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--ink-color-global-text-subtle)",
          animation: "fm-dot 1.2s infinite",
          animationDelay: (n * 0.16) + "s",
        }} />
      ))}
    </span>
  );
}

// terminal_reason values the CLI stamps on the `result` frame of a turn that was
// interrupted. Such a turn also carries is_error:true, so it must be recognised
// BEFORE the generic error branch or a user pressing Stop sees a failure and
// loses the text they just watched stream in.
const ABORTED_REASONS = ["aborted_streaming", "aborted_tools"];

function StoppedMark({ hadText }) {
  return (
    <div data-testid="chat-stopped" style={{
      fontSize: FS.small, marginTop: hadText ? 4 : 0,
      color: "var(--ink-color-global-text-subtle)",
    }}>
      ⏹ Stopped{hadText ? "" : " before Claude replied"}
    </div>
  );
}

function ButtonSpinner() {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 12, height: 12, borderRadius: "50%",
      border: "2px solid var(--ink-button-font-color-primary-base)",
      borderTopColor: "transparent",
      animation: "fm-spin .6s linear infinite",
    }} />
  );
}

// Shown in place of the transcript until the first message is sent. The chat's
// two capabilities (read the loaded fund data / edit the app's own source) are
// not discoverable from the composer placeholder alone, so spell them out.
function EmptyState() {
  const items = [
    ["📊", "Explain the numbers", "“Which companies drive this fund’s TVPI?”"],
    ["🎛️", "Change the view", "“Add a last-round column to the Companies table.”"],
    ["📍", "Pinpoint", "Select any chart, figure, or section on the page, and allow Claude to provide targeted insights or changes."],
  ];
  return (
    <div data-testid="chat-empty-state" style={{
      margin: "auto", padding: "0 4px", maxWidth: 300,
      color: "var(--ink-color-global-text-subtle)", fontSize: FS.body, lineHeight: 1.5,
    }}>
      <div style={{ fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 4,
                    color: "var(--ink-color-global-text-default)" }}>
        Ask Claude about this firm
      </div>
      <p style={{ margin: "0 0 12px" }}>
        Claude can read the fund data loaded here and edit this app’s own screens.
      </p>
      {items.map(([icon, title, example]) => (
        <div key={title} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <span aria-hidden="true">{icon}</span>
          <span>
            <span style={{ fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{title}</span>
            {" — "}{example}
          </span>
        </div>
      ))}
      <p style={{ margin: 0, opacity: 0.8 }}>
        Scenario changes stay on this machine — nothing is written back to Carta.
      </p>
    </div>
  );
}

export function pinLabel(anchor) {
  if (!anchor) return "";
  if (anchor.label) return anchor.label; // display label computed at capture time
  if (anchor.datum && anchor.datum.name) return anchor.datum.name; // precomputed clean label
  const t = (anchor.quotedText || "").trim();
  if (t) return t.length > 40 ? t.slice(0, 40) + "…" : t;
  if (anchor.datum && anchor.datum.id) return (anchor.datum.type || "item") + " " + anchor.datum.id;
  if (anchor.section) return anchor.section;
  const vf = anchor.source && anchor.source.viewFile;
  return vf ? vf.split("/").pop() : "element";
}

function parseSSE(buffer) {
  const events = [];
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (line) {
      try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
    }
  }
  return [events, rest];
}

export default function ChatPanel({ sessionId, onTurnStart, onTurnEnd, anchor, onAnchorConsumed, pinMode, onTogglePinMode, models, defaultModel, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  injectChatKeyframes();

  const modelList = (models && models.length) ? models : FALLBACK_MODELS;
  const initialModel = defaultModel
    || (modelList.find((m) => m.default) || modelList[0]).value;
  const [model, setModel] = useState(initialModel);
  // initialModel can arrive after mount (models/defaultModel load async from
  // the outer shell's /api/models fetch) — only adopt a late-arriving default
  // before the first message; never override a user's pick or a locked session.
  useEffect(() => {
    if (messages.length === 0) setModel(initialModel);
  }, [initialModel]);
  const locked = messages.length > 0;

  // Keep the transcript pinned to the newest text. `messages` gets a new identity
  // on every streamed chunk, so this runs per frame while a reply arrives.
  const logRef = useRef(null);
  // Follow the tail only while the reader is already there: yanking the view down
  // mid-stream would fight someone scrolled up reading earlier answers.
  const stickToBottom = useRef(true);

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    // A few px of slack so sub-pixel rounding doesn't read as "scrolled away".
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
  }

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Ask the server to abort the turn, then keep reading: the stream is NOT
  // aborted here. Claude answers an interrupt with a real `result` frame, and
  // draining to it is what leaves the session reusable for the next prompt —
  // tearing down the fetch early would strand buffered frames and get the
  // session evicted. busy/stopping are reset by send()'s finally.
  async function stop() {
    if (!busy || stopping) return;
    trackClick("FundModeling.Chat.StopTurn");
    setStopping(true);
    try {
      // The /api token is not passed per call: installApiAuth() patches
      // window.fetch to stamp X-Dash-Token onto every /api request, so this
      // matches send() and every other endpoint. Adding it here would fork that
      // single source of truth.
      await fetch("/api/chat/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {
      // Nothing to surface: the turn's own result frame is the source of truth
      // for how it ended, and a failed interrupt just means it ends normally.
    }
  }

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy) return;
    trackClick("FundModeling.Chat.SendMessage");
    // Submitting is an explicit "show me what happens next", so re-follow the
    // tail even if the reader had scrolled up before sending.
    stickToBottom.current = true;
    const pin = anchor ? pinLabel(anchor) : null;
    setMessages((m) => [...m, { role: "user", text: prompt, pin }, { role: "assistant", text: "" }]);
    setInput(""); setBusy(true);
    const decoder = new TextDecoder();
    try {
      onTurnStart?.(); // inside try: a throw here still hits finally → resume+reload runs
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId, model, ...(anchor ? { anchor } : {}) }),
      });
      onAnchorConsumed?.();
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json()).error || ""; } catch (e) { /* non-JSON body */ }
        throw new Error("chat request failed (" + res.status + (detail ? ": " + detail : "") + ")");
      }
      const reader = res.body.getReader();
      let buf = "";
      // Once we've seen a partial text_delta, the CLI's terminal full-message
      // `assistant` frame merely restates what we already streamed — ignore it.
      // If no delta ever arrives (older CLI / unexpected shape), sawDelta stays
      // false and we append whole `assistant` blocks as before.
      let sawDelta = false;
      let sawStop = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let events;
        [events, buf] = parseSSE(buf);
        // Coalesce every appended token from this network chunk into one render.
        let chunkText = "";
        let errorText = null;
        for (const ev of events) {
          if (ev.type === "stream_event"
              && ev.event?.type === "content_block_delta"
              && ev.event.delta?.type === "text_delta") {
            sawDelta = true;
            chunkText += ev.event.delta.text || "";
          } else if (ev.type === "assistant" && !sawDelta) {
            chunkText += (ev.message?.content || [])
              .filter((b) => b.type === "text").map((b) => b.text).join("");
          } else if (ev.type === "result" && ABORTED_REASONS.includes(ev.terminal_reason)) {
            sawStop = true;   // user pressed Stop — keep the partial text as-is
          } else if (ev.type === "result" && (ev.is_error || ev.subtype === "error")) {
            errorText = "⚠️ " + (ev.error || "claude reported an error");
          }
        }
        if (errorText !== null) {
          setMessages((m) => {
            const copy = m.slice();
            copy[copy.length - 1] = { role: "assistant", text: errorText };
            return copy;
          });
        } else if (chunkText) {
          setMessages((m) => {
            const copy = m.slice();
            copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + chunkText };
            return copy;
          });
        }
      }
      if (sawStop) {
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, stopped: true };
          return copy;
        });
      }
    } catch (err) {
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", text: "⚠️ " + (err && err.message ? err.message : "error") };
        return copy;
      });
    } finally {
      setBusy(false);
      setStopping(false);
      onTurnEnd?.();
    }
  }

  return (
    <div className="fm-chat" style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: SANS }}>
      <style>{".fm-chat-input input:focus{box-shadow:0 0 0 3px var(--ink-color-global-border-focus-light);border-color:var(--ink-color-global-border-focus-default)}"}</style>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", flex: "none", marginBottom: 2 }}>
          <button onClick={onClose} data-testid="chat-close"
            title="Close chat panel" aria-label="Close chat panel"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28,
              border: "none", borderRadius: 4, background: "transparent",
              color: "var(--ink-color-global-text-subtle)", cursor: "pointer", lineHeight: 0 }}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      <div className="fm-chat-log" ref={logRef} onScroll={onLogScroll}
           style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 10px 4px 0" }}>
        {messages.length === 0 && <EmptyState />}
        {messages.map((m, i) => (
          <div key={i} className={"fm-msg fm-" + m.role}
               style={{
                 alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                 maxWidth: "90%", padding: "6px 10px", borderRadius: 8, fontSize: FS.bodyLg,
                 whiteSpace: "pre-wrap", wordBreak: "break-word",
                 color: "var(--ink-color-global-text-default)",
                 background: m.role === "user"
                   ? "var(--ink-color-global-surface-lightgray-default)"
                   : "transparent",
               }}>
            {m.role === "user" && m.pin && (
              <div style={{ fontSize: FS.small, opacity: 0.7 }}>📍 {m.pin}</div>
            )}
            {m.role === "assistant"
              ? (
                  <>
                    {m.text !== "" && renderMarkdown(m.text)}
                    {m.stopped && <StoppedMark hadText={m.text !== ""} />}
                    {/* Trails the partial text for the whole turn — the dots are
                        "still going", not "waiting to start". */}
                    {busy && i === messages.length - 1 && !m.stopped
                      && <Thinking hasText={m.text !== ""} />}
                  </>
                )
              : m.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <select
          data-testid="model-select"
          value={model}
          disabled={locked || busy}
          title={locked ? "Model is locked for this conversation" : "Model for this conversation (locks after the first message)"}
          onChange={(e) => setModel(e.target.value)}
          style={{ fontSize: FS.body, padding: "4px 6px", borderRadius: 6,
                   border: "1px solid var(--ink-color-global-border-subtle)",
                   background: "var(--ink-color-global-surface-background-default)",
                   color: "var(--ink-color-global-text-default)", cursor: locked ? "default" : "pointer" }}>
          {modelList.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
        </select>
        {onTogglePinMode && (
          <button data-testid="pinpoint-toggle" onClick={onTogglePinMode} aria-pressed={!!pinMode}
            style={{ fontSize: FS.body, padding: "4px 8px", borderRadius: 6, whiteSpace: "nowrap",
                     border: "1px solid var(--ink-color-global-border-subtle)",
                     background: pinMode ? "var(--ink-color-global-surface-lightgray-default)" : "transparent",
                     color: "var(--ink-color-global-text-default)", cursor: "pointer" }}>
            📍 {pinMode ? "Esc to cancel" : "Pinpoint"}
          </button>
        )}
      </div>
      {anchor && (
        <div className="fm-chat-pin" style={{
          display: "flex", alignItems: "center", gap: 6, fontSize: FS.body,
          padding: "4px 8px", marginBottom: 6, borderRadius: 6,
          background: "var(--ink-color-global-surface-lightgray-default)",
          color: "var(--ink-color-global-text-default)",
        }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            📍 Pinned: {pinLabel(anchor)}
          </span>
          <button onClick={() => onAnchorConsumed?.()} aria-label="Unpin" style={{ lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div className="fm-chat-input" style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Ask about this fund, or request a layout change…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          disabled={busy}
          style={{
            flex: 1,
            border: "1px solid var(--ink-color-global-border-default)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: FS.bodyLg,
            background: "var(--ink-color-global-surface-background-default)",
            color: "var(--ink-color-global-text-default)",
            outline: "none",
          }}
        />
        {/* One button, two jobs: while a turn is in flight it becomes Stop, so
            the composer never shows a dead disabled Send. */}
        <button onClick={busy ? stop : send}
          disabled={stopping}
          data-testid={busy ? "chat-stop" : "chat-send"}
          title={busy ? "Stop this response" : undefined}
          aria-label={busy ? "Stop this response" : undefined}
          style={{
            background: "var(--ink-button-background-color-primary-base-default)",
            color: "var(--ink-button-font-color-primary-base)",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            cursor: stopping ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}>
          {stopping ? <ButtonSpinner /> : busy ? <StopIcon /> : null}
          {stopping ? "Stopping…" : busy ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}
