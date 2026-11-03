// Shown instead of the loading screen when a firm name (a search pick or a deep-linked/shared
// ?firm=) matches more than one Carta firm and useLoadFirm.js's load has paused on
// handleLoadFirm's "ambiguous_firm" response (server/worker.js's authorizedFirm) waiting for a
// pick. MancoEntityChooser's sibling for the firm side of the same problem — same list-of-
// buttons shape, always short and already known, no search box.
import { ChooserPage, ChooserButton } from "./ChooserPage.jsx";
import { cartaIdLabel } from "./cartaIdLabel.js";

export default function FirmDisambiguator({ firms, onPick }) {
  return (
    <ChooserPage title="Choose a firm"
      subtitle="More than one firm matches this name. Pick the one you want.">
      <div style={{ display: "flex", flexDirection: "column" }}>
        {firms.map((f) => (
          <ChooserButton key={f.firmUuid} data-testid={`firm-match-${f.firmUuid}`} onClick={() => onPick(f.firmUuid)}>
            {f.name}{cartaIdLabel(f) ? ` (${cartaIdLabel(f)})` : ""}
          </ChooserButton>
        ))}
      </div>
    </ChooserPage>
  );
}
