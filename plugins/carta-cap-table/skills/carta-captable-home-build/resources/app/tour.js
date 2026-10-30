// ── Guided tour ──
// A first-visit spotlight over the page's main areas. It opens once per browser; finishing, skipping or Escape ends it.
// Depends on captable-home.app.js: trackHome(), prefersReducedMotion().
const TOUR_KEY = 'captable-home-tour-v1';

const TOUR_STEPS = [
  {
    id:    'tab-btn-dashboard',
    title: 'Welcome to Carta Home',
    desc:  "Your company's Carta data, dashboards and skills on one page.",
  },
  {
    id:    'dashboards-section',
    title: 'Your dashboards',
    desc:  "Live views of your company's data from Carta. Open one for the details.",
  },
  {
    id:    'capabilities-section',
    title: 'Suggested for you',
    desc:  'Prompts based on how you use Carta. Fill in the details, then copy one into a chat.',
  },
  {
    // Shown only once get_current_user says what Carta can feature, so the tour leaves it
    // out while the section is hidden.
    id:           'whats-new-section',
    title:        "What's new",
    desc:         'The skills and microapps Carta released most recently.',
    skipIfHidden: true,
  },
  {
    id:    'tab-btn-directory',
    title: 'Skill directory',
    desc:  'Skills and microapps you can use, like issuing equity, checking vesting and seeing how SAFEs convert in a new round.',
  },
];

let _tourIdx = 0;
// The steps this tour walks and counts, fixed when it opens: a section that appears later
// (What's new after a slow profile) is not part of it, so the counter never changes.
let _tourSteps = [];
// Element that had focus when the tour opened, so focus can be handed back on
// exit. The tour auto-starts, so this is usually <body>.
let _tourReturnFocusEl = null;

// A browser that can't read the key can't save it either, so it is treated as seen rather
// than shown the tour on every visit.
function _tourSeen() {
  try { return !!localStorage.getItem(TOUR_KEY); } catch (e) { return true; }
}

function tourStart() {
  if (_tourSeen()) return;
  // Not over the Skill directory tab, where every Home step would point at a hidden pane, and
  // not while the viewer is typing, since the tour takes focus. A later visit opens it instead.
  if (!document.getElementById('tab-dashboard')?.classList.contains('active')) return;
  // Nor over a full-page drill-down: the tour opens only when Home itself is what the viewer sees,
  // and it leaves the key unsaved so a later visit opens it.
  if ([...document.querySelectorAll('.fullpage')].some(p => p.style.display === 'block')) return;
  if (document.activeElement?.closest?.('input, textarea, [contenteditable="true"]')) return;
  trackHome('click', 'CaptableHome.Tour.Start');
  _tourReturnFocusEl = document.activeElement;
  _tourIdx = 0;
  _tourSteps = _tourShownSteps();
  _tourPaint();
}

function _tourIsOpen() {
  // The overlay is the earliest signal: _tourPaint shows it synchronously,
  // whereas the card only fades in near the end of the spotlight's move.
  const overlay = document.getElementById('tour-overlay');
  return !!overlay && overlay.style.display === 'block';
}

// Where the current step sits among the steps this tour shows (-1 when it is skipped).
function _tourPos() {
  return _tourSteps.indexOf(TOUR_STEPS[_tourIdx]);
}

function _tourShownSteps() {
  return TOUR_STEPS.filter(step => !step.skipIfHidden || _tourIsShown(_tourGetEl(step)));
}

// Hidden by attribute, folded away or not shown.
function _tourIsShown(el) {
  return !!el && !el.hidden && !el.inert && el.style.display !== 'none';
}

function _tourGetEl(step) {
  if (step.id)  return document.getElementById(step.id);
  if (step.sel) return document.querySelector(step.sel);
  return null;
}

// The spotlight and card are positioned in page coordinates (position: absolute), so a scroll
// carries them with the content: the cut-out glides between two fixed points on the page while
// the page scrolls, and never chases a moving target.

// Where the spotlight sits now, so the next step can glide from it.
let _tourSpot = null;
// The element the open step points at (null for a centred step), and whether to wrap its children.
let _tourEl = null, _tourFit = false, _tourPaintId = 0;
// Where the page is scrolling to, so the card can be placed before the scroll ends, and
// whether _tourTarget put the card above the cut-out.
let _tourScrollTo = 0, _tourAbove = false;

// Breathing room kept above a section scrolled to the top of the screen.
const TOUR_TOP_ROOM = 24;
// Space between the card and the cut-out, and between the card and the screen edge.
const TOUR_CARD_GAP = 14, TOUR_SCREEN_MARGIN = 12;

// The element's box in page coordinates, or with `fit` the box around its children (the
// a group of cards, not the full-width row they sit in).
function _tourBox(el, fit) {
  const kids  = fit ? [...el.children].map(c => c.getBoundingClientRect()).filter(r => r.width) : [];
  const boxes = kids.length ? kids : [el.getBoundingClientRect()];
  const top = Math.min(...boxes.map(r => r.top)), left = Math.min(...boxes.map(r => r.left));
  return { top: top + window.scrollY, left: left + window.scrollX,
           width: Math.max(...boxes.map(r => r.right)) - left,
           height: Math.max(...boxes.map(r => r.bottom)) - top };
}

