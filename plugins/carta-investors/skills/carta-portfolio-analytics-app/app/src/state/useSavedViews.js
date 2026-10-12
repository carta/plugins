// Named filter snapshots for a tab whose filters live in one config object.
// The views list sits under `doc[docKey]`, so each tab keeps its own.
import { useState } from "react";

const NO_VIEWS = [];

/** `encode(cfg)` turns the live config into plain JSON for storage; `decode(view)`
 *  turns a stored view back into a full config, filling fields a view lacks from
 *  the defaults. A view is dirty when the live config encodes differently from it.
 *  Returns props for ViewControl. */
export function useSavedViews({ dashboard, docKey, cfg, setCfg, defaults, encode, decode }) {
  const views = dashboard?.doc?.[docKey] || NO_VIEWS;
  const [viewId, setViewId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const current = views.find((v) => v.id === viewId);
  const sig = (c) => JSON.stringify(encode(c));
  const dirty = !!current && sig(cfg) !== sig(decode(current));

  const write = (fn) => dashboard?.update((doc) => { doc[docKey] = fn(doc[docKey] || []); return doc; });
  // "Default" restores the tab's defaults, not just the last-applied view.
  const onApply = (id) => {
    const v = views.find((x) => x.id === id);
    setCfg(v ? decode(v) : defaults);
    setViewId(v ? id : null);
  };
  const onSave = () => {
    const name = newName.trim();
    if (!name) return;
    const id = "v-" + Math.random().toString(36).slice(2, 8);
    write((list) => [...list, { id, name, ...encode(cfg) }]);
    setViewId(id); setSaving(false); setNewName("");
  };
  const onUpdate = () => {
    if (current) write((list) => list.map((v) => (v.id === viewId ? { ...v, ...encode(cfg) } : v)));
  };
  const onDelete = () => {
    if (!current) return;
    write((list) => list.filter((v) => v.id !== viewId));
    setViewId(null);
  };
  return { views, viewId: current ? viewId : null, dirty, onApply, onSave, onUpdate, onDelete, saving, setSaving, newName, setNewName };
}
