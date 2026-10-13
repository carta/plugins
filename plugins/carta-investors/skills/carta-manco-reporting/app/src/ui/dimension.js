// Which Carta field a firm's budget breaks out by.

// A budget column can be scoped by anything Carta puts on a journal entry,
// not only a reporting tag: one firm breaks out by team tag, the next by
// sub-account, the next by vendor. Resolved from the firm's own data at
// ingest and carried in the snapshot; null means unresolved, and scoping
// nothing beats guessing an axis.
export function dimensionOf(snapshot) {
  if (snapshot?.dimension) return snapshot.dimension;
  // Recorded before a dimension could be anything but a tag.
  if (snapshot?.tagCategory) {
    return { source: "reporting_tag", category: snapshot.tagCategory };
  }
  return null;
}

// The entry's value for the configured dimension, or null. One reader for
// every scoping site, so adding a source never means hunting for the
// places that reach into `tags` directly.
export function dimensionValue(entry, dimension) {
  if (!dimension || !entry) return null;
  switch (dimension.source || "reporting_tag") {
    case "reporting_tag": {
      if (!dimension.category) return null;
      const t = (entry.tags || []).find(x => x.category === dimension.category);
      return t ? t.value : null;
    }
    case "sub_account": return entry.sub || null;
    case "vendor":      return entry.vendor || null;
    // A sub-account subdivides one account, so this names both. A line
    // booked to the account itself keeps the plain name.
    case "account":     return dimension.withSub && entry.sub
                          ? `${entry.account} · ${entry.sub}`
                          : (entry.account || null);
    default:            return null;
  }
}

// What to call the dimension on screen. A firm that separates its budget
// by team, fund or cost centre should read its own word back, not
// "Department" — which is one firm's category name that reached the copy
// because theirs was the first workbook of this shape.
//
// A reporting tag answers with the category the firm named it; the other
// sources have no client-chosen name, so they answer with Carta's.
export function dimensionLabel(dimension, fallback = "Category") {
  if (!dimension) return fallback;
  switch (dimension.source || "reporting_tag") {
    case "reporting_tag": return dimension.category || fallback;
    case "sub_account":   return "Sub-account";
    case "vendor":        return "Vendor";
    case "account":       return "GL account";
    default:              return fallback;
  }
}

/** The same name for "show all N of them". */
export function dimensionLabelPlural(dimension, fallback = "Category") {
  const one = dimensionLabel(dimension, fallback);
  // A category already written plural ("Sales", "Operations") is left as
  // the firm wrote it.
  return /s$/i.test(one) ? one : `${one}s`;
}

/** What a breakout's leftover row is called: the spend carrying no value
 *  of the dimension it was broken out by.
 *
 *  Named after the dimension rather than a bare "Not specified", which
 *  says nothing about WHAT was not specified — under a vendor breakout and
 *  a tag breakout it read identically, and a reader looking at the row a
 *  quarter later had to remember which axis they had picked.
 */
export function noValueLabel(dimension, fallback = "Category") {
  return `No associated ${inlineCase(dimensionLabel(dimension, fallback))}`;
}

// Lowercased for mid-sentence use, except where the firm's own word is an
// acronym or starts with one ("TAGS", "GL account") — lowercasing those
// makes them read as a typo rather than a category.
function inlineCase(label) {
  if (/^[A-Z]{2}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

// Which dimension a row's own reporting-tag value should be read off an
// entry with: the row's own reporting-tag scope first — the mapping step's
// own answer for that one line or column, carrying its own category — else
// the shared dimension the workbook resolved at ingest. A dimension the
// workbook never resolved (null) must never zero out, or un-filter, a row
// that carries its own scope: that scope is the row's own answer and
// doesn't depend on the shared axis existing at all.
//
// Returns a dimension descriptor ({source, category}, usually also the
// matched `value` when it came from the row's own scope) for `dimensionValue`
// to read an entry with — not the set of values a row's figure accepts,
// which callers derive from their own tag_value/carta_tags plus the
// firm's aliases.
//
// Mirrors the Python build's own precedence (build_manco_datadir.py's
// `scoped_total`, which prefers a line's own `scopes` over the configured
// dimension) so the outline and the variance chart agree on which rows are
// department-wide and which are narrower than that.
export function rowTagScope(row, dimension, tagValuesAvailable) {
  if (!tagValuesAvailable) return null;
  const own = (row?.scopes || []).find(sc => sc.source === "reporting_tag");
  if (own) return own;
  return dimension || null;
}

// Whether any entry carries a value for this dimension. False means scoped
// rows must report firm-wide — scoping against a field the firm never
// populates shows every column as $0, which reads as spend that never
// happened.
export function dimensionValuesAvailable(data) {
  const now = data?.tagValuesAvailable;
  if (now !== undefined) return now !== false;
  // A snapshot written before the rename carries the old key.
  return data?.departmentTagAvailable !== false;
}
