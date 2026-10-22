import useCapabilities from "./useCapabilities.js";

/** Whether the app is served by the hosted Worker (true) or the local serve.py (false); null
 *  while that is not known, because /api/capabilities is still loading or failed. serve.py
 *  always answers, and without a `worker` key. Copy that tells the user to ask Claude only
 *  fits the local app, where Claude launched it. */
export default function useIsWorker() {
  const caps = useCapabilities();
  return caps ? !!caps.worker : null;
}
