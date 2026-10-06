import { useEffect, useMemo, useRef, useState } from "react";
import { C, FS, RADIUS, SANS } from "../ui/theme.js";
import ExportButton from "../ui/ExportButton.jsx";
import { MultiSelect, Select, SparkleAI, Tag, Th, Td } from "../ui/components.jsx";
import AskBar from "../ui/AskBar.jsx";
import LocationPicker from "../ui/LocationPicker.jsx";
import { compareRows, jobLabel, levelLabel, trackOf, TRACK_LABELS, PERCENTILES } from "../model/taxonomy.js";
import { money, equityValue, EQUITY_REPS } from "../model/format.js";
import { csvFilename, downloadCsv, toCsv } from "../model/csv.js";
import {
  adjustmentChips, catalogOptions, displayName, fetchKey, locationOptions,
} from "../model/locations.js";
import { UNAVAILABLE_CODE } from "../ui/claudeStatus.js";

// PCTS keys come from the registry — adding a percentile is a one-line change there.
const PCTS = PERCENTILES.map((p) => p.key);

// The three metrics as ONE table: a single Level column on the left, then a percentile
// block per metric. Each metric previously rendered its own standalone table in a
// three-column grid, which repeated the Level column three times and — because the grid
// tracks size independently — let the same level sit at three different vertical offsets
// once one table's level name wrapped. One table means one row per level, so a level's
// salary, cash and equity are always on the same line.
const METRIC_BLOCKS = [
  { key: "salary", label: "Salary" },
  { key: "tcc", label: "Total cash (TCC)" },
  { key: "equity", label: "Equity" },
];

