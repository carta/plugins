// "What to try next" — four prompt cards, personalized when Carta has
// recommendations for this user and static otherwise.

const CAP_COLORS = ["cap-card-blue", "cap-card-teal", "cap-card-amber", "cap-card-violet"];
const CAP_GRID_SIZE = 4;
const CAP_COPY_ICON =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const CAP_COPY_LABEL = CAP_COPY_ICON + "Copy this prompt";

let _capRecommendations = [];

function capCard(prompt, index) {
  const resolved = resolvePrompt(prompt);
  return `<div class="cap-card ${CAP_COLORS[index % CAP_COLORS.length]}">
    <div class="cap-card-text">${escHtml(resolved)}</div>
    <button class="cap-card-icon" data-prompt="${escHtml(prompt)}">${CAP_COPY_LABEL}</button>
  </div>`;
}

function capCopy(btn) {
  trackHome("click", "CaptableHome.Capabilities.CopyPrompt");
  copyText(resolvePrompt(btn.dataset.prompt), () => {
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.innerHTML = CAP_COPY_LABEL; }, 2000);
  });
}

// Pad to a full grid with static prompts, skipping any whose subject a personalized
// prompt already covers so the user never sees two cards about one thing.
function padWithStaticPrompts(prompts) {
  const haystack = prompts.join(" ").toLowerCase();
  const uncovered = pad => !pad.topics.some(t => haystack.includes(t));
  for (const pass of [uncovered, () => true]) {
    for (const pad of CAP_PROMPTS) {
      if (prompts.length >= CAP_GRID_SIZE) return prompts;
      if (pass(pad) && !prompts.includes(pad.text)) prompts.push(pad.text);
    }
  }
  return prompts;
}

function renderCapabilities() {
  const grid = document.getElementById("cap-grid");
  if (!grid) return;
  const live = _capRecommendations
    .filter(r => r && !r.is_skill_gap && typeof r.recommended_prompt === "string" && r.recommended_prompt.trim())
    .map(r => r.recommended_prompt)
    .slice(0, CAP_GRID_SIZE);
  const prompts = padWithStaticPrompts(live);
  grid.innerHTML = prompts.map(capCard).join("");
  // The whole card copies, not just the button — the card's hover state advertises it.
  grid.querySelectorAll(".cap-card").forEach(card => {
    const btn = card.querySelector(".cap-card-icon");
    card.addEventListener("click", () => capCopy(btn));
  });
}

// Absent or empty recommendations leave the static grid in place, so a firm with no
// personalization still gets four usable prompts.
async function fetchCapabilityRecommendations() {
  let res;
  try {
    res = await _mcp("get_current_user", {});
  } catch (e) {
    return;
  }
  const candidates = _mcpResultCandidates(res);
  const withProfile = candidates.find(c => c && Array.isArray(c.recommendations))
    || candidates.map(c => c && c.profile).find(p => p && Array.isArray(p.recommendations));
  if (!withProfile) return;
  _capRecommendations = withProfile.recommendations;
  renderCapabilities();
}

renderCapabilities();
mcpAvailable().then(live => { if (live) fetchCapabilityRecommendations(); });
