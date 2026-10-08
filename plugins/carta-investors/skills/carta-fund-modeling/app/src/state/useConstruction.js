import { useState, useEffect, useRef, useCallback } from "react";
import useEtagAutosave from "./useEtagAutosave.js";
import { emptyDoc, activePlan, normalizePlan } from "../model/construction/plan.js";

export default function useConstruction(firm) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [doc, setDoc] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [loadFailed, setLoadFailed] = useState(false);
  // The latest doc, so an edit builds on the one before it without a side-effecting setDoc updater.
  const docRef = useRef(null);
  const show = useCallback((d) => { docRef.current = d; setDoc(d); }, []);
  // Another tab saved first: take its version rather than overwrite it.
  const { schedule, flush, reset, hasPending } = useEtagAutosave(`/api/construction${q}`, { onConflict: () => load(), onState: setSaveState });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/construction${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      reset(r.headers.get("etag"));
      // Plans get any section they lack, so every step can open them.
      show(Array.isArray(body?.plans) ? { ...body, plans: body.plans.map(normalizePlan) } : emptyDoc());
      setLoadFailed(false);
    } catch {
      // Showing an empty doc here would let the next save replace every stored plan.
      setLoadFailed(true);
    }
  }, [q, show, reset]);
  useEffect(() => { load(); }, [load]);

  // Leaving the tab saves at once instead of waiting out the debounce.
  useEffect(() => () => { if (hasPending()) flush(); }, [flush, hasPending]);

  /** `fn` edits a copy of the doc; returning null makes it a no-op. */
  const mutate = useCallback((fn) => {
    if (!docRef.current) return;
    const next = fn(structuredClone(docRef.current));
    if (next == null) return;
    show(next);
    schedule(next);
  }, [schedule, show]);

  const addPlan = useCallback((plan) => mutate((d) => {
    d.plans.push(plan);
    d.activePlanId = plan.id;
    return d;
  }), [mutate]);

  const selectPlan = useCallback((id) => mutate((d) => (d.activePlanId === id ? null : { ...d, activePlanId: id })), [mutate]);

  const updatePlan = useCallback((fn) => mutate((d) => {
    const p = activePlan(d);
    if (!p) return null;
    fn(p);
    p.updatedAt = new Date().toISOString();
    return d;
  }), [mutate]);

  const renamePlan = useCallback((id, name) => mutate((d) => {
    const p = d.plans.find((x) => x.id === id);
    if (!p || !name.trim()) return null;
    p.name = name.trim();
    return d;
  }), [mutate]);

  const deletePlan = useCallback((id) => mutate((d) => {
    d.plans = d.plans.filter((x) => x.id !== id);
    if (d.activePlanId === id) d.activePlanId = d.plans[0]?.id ?? null;
    return d;
  }), [mutate]);

  return { doc, plan: activePlan(doc), saveState, loadFailed, addPlan, selectPlan, updatePlan, renamePlan, deletePlan, reload: load };
}
