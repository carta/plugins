// The firm the user left from its load-error screen. Root's auto-open skips it for the rest
// of the tab's session: on the Worker, /api/firms lists a Carta staff user's active firm
// alone, and that is usually the firm that failed, so without this "Choose another firm"
// would bounce straight back to it. Picking a firm from the chooser clears it.
import { navigate } from "../route.js";
import { ssGet, ssSet, ssRemove } from "./storage.js";

const KEY = "leftFirm";

export function leaveFirm(firm) {
  ssSet(KEY, firm);
  navigate({ firm: null });
}

export const leftFirm = () => ssGet(KEY);

export const clearLeftFirm = () => ssRemove(KEY);