// The card's height, measured once it has been shown; a typical height before then.
function _tourCardHeight() {
  return document.getElementById('tour-tooltip').offsetHeight || 220;
}

// Room the card needs beside the cut-out: its height, the gap and the screen margin.
function _tourCardRoom() { return _tourCardHeight() + TOUR_CARD_GAP + TOUR_SCREEN_MARGIN; }

// Where the page should scroll for a step, and the cut-out it shows there, both in page
// coordinates, and whether the card goes above the cut-out. A section is centred when the card fits under it; otherwise it goes to the top
// and the cut-out is cropped to leave the card room below. Near the end of the page, where it
// can't scroll that far, the card goes above if it fits there. With no element the cut-out is
// a zero-size point at the centre, which closes it while the scrim stays on. `at` lays the step
// out for a scroll the page is already at (a resize, which doesn't move the page) instead.
function _tourTarget(el, fit, at) {
  const vw = window.innerWidth, vh = window.innerHeight, p = 8;
  const max = Math.max(0, document.documentElement.scrollHeight - vh);
  if (!el) return { scroll: window.scrollY, above: false,
                    rect: { top: window.scrollY + vh / 2, left: vw / 2, width: 0, height: 0 } };
  const b      = _tourBox(el, fit);
  const room   = _tourCardRoom();
  const h      = b.height + p * 2;
  const want   = h + room <= vh ? b.top - p - (vh - h - room) / 2 : b.top - p - TOUR_TOP_ROOM;
  const scroll = at ?? Math.max(0, Math.min(max, want));
  const top    = b.top - p;
  // Below by default; above only when the end of the page leaves no room below and there is above.
  const above  = scroll + vh - (top + h) < room && top - scroll >= room;
  const bottom = scroll + (above ? vh - TOUR_SCREEN_MARGIN : vh - room);
  return { scroll, above, rect: { top, left: b.left - p, width: b.width + p * 2,
                           height: Math.max(0, Math.min(top + h, bottom) - top) } };
}

function _tourPlaceSpot(rect, ring) {
  const spotlight = document.getElementById('tour-spotlight');
  spotlight.style.top    = rect.top + 'px';
  spotlight.style.left   = rect.left + 'px';
  spotlight.style.width  = rect.width + 'px';
  spotlight.style.height = rect.height + 'px';
  // Scrim + focus ring both come from Ink tokens. Orange is notification-only, so the ring
  // is border-active. A step with no element keeps the scrim and drops the ring.
  spotlight.style.boxShadow = '0 0 0 9999px var(--ink-color-global-surface-background-overlay)'
    + (ring ? ', 0 0 0 2.5px var(--ink-color-global-border-active)' : '');
  _tourSpot = rect;
}

function _tourPaint() {
  const step      = TOUR_STEPS[_tourIdx];
  const shown     = _tourSteps;
  const pos       = _tourPos();
  if (pos < 0) return _tourAdvance();
  const overlay   = document.getElementById('tour-overlay');
  const spotlight = document.getElementById('tour-spotlight');
  const tooltip   = document.getElementById('tour-tooltip');

  // An empty section gets its own copy and a centred card rather than a spotlight on nothing.
  let el     = _tourGetEl(step);
  const desc = !_tourIsShown(el) && step.emptyDesc ? step.emptyDesc : step.desc;
  if (desc === step.emptyDesc) el = null;
  else if (el && step.spotId) el = document.getElementById(step.spotId) || el;

  // The card fades out where it is (riding off with the page), the page scrolls while the
  // cut-out eases to its new place, then the card fades in beside it.
  const opening = overlay.style.display !== 'block';
  overlay.style.display = 'block';
  spotlight.style.display = 'block';
  tooltip.classList.add('tour-tooltip--switching');
  _tourEl  = el;
  _tourFit = !!step.spotId;
  const target = _tourTarget(el, _tourFit);
  _tourScrollTo = target.scroll;
  _tourAbove    = target.above;
  const from   = opening ? _tourTarget(null).rect : _tourSpot;
  // The page scroll and the cut-out run on one clock (the browser's own smooth scroll starts
  // late and runs longer, so the cut-out would lurch the wrong way first). Longer scrolls take
  // a little longer, up to 600ms.
  const reduce     = prefersReducedMotion();
  const fromScroll = window.scrollY;
  const ms    = reduce ? 0 : Math.min(600, 420 + Math.abs(target.scroll - fromScroll) * 0.1);
  const start = performance.now();
  const ease  = t => 1 - Math.pow(1 - t, 3);
  const paint = ++_tourPaintId;
  const to    = target.rect;
  let carded  = false;
  const glide = () => {
    if (paint !== _tourPaintId) return;  // a newer step, or the end, took over
    const t = ms ? Math.min(1, (performance.now() - start) / ms) : 1;
    const k = ease(t);
    window.scrollTo(0, fromScroll + (target.scroll - fromScroll) * k);
    // The ring stays on through the first half of a move to a step with nothing to point at.
    _tourPlaceSpot({ top: from.top + (to.top - from.top) * k, left: from.left + (to.left - from.left) * k,
                     width: from.width + (to.width - from.width) * k,
                     height: from.height + (to.height - from.height) * k }, !!el || k < 0.5);
    // The card starts fading in for the last fifth of the move, already at its final place,
    // so the screen is never long without text.
    if (!carded && t >= 0.8) { carded = true; _tourShowCard(step, desc, pos, shown, to); }
    if (t < 1) requestAnimationFrame(glide);
  };
  requestAnimationFrame(glide);
}

