// "What's new" — recently shipped cap-table capabilities, from WHATS_NEW in the config.

function renderWhatsNew() {
  const grid = document.getElementById("whats-new-grid");
  const section = document.getElementById("whats-new-section");
  if (!grid || !section) return;
  if (!Array.isArray(WHATS_NEW) || !WHATS_NEW.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  grid.innerHTML = WHATS_NEW.map(item => `
    <div class="wn-card">
      <div class="wn-card-header"><span class="wn-tag">${escHtml(item.tag)}</span></div>
      <div class="wn-card-title">${escHtml(item.title)}</div>
      <div class="wn-card-body">${escHtml(item.body)}</div>
      <button class="wn-copy-btn" data-prompt="${escHtml(item.prompt)}">Copy this prompt</button>
    </div>
  `).join("");
  grid.querySelectorAll(".wn-copy-btn").forEach(btn => {
    btn.addEventListener("click", () => whatsNewCopy(btn));
  });
}

function whatsNewCopy(btn) {
  trackHome("click", "CaptableHome.WhatsNew.CopyPrompt");
  copyText(resolvePrompt(btn.dataset.prompt), () => {
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.textContent = "Copy this prompt"; }, 2000);
  });
}

renderWhatsNew();
