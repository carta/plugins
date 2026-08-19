// ── Plugin news row: live content fetched from Carta MCP ── long-comment-ok: sandbox CSP constraint
// Images MUST be data: URIs: the Cowork sandbox CSP is img-src 'self' data:, so
// a ctfassets URL (and client fetch() to it) is blocked — marketing:get:asset_data
// returns the bytes over the MCP bridge instead. The server rewrites any tagged
// blogPost to its parent webPage, so the client only adapts event/webPage/caseStudy.
// Depends on core.js (carta-home.app.js): _mcp(), escHtml(), trackHome().
const NEWS_COUNT = 3; // cards rendered
const NEWS_FETCH = 12; // entries pulled before filter/dedupe/truncate
const NEWS_TAG = "pluginCartaHome"; // fixed metadata taxonomy tag
const NEWS_TAG_SOURCE = "metadata";
// content_type intentionally UNSET so the query spans event/webPage/caseStudy/blogPost.

// Unwrap an MCP call_tool result into the plain object the command returned.
// The command's output is {result: <entry|asset>}; prefer structured_content,
// fall back to JSON in the text content block.
function _unwrap(res) {
  if (!res || res.isError) return null;
  let obj = res.structured_content ?? res.structuredContent ?? null;
  if (obj && obj.result !== undefined) obj = obj.result;
  if (obj) return obj;
  const txt = res.content?.[0]?.text;
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt);
    return parsed.result !== undefined ? parsed.result : parsed;
  } catch (e) {
    return null;
  }
}

// Ask Contentful which entries to show, rather than naming entry IDs here, so
// marketing can change the row without a code change. Returns {items, entries}:
// `entries` is the one-hop linked-entry map (seo entries live here). Read it
// defensively so this works before the server change lands.
async function _listContent() {
  const obj = _unwrap(await _mcp("call_tool", {
    name: "marketing__list__content",
    arguments: {
      tag: NEWS_TAG,
      tag_source: NEWS_TAG_SOURCE,
      limit: String(NEWS_FETCH),
    },
  }));
  return {
    items: Array.isArray(obj?.items) ? obj.items : [],
    entries: obj?.entries && typeof obj.entries === "object" ? obj.entries : {},
  };
}

// Resolve a { sys: { id } } asset link to an <img>-safe data: URI via
// marketing:get:asset_data, which returns the image bytes as a `data_uri`
// (CSP-safe inside the sandbox — see the file header). Returns null if the
// asset can't be resolved so the caller omits the image.
async function _resolveAsset(link) {
  const id = link?.sys?.id;
  if (!id) return null;
  const res = await _mcp("call_tool", {
    name: "marketing__get__asset_data",
    arguments: { asset_id: id },
  });
  const obj = _unwrap(res);
  return obj?.data_uri ?? obj?.dataUri ?? null;
}

// ── seo helpers ── the linked seo entry carries eyebrow/description/image for
// event and webPage; it is resolved by id from the `entries` map.
function _seoEntry(f, entries) {
  const id = f?.seo?.sys?.id;
  return (id && entries[id]?.fields) || {};
}
function _seoField(f, entries, key) {
  const v = _seoEntry(f, entries)[key];
  return typeof v === "string" ? v.trim() : "";
}
function _seoLink(f, entries, key) {
  const v = _seoEntry(f, entries)[key];
  return v?.sys?.id ? v : null;
}

// ── snippet helpers ── curated-first: only extract RichText when nothing
// curated exists. _richText walks a RichText body, skips non-paragraph nodes
// (a body can open with an embedded-entry-block), and returns the first
// paragraph's text. _plainSnippet trims/truncates an already-plain string.
const _SNIPPET_MAX = 120;
function _truncate(s) {
  const t = String(s || "").trim();
  return t.length > _SNIPPET_MAX ? t.slice(0, _SNIPPET_MAX).trimEnd() + "…" : t;
}
function _plainSnippet(s) {
  return _truncate(s);
}
function _richText(rt) {
  const nodes = Array.isArray(rt?.content) ? rt.content : [];
  for (const node of nodes) {
    if (node?.nodeType !== "paragraph") continue;
    const text = (node.content || [])
      .map((c) => (typeof c?.value === "string" ? c.value : ""))
      .join("")
      .trim();
    if (text) return _truncate(text);
  }
  return "";
}

// Null-safe timestamp: a missing/bad date sorts to 0 (end of the row).
const _ts = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; };

