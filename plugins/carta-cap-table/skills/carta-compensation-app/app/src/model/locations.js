// The Benchmarks tab's locations, as the CTC product's Benchmarks page presents them.
//
// Two lists. `locationCatalog` is every location the plan supports, as the product
// lists them; picking one the build didn't sweep asks the local server to fetch it
// (scripts/location_fetch.py). `locations` holds the sweeps that exist: the build's
// own, for where the corporation's employees are benchmarked. Every row shown came
// back from the server with that location applied. Nothing in this file computes a
// figure: the scalars are shown as labels ("Pay adjustment 70%"), never multiplied
// into a number. See build_datadir.py for why.

export const DEFAULT_KEY = "default";

const GROUP_US = "US metros";
const GROUP_INTL = "International markets";

// International locations come back labelled by ISO alpha-3 code ("GBR"). The
// product shows the country name; Intl.DisplayNames wants alpha-2, so this maps
// the codes CTC benchmarks. An unknown code shows as itself rather than guessing.
const ALPHA3_TO_ALPHA2 = {
  ARE: "AE", AUS: "AU", AUT: "AT", BEL: "BE", BGR: "BG", BRA: "BR", CAN: "CA",
  CHE: "CH", CHL: "CL", CHN: "CN", COL: "CO", CRI: "CR", CZE: "CZ", DEU: "DE",
  DNK: "DK", EGY: "EG", ESP: "ES", EST: "EE", FIN: "FI", FRA: "FR", GBR: "GB",
  GRC: "GR", HKG: "HK", HRV: "HR", HUN: "HU", IDN: "ID", IND: "IN", IRL: "IE",
  ISR: "IL", ITA: "IT", JPN: "JP", KEN: "KE", KOR: "KR", LTU: "LT", LUX: "LU",
  LVA: "LV", MEX: "MX", MYS: "MY", NGA: "NG", NLD: "NL", NOR: "NO", NZL: "NZ",
  PAK: "PK", PER: "PE", PHL: "PH", POL: "PL", PRT: "PT", ROU: "RO", SGP: "SG",
  SRB: "RS", SVK: "SK", SVN: "SI", SWE: "SE", THA: "TH", TUR: "TR", TWN: "TW",
  UKR: "UA", URY: "UY", USA: "US", VNM: "VN", ZAF: "ZA",
};

let regionNames = null;
function countryName(alpha3) {
  const alpha2 = ALPHA3_TO_ALPHA2[alpha3];
  if (!alpha2) return alpha3;
  try {
    regionNames = regionNames || new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(alpha2) || alpha3;
  } catch {
    return alpha3;
  }
}

/** What the user reads for a location: the catalog's name, the server's metro
 *  label, or the country name for an alpha-3 label. */
export function displayName(loc) {
  if (loc?.catalogLabel) return loc.catalogLabel;
  const label = loc?.label || "";
  return /^[A-Z]{3}$/.test(label) ? countryName(label) : label;
}

const pct = (s) => (s == null ? null : `${Math.round(Number(s) * 100)}%`);

/** The adjustment badges the product shows beside a location.
 *
 *  US metros get one "Pay adjustment" figure; the product reads it off the equity
 *  scalar, which equals the salary one for every US metro. International markets
 *  (Canadian metros included) get separate salary and equity figures, because
 *  their two scalars differ.
 */
export function adjustmentChips(loc) {
  if (!loc) return [];
  const where = displayName(loc);
  if (loc.international) {
    return [
      { text: `Salary int'l adjustment ${pct(loc.salaryScalar)}`,
        title: `Salary benchmarks for ${where} are ${pct(loc.salaryScalar)} of the US top market.` },
      { text: `Equity int'l adjustment ${pct(loc.equityScalar)}`,
        title: `Equity benchmarks for ${where} are ${pct(loc.equityScalar)} of the US top market.` },
    ].filter((c) => !c.text.endsWith("null"));
  }
  const s = pct(loc.equityScalar ?? loc.salaryScalar);
  return s ? [{
    text: `Pay adjustment ${s}`,
    title: `Target compensation is adjusted to ${s} of the US top market rate for ${where}.`,
  }] : [];
}

/** Dropdown options: US metros, then international markets, each sorted by name. */
export function locationOptions(locations) {
  const list = (locations || []).map((loc) => ({
    value: loc.key,
    label: displayName(loc) + (loc.default ? " — default" : ""),
    group: loc.international ? GROUP_INTL : GROUP_US,
    sortName: displayName(loc).toLowerCase(),
  }));
  const byGroup = (g) => list.filter((o) => o.group === g)
    .sort((a, b) => a.sortName.localeCompare(b.sortName));
  return [...byGroup(GROUP_US), ...byGroup(GROUP_INTL)]
    .map(({ sortName, ...o }) => o);
}

/** The location entry for `key`, falling back to the default. */
export function findLocation(locations, key) {
  const list = locations || [];
  return list.find((l) => l.key === key) || list.find((l) => l.default) || null;
}

// The product caps a typed search at 15 matches; with the box empty it lists all.
export const SEARCH_LIMIT = 15;

/** Picker options from the catalog: US metros, then international markets, by name.
 *  `value` is the export's `location` parameter, which is also what identifies a
 *  build-time sweep in `locations`. */
export function catalogOptions(catalog, defaultLocation) {
  const list = (catalog || []).map((c) => ({
    value: c.location,
    label: c.label + (c.location === defaultLocation ? " — default" : ""),
    name: c.label,
    group: c.international ? GROUP_INTL : GROUP_US,
    international: !!c.international,
    currency: c.currency || null,
  }));
  const byGroup = (g) => list.filter((o) => o.group === g)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...byGroup(GROUP_US), ...byGroup(GROUP_INTL)];
}

/** Options matching `query`, grouped as listed: names starting with it first, then
 *  names containing it, at most `limit`. An empty query returns every option. */
export function searchOptions(options, query, limit = SEARCH_LIMIT) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return options;
  const name = (o) => (o.name || o.label).toLowerCase();
  const starts = options.filter((o) => name(o).startsWith(q));
  const contains = options.filter((o) => !name(o).startsWith(q) && name(o).includes(q));
  const picked = [...starts, ...contains].slice(0, limit);
  return [...picked.filter((o) => o.group === GROUP_US),
    ...picked.filter((o) => o.group !== GROUP_US)];
}

/** Cache key for one fetched (location, currency, peer group), matching serve.py's. */
export function fetchKey(location, localCurrency, peer, ownPeer) {
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
  return slug(location) + (localCurrency ? "-local" : "")
    + (peer && peer !== ownPeer ? `--${slug(peer)}` : "");
}
