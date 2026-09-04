// The refresh cart — who is in this cycle.
//
// Pure, no React. One boolean per employee: in the cart or not. There is no
// separate "removed" state — unchecking IS removing, and a row the user unchecked
// is indistinguishable from one they never checked. That keeps the model small
// enough to reason about, and it is what the design asks for.
//
// The "N added · N removed" chip is NOT a third state either: it is the diff
// between the working cart and the last saved one, computed on demand by `diff`
// below. Nothing needs to be stored to know it.
//
// Ids are `external_id` — the key every row, the CSV export and the scenario file
// already use.

/** Toggle one employee. Returns a NEW Set; never mutates the argument.
 *
 *  A new Set rather than an in-place add/delete because React compares by
 *  identity — mutating and returning the same Set renders nothing.
 */
export function toggle(cart, id) {
  const next = new Set(cart);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Add every visible row to the cart, leaving anything already there untouched.
 *
 *  Scoped to the rows PASSED IN, which the caller sets to the filtered view. A
 *  select-all that reached past the filters would add people the user has not
 *  looked at — the header control has to mean what is on screen.
 */
export function addAll(cart, visibleIds) {
  const next = new Set(cart);
  for (const id of visibleIds) next.add(id);
  return next;
}

/** Remove every visible row from the cart, leaving hidden selections alone.
 *
 *  The mirror of `addAll`: unticking the header clears what is on screen, not
 *  someone's whole cart. A user who filtered to Engineering and unticked the
 *  header means "not these", not "start over".
 */
export function removeAll(cart, visibleIds) {
  const next = new Set(cart);
  for (const id of visibleIds) next.delete(id);
  return next;
}

/** "all" | "some" | "none" — drives the header checkbox's tri-state.
 *
 *  `indeterminate` is not a React prop; the caller sets it on the DOM node via a
 *  ref. Returning a string rather than a boolean pair keeps that decision in one
 *  place and makes the "some" case impossible to forget.
 *
 *  An empty view is "none", not "all": a checked header over zero rows would
 *  claim a selection that does not exist.
 */
export function headerState(cart, visibleIds) {
  if (!visibleIds.length) return "none";
  let inCart = 0;
  for (const id of visibleIds) if (cart.has(id)) inCart += 1;
  if (inCart === 0) return "none";
  return inCart === visibleIds.length ? "all" : "some";
}

/** How many cart members the current filters are hiding.
 *
 *  Surfaced in the UI because a cart of 12 next to 9 ticked rows reads as a bug.
 *  The cart is the plan; the filters are a viewfinder onto it.
 */
export function hiddenCount(cart, visibleIds) {
  const visible = new Set(visibleIds);
  let hidden = 0;
  for (const id of cart) if (!visible.has(id)) hidden += 1;
  return hidden;
}

/** Change since the last save: { added, removed }.
 *
 *  Both counts, not a single net number — "2 added · 1 removed" and "1 added"
 *  describe different edits and a net of +1 hides that.
 */
export function diff(cart, saved) {
  const base = saved || new Set();
  let added = 0;
  let removed = 0;
  for (const id of cart) if (!base.has(id)) added += 1;
  for (const id of base) if (!cart.has(id)) removed += 1;
  return { added, removed };
}

/** Drop cart ids that are no longer in the data, reporting what went.
 *
 *  A rebuild can retire an employee — they left, or the scorecard sweep changed.
 *  Silently dropping them would shrink a plan without telling anyone; keeping
 *  them would carry a ghost into a grant cycle. So: drop, and hand back the count
 *  for the caller to surface.
 */
export function reconcile(cart, knownIds) {
  const known = new Set(knownIds);
  const kept = new Set();
  let dropped = 0;
  for (const id of cart) {
    if (known.has(id)) kept.add(id);
    else dropped += 1;
  }
  return { cart: kept, dropped };
}

/** The cart's rows, in the order the caller's list already has them.
 *
 *  Filtering the full list rather than mapping over the cart: the cart is a Set
 *  and has no order of its own, and the panel should read in the same order as
 *  the table beside it.
 */
export function cartRows(allRows, cart) {
  return (allRows || []).filter((r) => cart.has(r.external_id));
}