// Format a sortDate to e.g. "Jul 29, 2026", or "" when there is no valid date.
function _dateLabel(sortDate) {
  const t = _ts(sortDate);
  if (!t) return "";
  try {
    return new Date(t).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch (e) {
    return "";
  }
}

// ── adapters ── content_type id → normalized card. Each is pure (no I/O);
// image links are resolved later, after truncation. `webPage` also serves every
// tagged blogPost, which the server rewrote to its parent webPage.
const ADAPTERS = {
  caseStudy(f, entries) {
    const date = f.displayDate || "";
    return {
      contentType: "caseStudy",
      eyebrow: (f.displayTag || "").trim(),
      headline: (f.companyName || "").trim(),
      snippet: _plainSnippet(f.featuredDescription) ||
        _plainSnippet(_seoField(f, entries, "description")) ||
        _richText(f.body),
      url: f.slug ? `https://carta.com/customer-stories/${encodeURIComponent(f.slug)}/` : "",
      ctaLabel: "Read more →",
      sortDate: date,
      dateLabel: _dateLabel(date),
      featuredImageLink: f.featuredImage || null,
      logoImageLink: f.logoImage || null,
      seoImageLink: _seoLink(f, entries, "image"),
      _required: [f.companyName, f.slug],
    };
  },
  event(f, entries) {
    const date = f.startTime || "";
    return {
      contentType: "event",
      eyebrow: _seoField(f, entries, "eyebrow") || "Virtual Event",
      headline: (f.title || "").trim(),
      snippet: _plainSnippet(_seoField(f, entries, "description")) || _richText(f.description),
      url: f.slug ? `https://carta.com/events/${encodeURIComponent(f.slug)}/` : "",
      ctaLabel: "Watch recording →",
      sortDate: date,
      dateLabel: _dateLabel(date),
      featuredImageLink: f.thumbnailImage || f.featuredImage || null,
      logoImageLink: null,
      seoImageLink: null,
      _required: [f.title, f.slug],
    };
  },
  webPage(f, entries) {
    const date = f.displayDate || "";
    // fullSlug is already path-prefixed (e.g. "learn/equity/stock-options");
    // keep its slashes, so trim only leading/trailing ones — no encodeURIComponent.
    const slug = String(f.fullSlug || "").replace(/^\/|\/$/g, "");
    return {
      contentType: "webPage",
      eyebrow: _seoField(f, entries, "eyebrow"),
      headline: (f.displayTitle || "").trim(),
      snippet: _plainSnippet(_seoField(f, entries, "description")),
      url: slug ? `https://carta.com/${slug}/` : "",
      ctaLabel: "Read more →",
      sortDate: date,
      dateLabel: _dateLabel(date),
      featuredImageLink: f.featuredImage || null,
      logoImageLink: null,
      seoImageLink: _seoLink(f, entries, "image"),
      _required: [f.displayTitle, f.fullSlug],
    };
  },
};

// Pure pipeline: adapt → drop archived → drop malformed → dedupe → sort →
// truncate. Assets are resolved after truncate, so no wasted asset_data calls.
function _buildCards(items, entries) {
  const seen = new Set();
  return items
    .map((e) => {
      const adapt = e && e.fields && ADAPTERS[e.content_type];
      return adapt ? adapt(e.fields, entries) : null; // unmapped/unknown → dropped
    })
    .filter(Boolean)
    .filter((c) => !c.headline.toLowerCase().startsWith("[archived]"))
    .filter((c) => c.url && c._required.every((v) => String(v || "").trim()))
    .filter((c) => {
      const key = c.headline.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false; // webPage/blogPost structural dupe
      seen.add(key);
      return true;
    })
    .sort((a, b) => _ts(b.sortDate) - _ts(a.sortDate))
    .slice(0, NEWS_COUNT);
}

async function fetchLiveContent() {
  // The template ships static Plugin news cards. Replace them only once live cards
  // exist; on any failure / no bridge / empty result, keep the static cards.
  const grid = document.getElementById("plugin-news-grid");
  if (!grid) return;
  if (!window.cowork?.callMcpTool) return;

  try {
    const { items, entries } = await _listContent();
    if (!items.length) return;

    const built = _buildCards(items, entries);
    if (!built.length) return;

    const cards = await Promise.all(built.map(async (c) => {
      const [featured, logo, seoImage] = await Promise.all([
        _resolveAsset(c.featuredImageLink),
        _resolveAsset(c.logoImageLink),
        _resolveAsset(c.seoImageLink),
      ]);
      const featuredUrl = featured || seoImage || null;
      return {
        ...c,
        featuredUrl,
        logoUrl: logo || null,
      };
    }));
    renderLiveContent(cards);
  } catch (err) {
    console.error("[live-content] live fetch failed — keeping static cards", err);
  }
}

// Render live content cards in the `.plugin-news-card` markup so they match the
// surrounding design. Only called with >=1 card.
function renderLiveContent(cards) {
  const grid = document.getElementById("plugin-news-grid");
  if (!grid || !cards || !cards.length) return;

  grid.innerHTML = "";
  cards.forEach((cs) => {
    const card = document.createElement("a");
    card.className = "plugin-news-card";
    card.href = cs.url;
    card.target = "_blank";
    card.rel = "noopener";
    // A logo whose asset URL 404/403s removes its own chip via onerror. The server
    // backfills a fallback image, so --fake shows only if that fallback also fails.
    const thumb = cs.featuredUrl
      ? `<div class="plugin-news-thumb plugin-news-thumb--overlay">
           <img src="${cs.featuredUrl}" alt="${escHtml(cs.headline)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
           ${cs.logoUrl ? `<div class="cs-logo-chip"><img src="${cs.logoUrl}" alt="${escHtml(cs.headline)} logo" loading="lazy" onerror="this.closest('.cs-logo-chip').remove()" /></div>` : ""}
         </div>`
      : `<div class="plugin-news-thumb plugin-news-thumb--fake"></div>`;
    card.innerHTML = `
      ${thumb}
      <div class="plugin-news-content">
        ${cs.eyebrow ? `<span class="plugin-news-tag">${escHtml(cs.eyebrow)}</span>` : ""}
        <p class="plugin-news-title">${escHtml(cs.headline)}</p>
        <p class="plugin-news-desc">${escHtml(cs.snippet)}</p>
        ${cs.ctaLabel ? `<span class="plugin-news-cta">${escHtml(cs.ctaLabel)}</span>` : ""}
      </div>`;
    card.addEventListener("click", () => trackHome("click", "CartaHome.CustomerStories.ReadMore"));
    grid.appendChild(card);
  });
}

fetchLiveContent();
