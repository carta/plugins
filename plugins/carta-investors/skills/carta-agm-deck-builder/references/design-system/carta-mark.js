/* =========================================================================
   DESIGN SYSTEM — CARTA MARK
   -------------------------------------------------------------------------
   Guarantees every slide has a "Powered by Carta" footer.

   Two responsibilities:
     1. Inject the Carta SVG into any element with class .carta-mark
        (legacy slot — kept for backwards compatibility).
     2. Auto-add a .ds-chrome-foot ("Powered by " + Carta mark) to every
        <section> inside <deck-stage> that doesn't already have one.

   The SVG inherits color via currentColor → picks up --ds-ink for the
   active slide variant (paper / alt / dark) automatically.

   This module is part of the SYSTEM, not the deck. Decks should NEVER
   inline the Carta SVG or build their own footer — load this script and
   the footer is guaranteed.
   ========================================================================= */

(function () {
  'use strict';

  const CARTA_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 504 252" fill="none" aria-label="Carta">' +
    '<path d="M 0 0 L 0 252 L 504 252 L 504 0 L 0 0 Z M 493.92 241.92 L 10.08 241.92 L 10.08 10.08 L 493.92 10.08 L 493.92 241.92 Z M 66.114 130.915 C 66.114 105.653 87.441 90.825 106.574 90.825 C 120.274 90.825 133.05 95.961 139.884 107.795 L 127.088 115.214 C 124.885 111.885 121.868 109.155 118.334 107.287 C 114.79 105.42 110.839 104.446 106.828 104.476 C 95.575 104.476 82.19 113.255 82.19 130.651 C 82.19 148.048 94.986 156.979 107.894 156.979 C 116.872 156.979 124.326 151.975 128.744 144.252 L 141.824 150.291 C 134.421 163.607 121.188 170.701 105.822 170.701 C 86.496 170.681 66.114 155.832 66.114 130.905 L 66.114 130.915 Z M 188.519 170.701 C 199.152 170.701 209.196 166.012 214.376 159.202 L 214.376 168.57 L 230.178 168.57 L 230.178 92.784 L 214.376 92.784 L 214.376 102.172 C 209.45 95.301 199.173 90.825 188.519 90.825 C 165.243 90.825 148.963 107.764 148.963 130.763 C 148.963 153.762 165.395 170.701 188.519 170.701 Z M 190.043 105.197 C 204.646 105.197 214.67 116.087 214.67 130.763 C 214.67 145.439 204.636 156.329 190.043 156.329 C 175.449 156.329 165.09 145.287 165.09 130.459 C 165.09 115.63 175.439 105.197 190.043 105.197 Z M 315.099 107.825 L 298.697 107.825 L 298.697 92.692 L 315.251 92.692 L 315.251 72.942 L 331.53 72.942 L 331.53 92.692 L 348.074 92.692 L 348.074 107.825 L 331.53 107.825 L 331.53 168.539 L 315.099 168.539 L 315.099 107.825 Z M 393.459 170.701 C 404.112 170.701 414.156 166.012 419.336 159.202 L 419.336 168.57 L 435.158 168.57 L 435.158 92.784 L 419.336 92.784 L 419.336 102.172 C 414.41 95.301 404.133 90.825 393.459 90.825 C 370.203 90.825 353.923 107.764 353.923 130.763 C 353.923 153.762 370.345 170.701 393.459 170.701 Z M 395.003 105.197 C 409.586 105.197 419.64 116.087 419.64 130.763 C 419.64 145.439 409.586 156.329 395.003 156.329 C 380.419 156.329 370.051 145.287 370.051 130.459 C 370.051 115.63 380.399 105.197 395.003 105.197 Z M 265.956 168.468 L 249.524 168.468 L 249.524 92.682 L 264.575 92.682 L 264.575 106.79 C 268.302 98.407 273.897 92.946 282.997 92.49 C 284.876 92.459 286.744 92.49 288.623 92.692 L 288.371 107.856 C 275.301 107.856 265.966 114.859 265.966 134.386 L 265.966 168.478 L 265.956 168.468 Z" fill="currentColor" fill-rule="nonzero"/>' +
    '</svg>';

  function injectIntoSlots(root) {
    (root || document).querySelectorAll('.carta-mark').forEach(function (el) {
      if (!el.firstChild) el.innerHTML = CARTA_SVG;
    });
  }

  function ensureFooter(section) {
    if (section.querySelector('.ds-chrome-foot')) return;
    const foot = document.createElement('div');
    foot.className = 'ds-chrome-foot';
    foot.setAttribute('data-ds-auto-foot', '');
    foot.innerHTML = '<span>Powered by</span><span class="carta-mark">' + CARTA_SVG + '</span>';
    section.appendChild(foot);
  }

  function ensureAllFooters(root) {
    (root || document).querySelectorAll('deck-stage > section, .ds-slide').forEach(ensureFooter);
  }

  function run() {
    injectIntoSlots(document);
    ensureAllFooters(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Expose a manual hook so dynamically-added slides also get the mark.
  window.CartaMark = {
    inject: injectIntoSlots,
    ensureFooter: ensureFooter,
    ensureAllFooters: ensureAllFooters,
    svg: CARTA_SVG
  };
})();
