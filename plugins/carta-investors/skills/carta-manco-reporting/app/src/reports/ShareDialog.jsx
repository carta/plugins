import { useEffect, useMemo, useRef, useState } from "react";
import { sans, INK, FAINT, LINE, RED, SHADE, FS } from "../ui/theme.js";
import { Btn, POPOVER_SHADOW } from "../ui/components.jsx";
import { Download } from "lucide-react";
import { EXPORT_STATUS, useHtmlExport } from "../ui/ExportButton.jsx";
import { trackClick, trackRender } from "../analytics.js";
import { CodeIcon, DownloadIcon, LockIcon, ShareIcon, UserIcon, UsersIcon, XIcon } from "./icons.jsx";
import { fmtDate, sharerName } from "./ReportNotice.jsx";
import { UPDATED, shareOutcome } from "./shareOutcome.js";
import { ownShare } from "./reportState.js";
import { actSaved, REPORT_ACTIONS } from "../state/useReports.js";
import { sharerView } from "../views/budgetPrefs.js";
import { ClaudePrompt, ClaudeSignIn, claudeFixPrompt } from "./claudeFix.jsx";

// The report's Share | Export panel, anchored under the header button. Wording is agreed
// with product; the Carta staff sentence holds because Carta staff keep access to the firm's entities.
const DONE = {
  [REPORT_ACTIONS.SHARE]: "Report shared.",
  [REPORT_ACTIONS.PUBLISH_AS_NEW]: "Report shared as a new report.",
  [REPORT_ACTIONS.DELETE]: "Stopped sharing. The shared copy is gone for everyone; yours stays here.",
};

