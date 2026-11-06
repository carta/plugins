import { useEffect, useState } from "react";
import { FS, sans } from "./theme.js";

// The determinate fill carries a sweeping sheen, so the bar reads as alive even while its width holds
// still; reduced-motion users get a static bar. The sheen is the surface color, which contrasts with
// the primary fill in both light and dark.
const KEYFRAMES =
  "@keyframes fm-loading-slide{0%{left:-40%}100%{left:100%}}" +
  "@keyframes fm-loading-sheen{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}" +
  "@media (prefers-reduced-motion:reduce){.fm-loading-anim{animation:none!important}}";
// shadcn Progress: the track is the primary color at 20%, the fill is the primary color, both fully rounded.
const PRIMARY = "var(--ink-button-background-color-primary-base-default)";
const TRACK = `color-mix(in srgb, ${PRIMARY} 20%, transparent)`;
const CREEP_DELAY_MS = 450;
const CREEP_MS = 40000;

/** Full-page loading state with a progress bar. `progress` is `{ from, to }` fractions of the bar:
 *  the fill moves to `from` when a step starts, then creeps slowly toward `to` so a long step
 *  still visibly moves. Without `progress` the bar is indeterminate (a sliding block). */
export default function LoadingScreen({ label, progress = null, children }) {
  const from = progress?.from ?? null;
  const to = progress?.to ?? null;
  const [creeping, setCreeping] = useState(false);
  useEffect(() => {
    setCreeping(false);
    if (from == null) return undefined;
    const t = setTimeout(() => setCreeping(true), CREEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [from, to]);

  const determinate = from != null;
  const fill = determinate ? (creeping ? to : from) : 0;
  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", display: "grid", placeItems: "center" }}>
      <style>{KEYFRAMES}</style>
      <div style={{ textAlign: "center", width: 320, maxWidth: "80vw" }}>
        {children}
        <div style={{ fontSize: FS.bodyLg }}>{label}</div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? Math.round(from * 100) : undefined}
          style={{ position: "relative", overflow: "hidden", height: 8, borderRadius: 999, marginTop: 14, background: TRACK }}
        >
          {determinate ? (
            <div style={{ position: "relative", overflow: "hidden", height: "100%", width: `${fill * 100}%`, borderRadius: 999, background: PRIMARY, transition: `width ${creeping ? CREEP_MS : 400}ms ${creeping ? "cubic-bezier(.1,.6,.3,1)" : "ease"}` }}>
              <div className="fm-loading-anim" style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ink-color-global-surface-background-default) 35%, transparent), transparent)", animation: "fm-loading-sheen 1.6s ease-in-out infinite" }} />
            </div>
          ) : (
            <div style={{ position: "absolute", top: 0, height: "100%", width: "40%", borderRadius: 999, background: PRIMARY, animation: "fm-loading-slide 1.4s ease-in-out infinite" }} className="fm-loading-anim" />
          )}
        </div>
      </div>
    </div>
  );
}
