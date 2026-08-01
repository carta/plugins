import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX } from "../../ui/format.js";
import { H3, MethodNote, SourceNote } from "../../ui/components.jsx";

const shortCo = (n) => n.replace(/\s*\(.*\)/, "").replace(/,? (Inc|Corp|Co|LLC|Ltd)\.?,?( dba .*)?$/i, "");

// The "standard" venture power-law exponent: returns decay ~ rank^-1 (Zipf).
// Anchored to this fund's own top holding, so the reference asks "given your best
// deal, does the rest of the book decay like a textbook power law?".
const STD_K = 1;

const W = 960, H = 440, PL = 54, PR = 44, PT = 22, PB = 44;
const PLOTW = W - PL - PR, PLOTH = H - PT - PB;
const log10 = (x) => Math.log10(x);

/** Least-squares slope/intercept of Y=a+bX over the (logRank, logMoic) points
 *  with moic>0. The fund's decay exponent is -b. */
function fitLogLog(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  return { a, b };
}

/** Power-law chart: each of the fund's unrealized holdings plotted by its gross
 *  return multiple (fair value ÷ cost at the modeled marks) against its rank, on
 *  log–log axes so a power law is a straight line. The dashed reference is the
 *  standard rank^-1 power law anchored to the fund's top holding; the solid line
 *  is the fund's own fitted decay. Dots above the reference (green) beat the
 *  power-law expectation at their rank; below (red) fall short. */