// A resize moves the layout under the tour, so the open step is measured again in place.
function _tourRemeasure() {
  if (!_tourIsOpen()) return;
  const target  = _tourTarget(_tourEl, _tourFit, window.scrollY);
  _tourScrollTo = window.scrollY;
  _tourAbove    = target.above;
  _tourPlaceSpot(target.rect, !!_tourEl);
  _tourPlaceCard();
}
window.addEventListener('resize', _tourRemeasure);

// Under the cut-out, or above it where _tourTarget decided; centred with nothing to point at.
function _tourPlaceCard(r = _tourSpot) {
  const tooltip = document.getElementById('tour-tooltip');
  const ttw = tooltip.offsetWidth || 308, tth = _tourCardHeight();
  const gap = TOUR_CARD_GAP, mv = TOUR_SCREEN_MARGIN;
  const vw  = window.innerWidth, vh = window.innerHeight;
  let top, left;
  if (!_tourEl) {
    top  = _tourScrollTo + (vh - tth) / 2;
    left = (vw - ttw) / 2;
  } else {
    top  = _tourAbove ? r.top - gap - tth : r.top + r.height + gap;
    left = Math.max(mv, Math.min(r.left + r.width / 2 - ttw / 2, vw - ttw - mv));
  }
  tooltip.style.top  = top  + 'px';
  tooltip.style.left = left + 'px';
}

function _tourShowCard(step, desc, pos, shown, rect) {
  const tooltip = document.getElementById('tour-tooltip');
  document.getElementById('tour-title').textContent   = step.title;
  document.getElementById('tour-desc').textContent    = desc;
  document.getElementById('tour-counter').textContent = `${pos + 1} of ${shown.length}`;
  document.getElementById('tour-next-btn').textContent =
    pos < shown.length - 1 ? 'Next →' : 'Finish tour';

  // Progress dots — the container is role="group" aria-label="Tour progress"
  // in the template, so the active dot marks itself as the current step.
  document.getElementById('tour-dots').innerHTML = shown
    .map((_, i) => `<div class="tour-dot${i === pos ? ' active' : ''}"${i === pos ? ' aria-current="step"' : ''}></div>`).join('');

  // Placed while invisible, then faded in.
  tooltip.style.display = 'block';
  _tourPlaceCard(rect);
  requestAnimationFrame(() => tooltip.classList.remove('tour-tooltip--switching'));

  // Hand focus to the primary action so the dialog is keyboard-operable and
  // announced on open. preventScroll: the page is already scrolling to the step,
  // and a second scroll to the button would fight it.
  document.getElementById('tour-next-btn')?.focus({ preventScroll: true });
}

// The only way past a step once the tour is open: the next one, or the end after the last.
function _tourAdvance() {
  _tourIdx++;
  if (_tourIdx >= TOUR_STEPS.length) tourEnd();
  else _tourPaint();
}

// Next (button, Enter or overlay click) moves on only from a step whose card is showing, so a
// quick second press can't skip the step still gliding in. Skip and Escape always work.
function tourNext() {
  if (document.getElementById('tour-tooltip').classList.contains('tour-tooltip--switching')) return;
  trackHome('click', 'CaptableHome.Tour.Next', { value: _tourPos() + 1 });
  _tourAdvance();
}

function tourSkip() { trackHome('click', 'CaptableHome.Tour.Skip', { value: _tourPos() + 1 }); tourEnd(); }

function tourEnd() {
  _tourEl = null;
  _tourPaintId++;
  // A failed save must not leave the viewer stuck behind the overlay.
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
  ['tour-overlay','tour-spotlight','tour-tooltip'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  // Return focus to whatever opened the tour; skip <body> and detached nodes.
  const back = _tourReturnFocusEl;
  _tourReturnFocusEl = null;
  if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') {
    back.focus({ preventScroll: true });
  }
}

// Click the dark overlay to advance
document.getElementById('tour-overlay').addEventListener('click', tourNext);

// Escape ends the tour (dialog semantics — the tooltip is role="dialog").
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  if (!_tourIsOpen()) return;
  e.preventDefault();
  tourEnd();
});

// The tour opens through here and only here, once the profile has settled (answered, failed or
// MCP absent) or the 5s backstop fires, so What's new has usually settled. It opens at most
// once, and tourStart fixes the tour's steps either way.
let _tourReadied = false;
const _tourBackstop = setTimeout(_tourReady, 5000);
function _tourReady() {
  if (_tourReadied) return;
  _tourReadied = true;
  clearTimeout(_tourBackstop);
  tourStart();
}
