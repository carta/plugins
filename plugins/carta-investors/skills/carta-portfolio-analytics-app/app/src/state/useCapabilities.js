import { useEffect, useState } from "react";

/** /api/capabilities, or null until it answers and whenever it fails. A Worker whose session
 *  ended answers 401 with an error body, which is no answer about the runtime at all. */
export default function useCapabilities() {
  const [caps, setCaps] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/capabilities").then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (alive && c) setCaps(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return caps;
}