export default function PowerLawChart({ companies, fundName }) {
  // All hooks must run before any early return (Rules of Hooks) — a fund with
  // <2 positive holdings makes `model` null below, and hoisting keeps the hook
  // count stable when switching to/from such a fund (else React throws).
  const [hoverId, setHoverId] = useState(null);
  const model = useMemo(() => {
    const positive = companies.filter((c) => c.moic > 0);
    if (positive.length < 2) return null;
    const topMoic = positive[0].moic; // companies arrive ranked desc
    const N = companies.length;
    // reference multiple at a rank (1-based)
    const refAt = (rank) => topMoic * Math.pow(rank, -STD_K);
    // fit the fund's own exponent over positive points. Companies arrive ranked
    // desc by moic and all positives precede any zero, so positive[i] is rank i+1.
    const fit = fitLogLog(positive.map((c, i) => [log10(i + 1), log10(c.moic)]));
    const fitK = fit ? -fit.b : null;
    // axis domains (log10)
    const moics = positive.map((c) => c.moic);
    const yTop = Math.max(...moics) * 1.4;
    const yFloorRaw = Math.min(...moics) * 0.6;
    const yFloor = Math.max(0.02, Math.min(0.5, yFloorRaw)); // keep write-downs visible at the base
    const yMinLog = log10(yFloor), yMaxLog = log10(yTop);
    const xMax = log10(Math.max(N, 2));
    const x = (rank) => PL + (xMax ? log10(rank) / xMax : 0) * PLOTW;
    const y = (moic) => {
      const v = Math.max(yFloor, moic || yFloor);
      return PT + (1 - (log10(v) - yMinLog) / (yMaxLog - yMinLog)) * PLOTH;
    };
    const pts = companies.map((c, i) => {
      const rank = i + 1;
      const ref = refAt(rank);
      return { ...c, rank, ref, above: c.moic >= ref, clamped: c.moic < yFloor,
               cx: x(rank), cy: y(c.moic) };
    });
    const aboveN = pts.filter((p) => p.rank > 1 && p.above).length;
    // the fund's fitted decay line, straight on log–log (screen-space endpoints)
    const fittedMoic = (rank) => (fit ? Math.pow(10, fit.a + fit.b * log10(rank)) : null);
    const fitPath = fit ? `M ${x(1)} ${y(fittedMoic(1))} L ${x(N)} ${y(fittedMoic(N))}` : null;
    // tick sets that fall inside the domains
    const yTicks = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250].filter((t) => t >= yFloor && t <= yTop);
    const xTicks = [1, 2, 3, 5, 10, 20, 50, 100, 200].filter((t) => t <= N);
    return { N, topMoic, fitK, fitPath, x, y, refAt, pts, aboveN, yTicks, xTicks, xMax, yFloor };
  }, [companies]);

  if (!model) {
    return (
      <div className="card" style={{ padding: "18px 22px", marginBottom: 16 }}>
        <span style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
          Not enough marked holdings with positive value to plot a return distribution for this fund.
        </span>
      </div>
    );
  }

  const { N, fitK, fitPath, x, y, refAt, pts, aboveN, yTicks, xTicks } = model;
  const hovered = pts.find((p) => p.id === hoverId) || null;
  // reference (dashed) line endpoints: straight on log–log
  const refPath = `M ${x(1)} ${y(refAt(1))} L ${x(N)} ${y(refAt(N))}`;
  const shape = fitK == null ? "" :
    fitK > 1.12 ? " — steeper than standard: value is more concentrated in the very top holdings"
    : fitK < 0.9 ? " — flatter than standard: winners are spread more evenly across the book"
    : " — closely tracks the standard power law";

  return (
    <div className="card" style={{ padding: "18px 22px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <H3>Return power law · holdings by rank</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
          {N} unrealized holdings · gross multiple at modeled marks
        </span>
      </div>
      <MethodNote>
        Each holding by gross multiple (total value ÷ invested cost) vs rank. Axes are <strong>log–log</strong>, so a power law plots as a
        straight line: the <span style={{ color: MICRO, fontWeight: 600 }}>dashed</span> line is the standard rank⁻¹ power law (straight by
        definition, anchored to the top holding), the <span style={{ color: "var(--ink-button-background-color-primary-base-default)", fontWeight: 600 }}>solid</span> line is this fund's fitted
        decay, and the gap between them is the deviation. <span style={{ fontWeight: 600 }}>Open rings</span> = exited, filled = live. Hover for the company.
      </MethodNote>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
        aria-label={`Return multiple by rank for ${fundName}, log-log, vs a standard venture power law`}>
        {/* y gridlines + labels (multiples) */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
            <text x={PL - 8} y={y(t) + 3} textAnchor="end" style={{ ...mono, fontSize: FS.micro, fill: MICRO }}>{fmtX(t)}</text>
          </g>
        ))}
        {/* x ticks + labels (rank) */}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PT} y2={H - PB} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
            <text x={x(t)} y={H - PB + 16} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>#{t}</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
        <text x={PL} y={H - 6} style={{ ...sans, fontSize: FS.micro, fill: "var(--ink-color-global-text-subtle)" }}>Rank · log scale (best → worst)</text>
        <text x={PL - 8} y={PT - 8} textAnchor="end" style={{ ...sans, fontSize: FS.micro, fill: "var(--ink-color-global-text-subtle)" }}>MOIC · log scale</text>

        {/* standard power-law reference (dashed) */}
        <path d={refPath} fill="none" style={{ stroke: MICRO }} strokeWidth="1.6" strokeDasharray="5 4" opacity="0.8" />
        {/* fund's fitted decay (solid) */}
        {fitPath && <path d={fitPath} fill="none" style={{ stroke: "var(--ink-button-background-color-primary-base-default)" }} strokeWidth="2" strokeLinejoin="round" />}

        {/* connector from each dot to the reference at its rank (shows deviation) */}
        {pts.map((p) => (
          <line key={`d${p.id}`} x1={p.cx} x2={p.cx} y1={p.cy} y2={y(p.ref)}
            style={{ stroke: p.above ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }} strokeWidth="1" opacity="0.28" />
        ))}

        {/* dots — company names are shown on hover (fixed labels collide). Realized
            exits render as an open ring, live holdings as a filled dot. */}
        {pts.map((p, i) => {
          const on = hovered && hovered.id === p.id;
          const base = i === 0 ? "var(--ink-color-global-text-default)" : p.above ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
          return (
            <g key={p.id} data-datum-id={p.id} data-datum-type="company" data-datum-label={p.name}
              onMouseEnter={() => setHoverId(p.id)} onMouseLeave={() => setHoverId(null)}
              style={{ cursor: "pointer" }}>
              <title>{`#${p.rank} ${p.name} · ${fmtX(p.moic)}`}</title>
              {/* generous invisible hit target so hover is easy */}
              <circle cx={p.cx} cy={p.cy} r={12} fill="transparent" />
              <circle cx={p.cx} cy={p.cy} r={on ? 6.5 : i === 0 ? 5 : 3.8}
                style={{ fill: p.realized ? "var(--ink-color-global-surface-background-default)" : base, stroke: p.realized ? base : "var(--ink-color-global-surface-background-default)" }} strokeWidth={p.realized ? 2 : 1} />
            </g>
          );
        })}

        {/* hover tooltip — the only place a company name appears */}
        {hovered && (() => {
          const flip = hovered.cx > PL + PLOTW * 0.6;
          const tw = 186, th = 46;
          const tx = flip ? hovered.cx - tw - 12 : hovered.cx + 12;
          const ty = Math.max(PT, Math.min(hovered.cy - th / 2, H - PB - th));
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx="6"
                style={{
                  fill: "var(--ink-color-global-surface-background-default)",
                  stroke: "var(--ink-color-global-border-subtle)",
                  filter: "drop-shadow(0 2px 6px rgba(0,0,0,.12))",
                }}
                strokeWidth="1" />
              <text x={tx + 11} y={ty + 18} style={{ ...sans, fontSize: FS.small, fontWeight: 700, fill: "var(--ink-color-global-text-default)" }}>{shortCo(hovered.name)}</text>
              <text x={tx + 11} y={ty + 34} style={{ ...mono, fontSize: FS.small, fill: "var(--ink-color-global-text-subtle)" }}>
                #{hovered.rank} · {fmtX(hovered.moic)} · {fmtM(hovered.value)}{hovered.realized ? " · exited" : ""}
              </text>
            </g>
          );
        })()}
      </svg>

      <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-default)", margin: "6px 2px 0", lineHeight: 1.5 }}>
        {fitK != null && (
          <>This portfolio's returns decay as <b>rank<sup>−{fitK.toFixed(2)}</sup></b> vs the standard power law's rank<sup>−1.00</sup>{shape}.{" "}</>
        )}
        <span style={{ color: "var(--ink-color-global-text-subtle)" }}>{aboveN} of {N} holdings sit above the standard curve at their rank.</span>
      </div>

      <SourceNote>
        Source: Carta Fund Admin. Gross multiple = total value (residual FV + realized proceeds) ÷ invested cost, before fees and carry. The rank⁻¹ reference is illustrative, not a Carta figure. Names confidential.
      </SourceNote>
    </div>
  );
}
