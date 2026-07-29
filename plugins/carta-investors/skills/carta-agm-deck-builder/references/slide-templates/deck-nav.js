/* deck-nav.js — presentation-mode navigation for AGM decks */
(function () {
  var current = 0;
  var sections = [];
  var counter = null;
  var prevBtn = null;
  var nextBtn = null;
  var fsBtn = null;
  var wrap = null;

  function goto(n) {
    n = Math.max(0, Math.min(n, sections.length - 1));
    if (n === current && sections[current].style.display !== '') return;
    current = n;
    render();
  }

  function render() {
    for (var i = 0; i < sections.length; i++) {
      sections[i].style.display = i === current ? '' : 'none';
    }
    counter.textContent = (current + 1) + ' / ' + sections.length;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === sections.length - 1;
    scaleSlide();
  }

  function scaleSlide() {
    var stage = document.querySelector('deck-stage');
    if (!stage) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight - 48;
    var scale = Math.min(vw / 1920, vh / 1080);
    var offsetX = Math.max(0, (vw - 1920 * scale) / 2);
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.transformOrigin = 'top left';
    stage.style.marginLeft = offsetX + 'px';
    stage.style.marginTop = '0';
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen();
    }
  }

  function onFullscreenChange() {
    if (fsBtn) {
      fsBtn.textContent = document.fullscreenElement ? '⛶ Exit' : '⛶ Present';
    }
    scaleSlide();
  }

  function buildControls() {
    wrap = document.createElement('div');
    wrap.id = 'deck-nav';

    prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.onclick = function () { goto(current - 1); };

    counter = document.createElement('span');
    counter.id = 'deck-nav-counter';

    nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.onclick = function () { goto(current + 1); };

    fsBtn = document.createElement('button');
    fsBtn.textContent = '⛶ Present';
    fsBtn.id = 'deck-nav-fs';
    fsBtn.onclick = toggleFullscreen;

    wrap.appendChild(prevBtn);
    wrap.appendChild(counter);
    wrap.appendChild(nextBtn);
    wrap.appendChild(fsBtn);

    var style = document.createElement('style');
    style.textContent = [
      '#deck-nav {',
      '  position: fixed; bottom: 0; left: 0; right: 0; height: 48px;',
      '  display: flex; align-items: center; justify-content: center; gap: 24px;',
      '  background: rgba(0,0,0,0.85); z-index: 9999;',
      '  font-family: system-ui, -apple-system, sans-serif;',
      '}',
      '#deck-nav button {',
      '  background: none; border: 1px solid rgba(255,255,255,0.3); color: #fff;',
      '  padding: 6px 18px; border-radius: 6px; cursor: pointer;',
      '  font-size: 14px; font-weight: 500; transition: border-color 0.15s;',
      '}',
      '#deck-nav button:hover:not(:disabled) { border-color: #fff; }',
      '#deck-nav button:disabled { opacity: 0.3; cursor: default; }',
      '#deck-nav-counter { color: rgba(255,255,255,0.7); font-size: 14px; min-width: 64px; text-align: center; }',
      '#deck-nav-fs { margin-left: 16px; }',
    ].join('\n');

    document.head.appendChild(style);
    document.body.appendChild(wrap);
  }

  function init() {
    var stage = document.querySelector('deck-stage');
    if (!stage) return;
    sections = Array.prototype.slice.call(stage.querySelectorAll(':scope > section'));
    if (!sections.length) return;

    buildControls();
    goto(0);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goto(current + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goto(current - 1); }
      if (e.key === 'Home') { e.preventDefault(); goto(0); }
      if (e.key === 'End') { e.preventDefault(); goto(sections.length - 1); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    });

    window.addEventListener('resize', scaleSlide);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
