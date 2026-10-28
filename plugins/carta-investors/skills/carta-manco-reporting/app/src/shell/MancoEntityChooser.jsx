// Shown instead of the loading screen when a firm lists more than one management-company
// entity and useLoadFirm.js's load has paused on handleLoadFirm's "multiple_manco_entities"
// frame (server/worker.js's resolveMancoEntity) waiting for a pick. Unlike FirmChooser, the
// list is always short and already known — no search box, no refetch.
import { ChooserPage, ChooserButton } from "./ChooserPage.jsx";

export default function MancoEntityChooser({ entities, onPick }) {
  return (
    <ChooserPage title="Choose a management company"
      subtitle="This firm has more than one management company. Pick which management company entity's microapp to open.">
      <div style={{ display: "flex", flexDirection: "column" }}>
        {entities.map((e) => (
          <ChooserButton key={e.id} data-testid={`manco-entity-${e.id}`} onClick={() => onPick(e.id)}>
            {e.name}
          </ChooserButton>
        ))}
      </div>
    </ChooserPage>
  );
}
