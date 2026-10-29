// Inline glyphs for the report controls. The vendored lucide bundle ships only
// the icons the app already imports (see app/build.mjs), so these are drawn
// here in Lucide's own stroke style rather than growing that bundle.

import { SIDENAV_STRIPE } from "../ui/theme.js";

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };

function Glyph({ size = 16, children, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none", ...style }} {...base}>
      {children}
    </svg>
  );
}

export const ShareIcon = (p) => (
  <Glyph {...p}>
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </Glyph>
);

// Refreshes the shared copy with your local changes (Lucide's refresh-cw).
export const RefreshIcon = (p) => (
  <Glyph {...p}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
  </Glyph>
);

export const UserIcon = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
  </Glyph>
);

export const CodeIcon = (p) => (
  <Glyph {...p}>
    <path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M14 4l-4 16" />
  </Glyph>
);

export const LockIcon = (p) => (
  <Glyph {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Glyph>
);

export const DownloadIcon = (p) => (
  <Glyph {...p}>
    <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
  </Glyph>
);

export const PlusIcon = (p) => (
  <Glyph {...p}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const EyeIcon = (p) => (
  <Glyph {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
  </Glyph>
);

export const MoreIcon = (p) => (
  <Glyph {...p}>
    <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
  </Glyph>
);

export const UsersIcon = (p) => (
  <Glyph {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Glyph>
);

export const AlertIcon = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
  </Glyph>
);

export const XIcon = (p) => (
  <Glyph {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Glyph>
);

// The "changes not shared yet" mark on a shared report's icon, in the active-stripe accent.
export function UnsharedDot({ show, children, style }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", ...style }}>
      {children}
      {show && <span aria-hidden="true" style={dot} />}
    </span>
  );
}

const dot = {
  position: "absolute", top: -2, right: -3, width: 7, height: 7, borderRadius: "50%",
  background: SIDENAV_STRIPE, boxShadow: "0 0 0 1.5px var(--ink-color-global-background-default, #fff)",
};
