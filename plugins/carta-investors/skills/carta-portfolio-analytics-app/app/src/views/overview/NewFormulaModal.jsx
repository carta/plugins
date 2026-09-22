// Mounts the shared FormulaEditor in a modal for the Columns panel's "New formula…" flow.
import { Modal } from "../../ui/components.jsx";
import { FormulaEditor } from "../Formulas.jsx";

export default function NewFormulaModal({ data, dashboard, open, onClose, onCreated }) {
  return (
    <Modal open={open} onClose={onClose} title="New formula" width={640} labelledById="new-formula-title">
      <FormulaEditor data={data} dashboard={dashboard} onSaved={(id) => { onCreated(id); onClose(); }} />
    </Modal>
  );
}
