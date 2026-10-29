// A firm's URL segment on the Worker is its Carta ID, as in carta-web and Fund Admin: two
// firms can share a name, and the ID names exactly one. The Worker routes only these segments
// as firms, and the app accepts only these as typed Carta IDs.
export const isCartaId = (s) => /^[1-9][0-9]*$/.test(s || "");

export const FIRM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
