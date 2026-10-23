/** Resolve once the service worker controls the page. `container` is navigator.serviceWorker.
 *  A browser that never fires controllerchange gets `reload` after `backstopMs`, and the promise
 *  stays pending so nothing starts on a page about to unload. */
export function waitForControl(container, reload, backstopMs = 3000) {
  if (container.controller) return Promise.resolve();
  return new Promise((resolve) => {
    const backstop = setTimeout(reload, backstopMs);
    container.addEventListener("controllerchange", () => {
      clearTimeout(backstop);
      resolve();
    }, { once: true });
  });
}