function initials(person) {
  const base = (person.name || person.email || "?").trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function Spinner({ style }) {
  return (
    <svg className="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={style}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

// Export formats, one row each. Another format is one more entry and its own hook.
const FORMATS = [
  { key: "html", label: "HTML", hint: "Standalone web page", Icon: CodeIcon, useExport: useHtmlExport },
];

function ExportFormatRow({ format, exportProps }) {
  const { state, run } = format.useExport(exportProps);
  const status = EXPORT_STATUS[state];
  const Trailing = status?.Icon || Download;
  return (
    <button type="button" onClick={run} disabled={state === "busy"} className="navitem"
      aria-label={`Export as ${format.label}`} style={S.format}>
      <span style={S.formatIcon}><format.Icon size={18} /></span>
      <span style={S.who}>
        <span style={S.name}>{format.label}</span>
        <span style={{ ...S.email, ...(state === "error" ? { color: RED } : null) }} aria-live="polite">
          {status?.label || format.hint}
        </span>
      </span>
      <Trailing size={18} strokeWidth={1.75} style={S.formatAction} aria-hidden="true" />
    </button>
  );
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export default function ShareDialog({ report, reportsApi, firmName, entityName, exportProps, hosted, accountsData, anchorRef, onClose, onDone, onBusyChange }) {
  const link = ownShare(report);
  // The picker shows who a share reaches: offered for a new share only when the server can
  // create one, and always for an existing share so its audience stays visible. Stop
  // sharing and Keep private live in the footers instead, each gated on its own action.
  const canPick = reportsApi.can(REPORT_ACTIONS.SHARE) || !!link;
  // A new share starts limited to the people added; broadening it to the firm is a choice.
  const initialMode = link?.shared_with_everyone ? "everyone" : "people";
  const initialPicked = useMemo(() => new Set(link?.shared_with || []), [link]);
  const [tab, setTab] = useState("share");
  const [mode, setMode] = useState(initialMode);
  const [picked, setPicked] = useState(initialPicked);
  const [users, setUsers] = useState(null);
  const [peopleError, setPeopleError] = useState(null); // { message, code } | null
  // Names load up front only for a report already shared with people; a new share waits
  // until someone goes to add a person.
  const [wantPeople, setWantPeople] = useState(!!link && initialMode === "people");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, code } | null
  const [outcome, setOutcome] = useState(null); // "stale" | "deleted"
  const [confirmStop, setConfirmStop] = useState(false);
  const panelRef = useRef(null);
  // Choosing a person or Refresh takes that button off the page, so focus goes back to the search box.
  const searchRef = useRef(null);

  useEffect(() => { trackRender("MancoReporting.ShareDialog.View"); }, []);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  // Escape or a click outside the panel and its button closes it — unless a
  // share is in flight, which a stray click shouldn't dismiss.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    const onDown = (e) => {
      const inside = (anchorRef?.current || panelRef.current)?.contains(e.target);
      if (!inside && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Capture phase: a click inside that re-renders the panel can detach its own target
    // before a bubbling listener runs, which would then read it as outside.
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose, busy, anchorRef]);

  // Asked once, and only when people are wanted: a first lookup runs through Claude and takes
  // seconds, and the server runs one sharing action at a time. Later panels reuse the answer.
  const [peopleAsOf, setPeopleAsOf] = useState(null);
  // A failed lookup says nothing about who can see the entity: the list it replaced stays.
  const askPeople = (opts, kept = null) => {
    if (!reportsApi.can(REPORT_ACTIONS.USERS)) {
      setUsers(kept);
      setPeopleError({ message: "Carta's people list isn't available here.", code: null });
      return Promise.resolve();
    }
    return reportsApi.loadPeople(opts)
      .then(({ users: list, fetchedAt }) => { setUsers(list); setPeopleAsOf(fetchedAt); })
      .catch(e => { setUsers(kept); setPeopleError({ message: e.message, code: e.code }); });
  };
  const asked = useRef(false);
  useEffect(() => {
    if (!wantPeople || asked.current) return;
    asked.current = true;
    askPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPeople]);
  const refreshPeople = () => {
    searchRef.current?.focus();
    trackClick("MancoReporting.ShareDialog.RefreshPeople");
    setUsers(null);
    setPeopleError(null);
    askPeople({ refresh: true }, users);
  };

  // Names for everyone picked: the live list once it arrives, and meanwhile
  // what was recorded when the report was last shared.
  const directory = useMemo(() => {
    const map = new Map((link?.people || []).map(p => [p.user_id, p]));
    for (const u of users || []) map.set(u.user_id, u);
    return map;
  }, [users, link]);

  const loadingPeople = users === null && !peopleError;
  // Before the list arrives, an unnamed recipient is a placeholder row; after,
  // one still missing from it can no longer see the entity.
  const withAccess = Array.from(picked).map(id => directory.get(id)
    || { user_id: id, pending: loadingPeople, name: "",
      email: loadingPeople ? "" : users ? "No longer has access to this entity" : "Couldn’t load their name" });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || [])
      .filter(u => !picked.has(u.user_id))
      .filter(u => !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [users, query, picked]);

  const recipients = mode === "everyone" ? [] : Array.from(picked);
  const audienceChanged = link
    ? mode !== initialMode || (mode === "people" && !sameSet(picked, initialPicked))
    : true;
  const canSubmit = !busy && (mode === "everyone" || recipients.length > 0)
    && (!link || audienceChanged || link.dirty);

  const chooseMode = (next) => {
    trackClick(next === "everyone" ? "MancoReporting.ShareDialog.GeneralAccessEveryone" : "MancoReporting.ShareDialog.GeneralAccessPeople");
    setMode(next);
    if (next === "people") setWantPeople(true);
  };
  // Adding someone is choosing people: the report then reaches only them.
  const add = (user) => {
    searchRef.current?.focus();
    trackClick("MancoReporting.ShareDialog.AddPerson");
    setPicked(prev => new Set(prev).add(user.user_id));
    setMode("people");
    setQuery("");
  };
  const remove = (id) => {
    trackClick("MancoReporting.ShareDialog.RemovePerson");
    setPicked(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const run = async (op, extra = {}) => {
    setBusy(true);
    setError(null);
    try {
      // A share carries the Budget vs Actuals toolbar as the sharer left it for
      // this report, so recipients open it the same way.
      const sends = op === REPORT_ACTIONS.SHARE || op === REPORT_ACTIONS.PUBLISH_AS_NEW;
      const view = sends ? sharerView(accountsData, report.id) : null;
      const params = { report_id: report.id, ...extra, ...(view ? { view } : {}) };
      const outcome = shareOutcome(await reportsApi.runShareOp(op, params));
      if (outcome.kind === "decide") {
        setOutcome(outcome.status);
        return;
      }
      if (outcome.kind === "partial") {
        setError({ message: outcome.message, code: null });
        return;
      }
      onClose();
      onDone?.(op === REPORT_ACTIONS.SHARE && link ? UPDATED : DONE[op]);
    } catch (e) {
      setError({ message: e.message, code: e.code });
    } finally {
      setBusy(false);
    }
  };

  const people = () => recipients.map(id => directory.get(id)).filter(Boolean)
    .map(({ user_id, name, email }) => ({ user_id, name, email }));

  const keepPrivate = async () => {
    trackClick("MancoReporting.ShareDialog.KeepPrivate");
    setBusy(true);
    setError(null);
    try {
      const { notice } = await actSaved(reportsApi, report.id, REPORT_ACTIONS.UNLINK);
      onClose();
      if (notice) onDone?.(notice);
    } catch (e) {
      setError({ message: e.message, code: e.code });
    } finally {
      setBusy(false);
    }
  };

  const onShare = (force = false) => {
    trackClick(force ? "MancoReporting.ShareDialog.Overwrite" : "MancoReporting.ShareDialog.Share");
    run(REPORT_ACTIONS.SHARE, { shared_with: recipients, people: people(), force, updating: !!link });
  };

  const progress = busy ? reportsApi.shareJob?.progress : null;
  const primaryLabel = busy ? "Working…"
    : !link ? "Share"
    : audienceChanged ? "Save changes"
    : "Update";

  const audienceLine = mode === "everyone"
    ? `Everyone at ${firmName || "your firm"} who can view ${entityName || "this entity"}’s accounting can open this report.`
    : recipients.length
      ? `Only the ${recipients.length === 1 ? "person" : `${recipients.length} people`} you added can open this report.`
      : "Add at least one person to share this report.";

  const peopleFixPrompt = claudeFixPrompt(peopleError?.code, hosted);
  const errorFixPrompt = claudeFixPrompt(error?.code, hosted);

  const footer = outcome === "stale" ? (
    <>
      <span style={S.status}>Overwrite the shared copy with your version?</span>
      <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
      {reportsApi.can(REPORT_ACTIONS.SHARE) && (
        <Btn kind="primary" onClick={() => onShare(true)} disabled={busy}>Overwrite with my version</Btn>
      )}
    </>
  ) : outcome === "deleted" ? (
    <>
      <span style={S.status}>Share it as new, or keep it private?</span>
      {reportsApi.can(REPORT_ACTIONS.UNLINK) && <Btn onClick={keepPrivate} disabled={busy}>Keep private</Btn>}
      {reportsApi.can(REPORT_ACTIONS.PUBLISH_AS_NEW) && (
        <Btn kind="primary" onClick={() => { trackClick("MancoReporting.ShareDialog.ShareAsNew"); run(REPORT_ACTIONS.PUBLISH_AS_NEW, { shared_with: recipients, people: people() }); }} disabled={busy}>Share as new</Btn>
      )}
    </>
  ) : confirmStop ? (
    <>
      <span style={S.status}>The shared copy goes away for everyone. Yours stays here.</span>
      <Btn onClick={() => setConfirmStop(false)} disabled={busy}>Cancel</Btn>
      <Btn kind="danger" onClick={() => { trackClick("MancoReporting.ShareDialog.StopSharing"); run(REPORT_ACTIONS.DELETE); }} disabled={busy}>
        Stop sharing for everyone
      </Btn>
    </>
  ) : (
    <>
      <span style={S.status}>
        {progress || (link ? (
          <>
            Shared {fmtDate(link.created_at || link.updated_at)}
            {link.updated_at && link.created_at && link.updated_at.slice(0, 16) !== link.created_at.slice(0, 16)
              ? ` · updated ${fmtDate(link.updated_at)}` : ""}
            {link.dirty && <span style={S.pending}> · Changes not shared yet</span>}
          </>
        ) : "Only you can see this report")}
      </span>
      {link && reportsApi.can(REPORT_ACTIONS.DELETE) && (
        <Btn kind="ghost" onClick={() => setConfirmStop(true)} disabled={busy} style={S.stop}>Stop sharing</Btn>
      )}
      {reportsApi.can(REPORT_ACTIONS.SHARE) && (
        <Btn kind="primary" onClick={() => onShare(false)} disabled={!canSubmit}>{primaryLabel}</Btn>
      )}
    </>
  );

  const showMatches = searching && !loadingPeople;

  return (
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-label={`Share “${report.name}”`} style={S.panel}>
      <header style={S.header}>
        <h2 style={S.title}>{report.name}</h2>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="navitem" style={S.close}>
          <XIcon size={16} />
        </button>
      </header>

      <div role="tablist" aria-label="Share or export" style={S.tabs}>
        {[["share", "Share", ShareIcon, "MancoReporting.ShareDialog.ShareTab"],
          ["export", "Export", DownloadIcon, "MancoReporting.ShareDialog.ExportTab"]].map(([key, label, Icon, event]) => (
          <button
            key={key} type="button" role="tab" aria-selected={tab === key} disabled={busy}
            onClick={() => { trackClick(event); setTab(key); }}
            style={{ ...S.tab, ...(tab === key ? S.tabActive : null) }}
          >
            <Icon size={16} />{label}
          </button>
        ))}
      </div>

      {tab === "export" ? (
        <div role="list" aria-label="Export formats" style={S.formats}>
          {exportProps && FORMATS.map(f => (
            <div role="listitem" key={f.key}><ExportFormatRow format={f} exportProps={exportProps} /></div>
          ))}
        </div>
      ) : report.read_only ? (
        <div style={S.body} role="note">
          <p style={S.readOnlyTitle}>You can’t share this report</p>
          <p style={S.readOnlyText}>
            This report is read-only based on what {sharerName(report.shared)} shared with you. To
            customize or share this report with others, duplicate it and share your copy. Exporting is
            also available.
          </p>
        </div>
      ) : (
        <>
          <div style={S.body}>
            {outcome === "stale" && (
              <p style={S.warn}>This report changed on Carta since you last shared it.</p>
            )}
            {outcome === "deleted" && (
              <p style={S.warn}>The shared copy of this report was deleted.</p>
            )}
            {!outcome && !canPick && (
              <>
                <p style={S.readOnlyTitle}>Sharing isn’t available for this report</p>
                <p style={S.readOnlyText}>This server doesn’t support sharing reports with Carta yet. Exporting is still available.</p>
              </>
            )}
            {!outcome && canPick && (
              <>
                {/* Focus moving within the search box and its list keeps the list open. */}
                <div style={S.searchWrap} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearching(false); }}>
                  {loadingPeople && wantPeople && <Spinner style={S.spinner} />}
                  <input
                    ref={searchRef} type="search" value={query}
                    onChange={e => setQuery(e.target.value)}
                    onFocus={() => { setWantPeople(true); setSearching(true); }}
                    placeholder={loadingPeople && wantPeople ? "Loading people from Carta…" : "Add people by name or email"}
                    disabled={busy} aria-busy={loadingPeople && wantPeople} aria-label="Add people"
                    style={{ ...S.search, ...(loadingPeople && wantPeople ? S.searchLoading : null) }}
                  />
                  {showMatches && (
                    <div style={S.matches}>
                    <div role="listbox" aria-label="People to add" style={S.matchList}>
                      {matches.map(u => (
                        <button key={u.user_id} type="button" role="option"
                          onMouseDown={e => e.preventDefault()} onClick={() => add(u)}
                          className="navitem" style={S.match}>
                          <span style={S.avatar}>{initials(u)}</span>
                          <span style={S.who}>
                            <span style={S.name}>{u.name || u.email}</span>
                            {u.name && <span style={S.email}>{u.email}</span>}
                          </span>
                        </button>
                      ))}
                      {matches.length === 0 && (
                        <div style={S.none}>
                          {peopleError ? "Couldn’t load the people who can see this entity."
                            : query.trim() ? "Nobody else by that name can see this entity."
                            : users.length ? "Everyone who can see this entity already has access."
                            : "Nobody else can see this entity’s accounting yet."}
                        </div>
                      )}
                    </div>
                    <div style={S.listFoot}>
                      <span>People who can see this entity{peopleAsOf ? ` · as of ${fmtDate(new Date(peopleAsOf * 1000).toISOString())}` : ""}</span>
                      <button type="button" onMouseDown={e => e.preventDefault()} onClick={refreshPeople} style={S.refresh}>
                        Refresh
                      </button>
                    </div>
                    </div>
                  )}
                </div>

                <div style={S.label}>People with access</div>
                <ul style={S.list} aria-label="People with access">
                  <li style={S.person}>
                    <span style={S.avatar}><UserIcon size={16} /></span>
                    <span style={S.who}><span style={S.name}>You</span></span>
                    <span style={S.role}>Owner</span>
                  </li>
                  {mode === "people" && withAccess.map(p => p.pending ? (
                    <li key={p.user_id} style={S.person} aria-label="Loading">
                      <span className="skeleton" style={{ ...S.avatar, background: undefined }} />
                      <span style={S.who}>
                        <span className="skeleton" style={{ width: 120, height: 10, marginBottom: 6 }} />
                        <span className="skeleton" style={{ width: 170, height: 8 }} />
                      </span>
                    </li>
                  ) : (
                    <li key={p.user_id} style={S.person}>
                      <span style={S.avatar}>{initials(p)}</span>
                      <span style={S.who}>
                        <span style={S.name}>{p.name || p.email}</span>
                        {p.name && <span style={S.email}>{p.email}</span>}
                      </span>
                      <button
                        type="button" onClick={() => remove(p.user_id)} disabled={busy}
                        aria-label={`Remove ${p.name || p.email}`} title="Remove access" className="navitem" style={S.remove}
                      >
                        <XIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>

                <div style={S.label}>General access</div>
                <div style={S.access}>
                  <span style={S.accessIcon}>{mode === "everyone" ? <UsersIcon size={16} /> : <LockIcon size={16} />}</span>
                  <span style={S.who}>
                    <select
                      aria-label="General access" value={mode} disabled={busy}
                      onChange={e => chooseMode(e.target.value)} style={S.select}
                    >
                      <option value="people">Only people you add</option>
                      <option value="everyone">Everyone at {firmName || "your firm"}</option>
                    </select>
                    <span style={S.email}>{audienceLine}</span>
                  </span>
                </div>

                <p style={S.small}>
                  Sharing this report version allows the respective user to see this entire report in their own
                  microapp regardless of their permissions in Carta. It’s made available as read-only in their
                  Shared with You reports.
                </p>
              </>
            )}
            {!outcome && peopleError && (
              <>
                <p style={S.error} role="alert">{peopleError.message}</p>
                <ClaudeSignIn code={peopleError.code} hosted={hosted} event="MancoReporting.ShareDialog.SignIn" />
                {peopleFixPrompt && <ClaudePrompt text={peopleFixPrompt} event="MancoReporting.ShareDialog.CopyFixPrompt" />}
              </>
            )}
            {error && (
              <>
                <p style={S.error} role="alert">{error.message}</p>
                <ClaudeSignIn code={error.code} hosted={hosted} event="MancoReporting.ShareDialog.SignIn" />
                {errorFixPrompt && <ClaudePrompt text={errorFixPrompt} event="MancoReporting.ShareDialog.CopyFixPrompt" />}
              </>
            )}
          </div>
          <footer style={S.footer}>{footer}</footer>
        </>
      )}
    </div>
  );
}

const S = {
  panel: {
    ...sans, position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 60,
    width: "min(460px, calc(100vw - 32px))", maxHeight: "min(640px, 80vh)",
    display: "flex", flexDirection: "column", background: "var(--card)", color: INK,
    border: `1px solid ${LINE}`, borderRadius: 8, boxShadow: POPOVER_SHADOW, outline: "none",
    fontSize: FS.bodyLg, lineHeight: 1.5, textAlign: "left",
  },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 12px 20px" },
  title: {
    ...sans, margin: 0, fontSize: FS.h3, fontWeight: 600, lineHeight: 1.3, minWidth: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  close: {
    marginLeft: "auto", border: 0, background: "transparent", color: INK, cursor: "pointer",
    width: 28, height: 28, borderRadius: 4, display: "grid", placeItems: "center", padding: 0, flex: "none",
  },
  tabs: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, margin: "0 20px 4px",
    padding: 3, background: SHADE, borderRadius: 6,
  },
  tab: {
    ...sans, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    // Longhands only: tabActive swaps borderColor, and a shorthand here loses it on switch.
    height: 32, borderWidth: 1, borderStyle: "solid", borderColor: "transparent", borderRadius: 4, background: "transparent",
    color: FAINT, fontSize: FS.body, fontWeight: 500, cursor: "pointer",
  },
  tabActive: { background: "var(--card)", color: INK, borderColor: LINE },
  body: { padding: "12px 20px", overflowY: "auto" },
  formats: { padding: "8px 8px 12px" },
  format: {
    ...sans, display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
    // No inline background: the shared .navitem class owns the rest and hover fills.
    border: 0, borderRadius: 6, color: INK, padding: "10px 12px", cursor: "pointer", fontSize: FS.bodyLg,
  },
  formatIcon: {
    width: 36, height: 36, flex: "none", borderRadius: 6, border: `1px solid ${LINE}`,
    display: "grid", placeItems: "center", color: INK,
  },
  formatAction: { marginLeft: "auto", flex: "none", color: FAINT },
  searchWrap: { position: "relative", marginBottom: 16 },
  search: {
    ...sans, width: "100%", boxSizing: "border-box", border: "1px solid var(--border-default)", borderRadius: 6,
    // Longhands only: searchLoading widens paddingLeft, and a shorthand here would lose it.
    paddingTop: 9, paddingRight: 12, paddingBottom: 9, paddingLeft: 12,
    fontSize: FS.bodyLg, outline: "none", background: "transparent", color: INK,
  },
  spinner: { position: "absolute", left: 12, top: 20, marginTop: -7, color: FAINT },
  searchLoading: { paddingLeft: 34 },
  matches: {
    position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 1,
    background: "var(--card)", border: `1px solid ${LINE}`, borderRadius: 6, boxShadow: POPOVER_SHADOW,
    padding: 4,
  },
  // Only the people scroll; the "as of · Refresh" line under them stays in view.
  matchList: { maxHeight: 220, overflowY: "auto" },
  match: {
    ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    border: 0, background: "transparent", padding: "6px 8px", borderRadius: 4, cursor: "pointer", color: INK,
  },
  none: { padding: "6px 8px", color: FAINT, fontSize: FS.body },
  listFoot: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    margin: "4px -4px -4px", padding: "6px 12px", borderTop: `1px solid ${LINE}`, color: FAINT, fontSize: FS.small,
  },
  refresh: {
    ...sans, border: 0, background: "none", padding: 0, cursor: "pointer", color: INK,
    fontSize: "inherit", textDecoration: "underline", textUnderlineOffset: 3,
  },
  label: { color: FAINT, fontSize: FS.body, margin: "0 0 6px" },
  list: { listStyle: "none", margin: "0 0 14px", padding: 0, maxHeight: 200, overflowY: "auto" },
  person: { display: "flex", alignItems: "center", gap: 12, padding: "6px 0" },
  avatar: {
    width: 32, height: 32, flex: "none", borderRadius: "50%", background: SHADE, color: INK,
    display: "grid", placeItems: "center", fontSize: FS.micro, fontWeight: 600,
  },
  who: { minWidth: 0, display: "flex", flexDirection: "column", flex: 1 },
  name: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  email: { color: FAINT, fontSize: FS.small, overflow: "hidden", textOverflow: "ellipsis" },
  role: { color: FAINT, fontSize: FS.body, flex: "none" },
  remove: {
    marginLeft: "auto", border: 0, background: "transparent", color: FAINT, cursor: "pointer",
    width: 28, height: 28, borderRadius: 4, display: "grid", placeItems: "center", padding: 0, flex: "none",
  },
  access: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 },
  accessIcon: {
    width: 32, height: 32, flex: "none", borderRadius: "50%", background: SHADE, color: INK,
    display: "grid", placeItems: "center",
  },
  select: {
    ...sans, alignSelf: "flex-start", maxWidth: "100%", border: 0, background: "transparent", color: INK,
    fontSize: FS.bodyLg, fontWeight: 500, padding: "0 2px 0 0", margin: 0, cursor: "pointer",
  },
  small: { margin: 0, color: FAINT, fontSize: FS.small },
  footer: {
    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    padding: "12px 20px 16px", borderTop: `1px solid ${LINE}`,
  },
  status: { flex: "1 1 160px", minWidth: 0, color: FAINT, fontSize: FS.body },
  pending: { color: INK },
  stop: { color: RED },
  warn: { margin: "0 0 12px", padding: "10px 12px", background: SHADE, borderRadius: 4 },
  error: { margin: "8px 0 0", color: RED },
  readOnlyTitle: { margin: "4px 0 6px", fontWeight: 600 },
  readOnlyText: { margin: "0 0 4px", color: FAINT, fontSize: FS.body },
};
