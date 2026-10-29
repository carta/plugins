// Which firms the signed-in user can open. A user who is not staff and has one firm is pinned to it:
// the chooser opens it for them and the app offers no way to leave it. Staff search every firm.
export const getJson = (url) =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Not authorized" : `HTTP ${r.status}`))));

export class FirmAccess {
  constructor(isStaff, firms) {
    this.isStaff = isStaff;
    this.firms = firms;
  }

  /** true or false from an /api/me body; null when the server can't tell. */
  static staffFlag(me) {
    return typeof me?.isStaff === "boolean" ? me.isStaff : null;
  }

  static async load() {
    const [me, firms] = await Promise.all([getJson("/api/me"), getJson("/api/firms")]);
    return new FirmAccess(FirmAccess.staffFlag(me), Array.isArray(firms) ? firms : []);
  }

  /** The slug of the one firm a user who is not staff can open, else null. */
  get pinnedFirm() {
    return this.isStaff === false && this.firms.length === 1 ? this.firms[0]?.slug ?? null : null;
  }
}
