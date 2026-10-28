import { useState } from "react";
import { sans, INK, PAPER, FAINT, FS } from "../../ui/theme.js";
import { Btn, Tag, Chevron, CloseIcon, MenuItem, POPOVER_SURFACE } from "../../ui/components.jsx";
import { useOutsideClose } from "../../ui/useOutsideClose.js";
import { VALUE_FIELDS } from "./pivot.js";

function dragPayload(fieldKey, fromZone) {
  return JSON.stringify({ fieldKey, fromZone });
}

// The report's fields, laid out as an Ink tile: a section per place a field can go,
// each listing its fields as tags with an "Add field" menu. Fields also drag between
// sections and reorder within one; Values are the measures to show, ticked on or off.
const FIELD_SECTIONS = [
  { zone: "rows", label: "Rows", help: "Group the table's rows by" },
  { zone: "columns", label: "Columns", help: "Split each figure across" },
  { zone: "filters", label: "Filters", help: "Keep only the values you choose" },
];

export function FieldsPanel({ fields, fieldKeys, zones, onToggleValue, onMoveField, onRemoveField, dragOverZone, setDragOverZone }) {
  // A field lays the table out by Rows or by Columns, not both; Filters can take any field
  // too, so Vendor can be the rows and filtered to the vendors chosen.
  const addable = (zone) => fieldKeys.filter(k => !fields[k].isValue && !zones[zone].includes(k)
    && (zone === "filters" || !(zones.rows.includes(k) || zones.columns.includes(k))));
  return (
    <section style={styles.fieldsPanel} aria-label="Report fields">
      <h2 style={styles.fieldsHeader}>Report fields</h2>
      {FIELD_SECTIONS.map(({ zone, label, help }) => (
        <ZoneSection key={zone} name={zone} label={label} help={help} fields={zones[zone]} allFields={fields}
                     unused={addable(zone)} onMoveField={onMoveField} onRemoveField={onRemoveField}
                     isOver={dragOverZone === zone} setDragOverZone={setDragOverZone} />
      ))}
      <div style={styles.section}>
        <div style={styles.sectionLabel} id="report-values-label">Values</div>
        <div style={styles.sectionHelp}>Figures to show for each row</div>
        <div role="group" aria-labelledby="report-values-label" style={styles.valueList}>
          {Object.entries(VALUE_FIELDS).map(([k, f]) => (
            <label key={k} className="gf-check-row">
              <input type="checkbox" checked={zones.values.includes(k)} onChange={() => onToggleValue(k)} />
              {f.label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ZoneSection({ name, label, help, fields, allFields, unused, onMoveField, onRemoveField, isOver, setDragOverZone }) {
  function handleDrop(e, insertIndex) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverZone(null);
    const { fieldKey, fromZone } = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    if (fieldKey) onMoveField(fieldKey, fromZone, name, insertIndex);
  }
  const labelId = `report-${name}-label`;
  return (
    <div
      role="group" aria-labelledby={labelId}
      style={{ ...styles.section, ...(isOver ? styles.sectionOver : null) }}
      onDragOver={e => { e.preventDefault(); setDragOverZone(name); }}
      onDragLeave={() => setDragOverZone(null)}
      onDrop={e => handleDrop(e, null)}
    >
      <div style={styles.sectionLabel} id={labelId}>{label}</div>
      <div style={styles.sectionHelp}>{help}</div>
      <div style={styles.tagList}>
        {fields.map((f, i) => (
          <Tag key={f} tone="flex" style={styles.fieldTag}>
            <span
              draggable title="Drag to move or reorder" style={styles.fieldTagText}
              onDragStart={e => e.dataTransfer.setData("text/plain", dragPayload(f, name))}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={e => handleDrop(e, i)}
            >
              {allFields[f]?.label || f}
            </span>
            <button type="button" onClick={() => onRemoveField(f, name)} style={styles.tagRemove}
                    aria-label={`Remove ${allFields[f]?.label || f} from ${label}`}>
              <CloseIcon size={12} strokeWidth={2} />
            </button>
          </Tag>
        ))}
        <AddFieldMenu label={label} options={unused.map(k => ({ id: k, label: allFields[k].label }))}
                      onAdd={k => onMoveField(k, null, name)} />
      </div>
    </div>
  );
}

// An "Add field" button opening Ink's menu of the fields that can still go in this section.
export function AddFieldMenu({ label, options, onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  if (!options.length) return null;
  return (
    <div ref={ref} style={styles.addWrap}>
      <Btn small onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
           aria-label={`Add a field to ${label}`} style={styles.addBtn}>
        Add field <Chevron size={14} rotate={open ? 180 : 0} />
      </Btn>
      {open && (
        <div role="menu" aria-label={`Fields to add to ${label}`} className="popin" style={styles.addMenu}>
          {options.map(o => (
            <MenuItem key={o.id} small onClick={() => { onAdd(o.id); setOpen(false); }}>{o.label}</MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  // Ink Tile: flat white surface, subtle border, square corners.
  fieldsPanel: {
    ...sans, width: 280, flexShrink: 0, boxSizing: "border-box", background: PAPER,
    border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 0, padding: 20,
    position: "sticky", top: 12,
  },
  fieldsHeader: { ...sans, fontSize: FS.bodyLg, lineHeight: "24px", fontWeight: 600, color: INK, margin: "0 0 4px" },
  section: { padding: "12px 0", border: "1px solid transparent", borderRadius: 4, margin: "0 -8px", paddingLeft: 8, paddingRight: 8 },
  // Same drop-target signal Ink's selectable card uses for its selected state.
  sectionOver: { background: "var(--ink-color-global-brand-blue-10)", borderColor: "var(--ink-color-global-brand-blue-70)" },
  sectionLabel: { ...sans, fontSize: FS.bodyLg, lineHeight: "20px", fontWeight: 500, color: INK },
  sectionHelp: { ...sans, fontSize: FS.body, lineHeight: "16px", color: FAINT, margin: "2px 0 8px" },
  tagList: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  fieldTag: { gap: 4, paddingRight: 4, maxWidth: "100%" },
  fieldTagText: { overflow: "hidden", textOverflow: "ellipsis", cursor: "grab" },
  tagRemove: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20,
    padding: 0, border: 0, borderRadius: 4, background: "transparent", color: "inherit", cursor: "pointer",
  },
  addWrap: { position: "relative" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 4 },
  addMenu: {
    ...POPOVER_SURFACE, position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 200, maxHeight: 280,
    overflowY: "auto", padding: "4px 0",
  },
  valueList: { display: "flex", flexDirection: "column", gap: 8 },
};
