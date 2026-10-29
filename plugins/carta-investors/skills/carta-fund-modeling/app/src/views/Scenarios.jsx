import { H1, H2, Btn } from "../ui/components.jsx";
import { FS, sans } from "../ui/theme.js";
import { ScenarioTiles } from "../ui/ScenarioMenu.jsx";
import { isShared } from "../model/slices.js";

/** Every scenario as a tile — the sidebar's scenario menu shows Baseline and the
 *  latest viewed, and its "View all" link opens this page. Your own scenarios come
 *  first; scenarios shared with you follow in their own section. Its "Update data"
 *  link loads the firm's latest: in the header once any are loaded (beside one that
 *  shows hidden ones), and inside the empty-state sentence until then.
 *  `share` is null where sharing is off: then shared scenarios have no section. */
export default function Scenarios({ slices, snapshot, activeSliceId, onPick, onNew, onRename, onPublish, onDelete, publishBusy, share }) {
  const tileProps = { snapshot, activeSliceId, onPick, onRename, onPublish, onDelete, publishBusy };
  const shared = slices.filter(isShared);
  // nothing loaded yet: none visible and none hidden
  const none = share && !shared.length && !share.hiddenCount;
  const updateLink = share && (
    <Btn kind="link" data-testid="pull-shared" onClick={share.onPull} disabled={share.busy}
      title="Load scenarios shared with your firm" style={{ fontSize: "inherit", verticalAlign: "baseline" }}>Update data</Btn>
  );
  return (
    <div>
      <H1>Scenarios</H1>
      <ScenarioTiles slices={slices.filter((s) => !isShared(s))} onNew={onNew} {...tileProps} />
      {share && (
        <section data-testid="scenarios-shared" style={{ marginTop: 32 }}>
          <H2 actions={!none && <>
            {share.hiddenCount > 0 && (
              <Btn kind="link" onClick={share.onShowHidden} title="Show hidden shared scenarios" style={{ fontSize: FS.small }}>
                {share.hiddenCount} hidden · Show
              </Btn>
            )}
            <span style={{ fontSize: FS.small }}>{updateLink}</span>
          </>}>Shared with you</H2>
          {shared.length > 0 && <ScenarioTiles slices={shared} {...tileProps} />}
          {none && (
            <div style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>
              {updateLink} to check for any new shared scenarios.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
