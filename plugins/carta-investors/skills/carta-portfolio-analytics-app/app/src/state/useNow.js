import { useState, useEffect } from "react";

/** Re-render on an interval so relative-time labels ("6m ago") stay current without a
 *  manual refresh. Returns the current epoch ms (usable, but the point is the re-render).
 *  Keep the caller small — every tick re-renders whoever calls this. */
export default function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