/** All three metrics for one job/track group, sharing one Level column. */
function MetricTable({ rows, currency, equityRep }) {
  // tableLayout:fixed keeps declared widths authoritative; minWidth scales with
  // PCTS length so the wrapper scrolls before currency cells mash together.
  const minWidth = 260 + PCTS.length * 3 * 75;
  return (
    <table style={{ width: "100%", minWidth, tableLayout: "fixed" }}>
      <thead>
        {/* Group row names each metric over its four percentiles; without it the table
            reads as P25/P50/P75/P90 three times with nothing saying which is which. */}
        <tr>
          <Th width="13%" group />
          {METRIC_BLOCKS.map((m, mi) => (
            <Th key={m.key} colSpan={PCTS.length} align="center" group tinted={mi % 2 === 1}>
              {m.key === "equity"
                ? `${m.label} — ${EQUITY_REPS.find((r) => r.value === equityRep)?.label} (4-year grant)`
                : m.label}
            </Th>
          ))}
        </tr>
        <tr>
          <Th valign="bottom">Level</Th>
          {METRIC_BLOCKS.map((m, mi) =>
            PERCENTILES.map((p, pi) => (
              <Th key={`${m.key}-${p.key}`} align="right" valign="bottom" tinted={mi % 2 === 1}>
                <div
                  title={!p.fetched ? p.tooltip : undefined}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  {!p.fetched && <SparkleAI title={p.tooltip} />}
                  <span>{p.label}</span>
                </div>
              </Th>
            )))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const track = trackOf(r.ladder, r.level);
          const est = r.provenance && r.provenance !== "fetched";
          return (
            <tr key={`${r.job}-${r.ladder}-${r.level}`}>
              {/* The level name is the one variable-width cell; let it ellipsize rather
                  than widen the table past its container. */}
              <Td ellipsis title={levelLabel(r.level, track)}>
                {est && (
                  <SparkleAI title={r.provenanceNote || "User-added row"} />
                )}
                {est && " "}
                {levelLabel(r.level, track)}
              </Td>
              {METRIC_BLOCKS.map((m, mi) =>
                PCTS.map((pct, pi) => (
                  <Td key={`${m.key}-${pct}`} align="right" mono tinted={mi % 2 === 1}>
                    {m.key === "equity"
                      ? equityValue(r.equity?.[pct], equityRep, r.currency || currency)
                      : money(r[m.key]?.[pct], r.currency || currency)}
                  </Td>
                )))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Ask the local server for one location's benchmarks. It answers from its cache,
 *  or fetches them from Carta (scripts/location_fetch.py). Resolves to the location
 *  entry, or {error}; never throws. */
async function requestLocation(token, body) {
  try {
    const res = await fetch(`/api/location${window.location.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-Dash-Token": token } : {}) },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => null);
    return out && (out.error || out.rows) ? out : { error: "fetch_failed" };
  } catch {
    return { error: "fetch_failed" };
  }
}

/** Build-time sweeps as picker options, for a build without the catalog. */
function sweepOptions(locations) {
  return locationOptions(locations).map((o) => {
    const loc = locations.find((l) => l.key === o.value);
    return { ...o, value: loc?.location || o.value, name: displayName(loc) };
  });
}

/** Where the grid would be while a location is fetched, or after it failed. */
function LocationStatus({ name, reason, onRetry, onBack }) {
  const box = {
    border: `1px solid ${C.border}`, borderRadius: RADIUS, background: C.surface,
    padding: "18px 16px", fontSize: FS.md, color: C.textSubtle,
  };
  if (!reason) {
    return (
      <div role="status" style={box}>
        Fetching benchmarks for <span style={{ color: C.text, fontWeight: 600 }}>{name}</span> from
        Carta. This takes about half a minute.
      </div>
    );
  }
  const btn = {
    font: `500 ${FS.sm}px/1 ${SANS}`, padding: "8px 12px", borderRadius: RADIUS,
    border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer",
  };
  return (
    <div role="alert" style={box}>
      <div style={{ marginBottom: 12 }}>
        {reason === UNAVAILABLE_CODE
          ? "An error occurred. Fetching other locations isn't supported in this setup for now."
          : <>Couldn't fetch benchmarks for <span style={{ color: C.text, fontWeight: 600 }}>{name}</span> from Carta.</>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {reason !== UNAVAILABLE_CODE && (
          <button type="button" style={btn} onClick={onRetry}>Try again</button>
        )}
        <button type="button" style={btn} onClick={onBack}>Back to the default location</button>
      </div>
    </div>
  );
}

/** "Location: Tulsa, OK  [Pay adjustment 70%]", as the product shows it above the
 *  figures. Without the on-demand fetch an international market's figures are USD
 *  only, and the line says so; with it, the Currency control says it. */
function LocationLine({ location, onOwnGroup, canFetch }) {
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      fontSize: FS.md, color: C.textSubtle, marginBottom: 14,
    }}>
      <span>Location: <span style={{ color: C.text, fontWeight: 600 }}>{displayName(location)}</span></span>
      {adjustmentChips(location).map((c) => (
        <Tag key={c.text} tone="info" title={c.title}>{c.text}</Tag>
      ))}
      {!canFetch && location.international
        && (location.currencies || []).every((c) => c === "USD") && (
        <span style={{ color: C.textFaint }}>
          Shown in USD — local currency isn't available in this console yet.
        </span>
      )}
      {!canFetch && !onOwnGroup && (
        <span style={{ color: C.textFaint }}>
          Other peer groups show the default location.
        </span>
      )}
    </div>
  );
}

export default function Benchmarks({ data, onPeerGroupChange, token }) {
  // A SET of job codes, empty meaning "all". Empty-as-all rather than seeding the set
  // with every code: the two states look identical on screen but behave differently the
  // moment the peer group switches, because a different bucket can cover a different set
  // of job areas. A pre-filled set would silently become a stale explicit filter —
  // pinning the view to areas the new group may not have — while empty keeps meaning
  // "whatever this group covers".
  const [jobSel, setJobSel] = useState(() => new Set());

  // Peer-group switching. The build may cache alternate buckets from the SAME dimension
  // (peer_<CODE>/ dirs -> data.alternatePeerGroups); when it hasn't, there is nothing to
  // switch between and the control is omitted rather than shown with one option.
  //
  // `peer` is a code, and PEER_OPTIONS always includes the corp's own group first — it
  // is the plan's group and the honest default, so switching away is an explicit act.
  const [peer, setPeer] = useState(data?.peerGroup?.code || "");
  const [dim, setDim] = useState(data?.peerGroup?.dimension || "");

  // Two controls, not one flat list of 18. Switching bucket WITHIN a dimension asks
  // "what if we were valued higher?"; switching DIMENSION changes what a peer even is,
  // which the corp's plan chose deliberately. Collapsing both into one dropdown would
  // make a peer-set redefinition look like a filter tweak — and someone comparing
  // screenshots would have no idea the basis moved.
  //
  // Order and grouping come from the builder (`peerGroupDimensions`); bucket rank is not
  // recoverable from a label ("$1B" sorts before "$1M" as text, and "1-25"/">500" have
  // no prefix to parse).
  const dimensions = useMemo(() => data?.peerGroupDimensions || [], [data]);

  const bucketsFor = (dimension) => {
    const grp = dimensions.find((g) => g.dimension === dimension);
    if (!grp) return [];
    const alts = data?.alternatePeerGroups || {};
    const own = data?.peerGroup;
    return grp.codes
      .map((code) => (code === own?.code
        ? { code, label: own.label, own: true }
        : alts[code] ? { code, label: alts[code].label, own: false } : null))
      .filter(Boolean);
  };
  const peerOptions = bucketsFor(dim);

  // Changing dimension moves to that dimension's first bucket, since the current code
  // belongs to the old one. The corp's own group is preferred when returning to its
  // own dimension, so switching away and back lands where you started.
  const onDimChange = (nextDim) => {
    setDim(nextDim);
    const buckets = bucketsFor(nextDim);
    const ownHere = buckets.find((b) => b.own);
    setPeer((ownHere || buckets[0] || {}).code || "");
  };

  // Location. `locationCatalog` lists every location the plan supports; one the
  // build didn't sweep is fetched from Carta when picked (requestLocation), for
  // whichever peer group is showing. A build without the catalog or the fetch
  // offers only its own sweeps, which exist for the plan's peer group in USD, so
  // another peer group holds at the default and the line says why.
  const locations = useMemo(() => data?.locations || [], [data]);
  const catalog = data?.locationCatalog || null;
  const canFetch = !!data?.locationFetch;
  const ownPeer = data?.peerGroup?.code;
  const defaultParam = data?.defaultLocation
    || locations.find((l) => l.default)?.location || null;
  const options = useMemo(() => (catalog?.length
    ? catalogOptions(catalog, defaultParam)
    : sweepOptions(locations)), [catalog, locations, defaultParam]);
  const [locParam, setLocParam] = useState(defaultParam);
  // The product converts an international market to its local currency by default.
  const [localCurrency, setLocalCurrency] = useState(true);
  const [fetched, setFetched] = useState({});
  const [failed, setFailed] = useState({});
  const inflight = useRef(new Set());

  const onOwnGroup = !peer || peer === ownPeer;
  const wantParam = canFetch || onOwnGroup ? locParam : defaultParam;
  const isDefault = !wantParam || wantParam === defaultParam;
  const option = options.find((o) => o.value === wantParam);
  const wantLocal = canFetch && !!option?.international && localCurrency;
  const key = fetchKey(wantParam, wantLocal, peer || ownPeer, ownPeer);
  const defaultEntry = useMemo(() => {
    const own = locations.find((l) => l.default);
    if (own) return own;
    const r = (data?.rows || []).find((x) => x.geo) || {};
    return {
      label: r.geo, default: true, international: false,
      salaryScalar: r.geoSalaryScalar, equityScalar: r.geoEquityScalar,
      catalogLabel: options.find((o) => o.value === defaultParam)?.name,
    };
  }, [locations, data, options, defaultParam]);
  const prebuilt = onOwnGroup && !wantLocal
    ? locations.find((l) => !l.default && l.location === wantParam) : null;
  const location = isDefault ? defaultEntry : (prebuilt || fetched[key] || null);
  const failure = !isDefault && !location ? failed[key] : null;
  const loading = !isDefault && !location && canFetch && !failure;

  useEffect(() => {
    if (!loading || inflight.current.has(key)) return;
    inflight.current.add(key);
    // Stored by key even if the user has moved on, so coming back is instant.
    requestLocation(token, {
      location: wantParam, localCurrency: wantLocal, peerGroup: peer || ownPeer,
    }).then((res) => {
      inflight.current.delete(key);
      if (res.error) setFailed((f) => ({ ...f, [key]: res.error }));
      else setFetched((f) => ({ ...f, [key]: res }));
    });
  }, [loading, key, token, wantParam, wantLocal, peer, ownPeer]);

  const retry = () => setFailed((f) => {
    const next = { ...f };
    delete next[key];
    return next;
  });

  // The active group's rows AND citation move together. Showing one group's figures
  // under another's attribution would mis-cite the data, which is the one part of this
  // feature that is a correctness issue rather than a convenience.
  const active = useMemo(() => {
    const own = data?.peerGroup;
    const fallback = {
      rows: data?.rows || [], attribution: data?.attribution,
      label: own?.label, dimension: own?.dimension,
    };
    const g = peer && peer !== own?.code ? (data?.alternatePeerGroups || {})[peer] : null;
    const group = g
      ? { rows: g.rows || [], attribution: g.attribution, label: g.label, dimension: g.dimension }
      : fallback;
    // A non-default location shows only its own fetched rows, never the default's
    // while it loads: the grid would be labelled with a location it doesn't show.
    return isDefault ? group : { ...group, rows: location?.rows || [] };
  }, [data, peer, location, isDefault]);

  // Hand the whole active group up, so the footer citation AND the header's peer-group
  // pill both describe what is on screen. Passing only the attribution sentence left the
  // pill pinned to the build's own group, so a switch updated the footer and the figures
  // but not the pill — three surfaces naming two different peer groups at once.
  //
  // Depends on `active` itself, not its fields: it is a useMemo, so identity changes
  // exactly when the group does.
  useEffect(() => {
    onPeerGroupChange?.(active);
  }, [active, onPeerGroupChange]);
  const [equityRep, setEquityRep] = useState(
    // Peer groups >= $500M expose a notional value; below that it is typically
    // absent, so FD % is the more useful default there.
    data?.peerGroup?.notionalAvailable ? "notional" : "fdpct",
  );

  // Sorted from the ACTIVE peer group, so switching the dropdown re-renders the grid
  // against that group's figures.
  const rows = useMemo(() => [...(active.rows || [])].sort(compareRows), [active]);
  const jobs = useMemo(() => {
    const seen = [];
    for (const r of rows) if (r.job && !seen.includes(r.job)) seen.push(r.job);
    return seen.sort((a, b) => jobLabel(a).localeCompare(jobLabel(b)));
  }, [rows]);

  // Selection is intersected with what this peer group actually covers, rather than
  // trusted as-is. Switching bucket can change the job-area set, and a code selected
  // under the old group would otherwise filter every row out and render an empty grid
  // that looks like missing data. Derived, not stored: the selection itself is left
  // alone, so switching back restores it.
  const activeSel = useMemo(() => {
    const present = new Set(jobs);
    const kept = new Set();
    for (const code of jobSel) if (present.has(code)) kept.add(code);
    return kept;
  }, [jobSel, jobs]);

  const visible = activeSel.size === 0 ? rows : rows.filter((r) => activeSel.has(r.job));

  const toggleJob = (code) => {
    setJobSel((prev) => {
      const next = new Set(prev);
      // Deselecting the last one returns to "all" rather than to an empty grid: an
      // empty selection and "show everything" are the same intent here, and a blank
      // screen would read as broken.
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  const clearJobs = () => setJobSel(new Set());

  /** The visible matrix -> CSV. Respects the job filter, so "Export" means what is on
   *  screen; a button that quietly returns all 22 areas while the view shows one would
   *  be a correctness problem, not a convenience.
   *
   *  Equity exports ALL THREE representations per percentile (shares / FD % / notional)
   *  rather than only the selected one. The picker exists because a screen can show one
   *  number per cell; a spreadsheet has no such limit, and re-exporting three times to
   *  compare would be the obvious next request. Salary and total cash are flat, so they
   *  are one column each.
   *
   *  Values are RAW numbers, not display strings — money()/shares()/fdPct() produce
   *  "$96,000" and "0.12%", which import as text and cannot be summed.
   */
  const exportMatrix = () => {
    const header = [
      "job_area", "track", "level", "currency",
      ...PCTS.map((p) => `salary_${p}`),
      ...PCTS.map((p) => `total_cash_${p}`),
      ...PCTS.flatMap((p) => [`equity_${p}_shares`, `equity_${p}_fd_pct`, `equity_${p}_notional`]),
      "geo",
    ];
    const body = visible.map((r) => {
      const track = trackOf(r.ladder, r.level);
      return [
        jobLabel(r.job), TRACK_LABELS[track] || track, levelLabel(r.level, track),
        r.currency || "",
        ...PCTS.map((p) => (r.salary || {})[p] ?? ""),
        ...PCTS.map((p) => (r.tcc || {})[p] ?? ""),
        ...PCTS.flatMap((p) => {
          const cell = (r.equity || {})[p] || {};
          return [cell.shares ?? "", cell.fdpct ?? "", cell.notional ?? ""];
        }),
        r.geo || "",
      ];
    });
    // The peer group goes in the FILENAME. Once switching is possible a user will
    // export several to compare, and three files all called
    // "meetly-benchmarks-<date>.csv" are indistinguishable in a downloads folder —
    // which for compensation figures is worse than mildly annoying.
    // The DIMENSION goes in too, not just the bucket: "$1M-$10M" exists in both the
    // post-money and capital-raised scales, so a bucket label alone is ambiguous once
    // cross-dimension comparison is possible.
    // The location goes in too when it isn't the default, for the same reason.
    const dimLabel = (dimensions.find((g) => g.dimension === (active.dimension || dim)) || {}).label;
    const where = location && !location.default ? `-${displayName(location)}` : "";
    const kind = active.label
      ? `benchmarks-${dimLabel ? dimLabel + "-" : ""}${active.label}${where}`
      : `benchmarks${where}`;
    downloadCsv(csvFilename(data?.source?.corporation, kind), toCsv([header, ...body]));
  };

  // Group by job, then by track — the two axes users actually scan along.
  const groups = useMemo(() => {
    const out = [];
    for (const r of visible) {
      const track = trackOf(r.ladder, r.level);
      let g = out.find((x) => x.job === r.job && x.track === track);
      if (!g) { g = { job: r.job, track, rows: [] }; out.push(g); }
      g.rows.push(r);
    }
    return out;
  }, [visible]);

  // Fallback currency for a row whose own currency the API didn't supply. Only
  // meaningful when the set is single-currency — see the pill below.
  const currency = visible.find((r) => r.currency)?.currency || null;

  // The pill names EVERY currency present, not just the first one found.
  // A corp with international employees returns rows in several currencies, and
  // "· USD" above a column of GBP cells misstates them. Derived from the visible
  // rows so it tracks the job-area filter, falling back to the build's list.
  const visibleCurrencies = useMemo(() => {
    const seen = [...new Set(visible.map((r) => r.currency).filter(Boolean))].sort();
    return seen.length ? seen : (data?.currencies || []);
  }, [visible, data]);

  if (!rows.length && isDefault) {
    return (
      <div style={{ padding: 24, color: C.textSubtle, fontSize: FS.md }}>
        No benchmark data in this snapshot.
      </div>
    );
  }

  return (
    <div style={{ padding: "0 24px 40px" }}>
      {/* Controls */}
      <div style={{
        display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
        padding: "14px 0", borderBottom: `1px solid ${C.border}`, marginBottom: 18,
      }}>
        {/* Compare against — the peer-SET definition. Shown only when the build cached
            more than one dimension; a single-option dropdown implies a choice that does
            not exist. Separate from the bucket control on purpose (see peerOptions). */}
        {dimensions.length > 1 && (
          <Select
            label="Compare by"
            value={dim}
            onChange={onDimChange}
            minWidth={210}
            hint="Which definition of a peer set — changing this changes who you are compared against, not just the bucket"
            options={dimensions.map((g) => ({
              value: g.dimension,
              label: g.label + (g.own ? " — your plan" : ""),
            }))}
          />
        )}

        {peerOptions.length > 1 && (
          <Select
            label="Peer group"
            value={peer}
            onChange={setPeer}
            minWidth={190}
            options={peerOptions.map((o) => ({
              value: o.code,
              label: o.label + (o.own ? " — your group" : ""),
            }))}
          />
        )}

        {options.length > 1 && (
          <LocationPicker
            value={wantParam || ""}
            onChange={setLocParam}
            options={options}
            disabled={!canFetch && !onOwnGroup}
            hint={canFetch || onOwnGroup
              ? "Figures are the server's, with that location's adjustment applied"
              : "Locations are fetched for your plan's peer group only — switch back to it to change location"}
          />
        )}

        {canFetch && option?.international && (
          <Select
            label="Currency"
            value={localCurrency ? "local" : "usd"}
            onChange={(v) => setLocalCurrency(v === "local")}
            minWidth={170}
            options={[
              { value: "local", label: `Local${option.currency ? ` (${option.currency})` : ""}` },
              { value: "usd", label: "USD" },
            ]}
          />
        )}

        <MultiSelect
          label="Job areas"
          allLabel={`All (${jobs.length})`}
          options={jobs.map((j) => ({ value: j, label: jobLabel(j) }))}
          selected={activeSel}
          onToggle={toggleJob}
          onAll={clearJobs}
          minWidth={170}
        />

        <Select
          label="Equity as"
          value={equityRep}
          onChange={setEquityRep}
          minWidth={160}
          options={EQUITY_REPS.map((r) => ({ value: r.value, label: r.label }))}
        />

        {/* Empty, not removed, while a location loads: it holds Export at the right,
            and "0 rows · USD" would describe figures that aren't there yet. */}
        <span style={{ fontSize: FS.xs, color: C.textFaint, marginLeft: "auto" }}>
          {!(loading || failure) && <>
            {visible.length} row{visible.length === 1 ? "" : "s"}
            {visibleCurrencies.length ? ` · ${visibleCurrencies.join(" / ")}` : ""}
          </>}
        </span>

        <ExportButton
          onExport={exportMatrix}
          title={
            activeSel.size === 0
              ? "Download all job areas as CSV — raw percentile values"
              : activeSel.size === 1
                ? `Download ${jobLabel([...activeSel][0])} as CSV — raw percentile values`
                : `Download ${activeSel.size} of ${jobs.length} job areas as CSV — raw percentile values`
          }
          disabled={!visible.length}
        />
      </div>

      {location && options.length > 1 && (
        <LocationLine location={location} onOwnGroup={onOwnGroup} canFetch={canFetch} />
      )}

      {/* Sits with this tab's controls rather than in a bar of its own: it acts on
          what is below it, so a request here reads as "change this view". */}
      <div style={{ marginBottom: 18 }}>
        <AskBar
          token={token}
          page="Benchmarks"
          placeholder="Ask Claude to change this page — e.g. add an interpolated P60 column"
        />
      </div>

      {(loading || failure) && (
        <LocationStatus
          name={option?.name || wantParam}
          reason={failure}
          onRetry={retry}
          onBack={() => setLocParam(defaultParam)}
        />
      )}

      {/* Grid */}
      {groups.map((g) => (
        <div key={`${g.job}-${g.track}`} style={{
          border: `1px solid ${C.border}`, borderRadius: RADIUS,
          padding: "14px 16px", marginBottom: 16, background: C.surface,
        }}>
          <div style={{
            fontSize: FS.lg, fontWeight: 600, marginBottom: 2,
            fontFamily: SANS, color: C.text,
          }}>
            {jobLabel(g.job)}
          </div>
          <div style={{ fontSize: FS.sm, color: C.textFaint, marginBottom: 14 }}>
            {TRACK_LABELS[g.track]} track
          </div>

          {/* One table, so it scrolls horizontally as a unit rather than three grid
              tracks resizing independently. */}
          <div style={{ overflowX: "auto" }}>
            <MetricTable rows={g.rows} currency={currency} equityRep={equityRep} />
          </div>
        </div>
      ))}
    </div>
  );
}
