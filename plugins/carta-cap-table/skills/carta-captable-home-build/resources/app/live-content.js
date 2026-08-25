// ── Plugin news row: live Carta content over the MCP bridge ── long-comment-ok: sandbox CSP constraint
// Images MUST be data: URIs: the sandbox CSP is img-src 'self' data:, so a ctfassets
// URL (and a client fetch() to it) is blocked — marketing:get:asset_data returns the
// bytes over the bridge instead. The server rewrites any tagged blogPost to its parent
// webPage, so the client only adapts event/webPage/caseStudy.
// Depends on captable-home.app.js: _mcp(), escHtml(), trackHome().
const NEWS_COUNT = 3;  // cards rendered
const NEWS_FETCH = 12; // entries pulled before filter/dedupe/truncate
const NEWS_TAG_SOURCE = "metadata";
// content_type intentionally UNSET so the query spans event/webPage/caseStudy/blogPost.

// The command returns {result: <entry|asset>}; prefer the structured payload and fall back
// to JSON in the text block.
function _newsUnwrap(res) {
  if (!res || res.isError) return null;
  let obj = res.payload ?? res.structured_content ?? res.structuredContent ?? null;
  if (obj && obj.result !== undefined) obj = obj.result;
  if (obj) return obj;
  const txt = res.content?.[0]?.text;
  if (!txt) return null;
  const parsed = tryParse(txt);
  if (!parsed) return null;
  return parsed.result !== undefined ? parsed.result : parsed;
}

// Ask Contentful which entries to show rather than naming entry ids here, so marketing
// can change the row without a code change. `entries` is the one-hop linked-entry map.
async function _listNewsContent() {
  const obj = _newsUnwrap(await _mcp("call_tool", {
    name: "marketing__list__content",
    arguments: { tag: NEWS_TAG, tag_source: NEWS_TAG_SOURCE, limit: String(NEWS_FETCH) },
  }));
  return {
    items: Array.isArray(obj?.items) ? obj.items : [],
    entries: obj?.entries && typeof obj.entries === "object" ? obj.entries : {},
  };
}

// Returns null when the asset can't be resolved, so the caller omits the image.
async function _resolveNewsAsset(link) {
  const id = link?.sys?.id;
  if (!id) return null;
  const obj = _newsUnwrap(await _mcp("call_tool", {
    name: "marketing__get__asset_data",
    arguments: { asset_id: id },
  }));
  return obj?.data_uri ?? obj?.dataUri ?? null;
}

// The linked seo entry carries eyebrow/description/image, resolved by id from `entries`.
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

const _SNIPPET_MAX = 120;
function _truncateSnippet(s) {
  const t = String(s || "").trim();
  return t.length > _SNIPPET_MAX ? t.slice(0, _SNIPPET_MAX).trimEnd() + "…" : t;
}
// A RichText body can open with an embedded-entry-block, so skip to the first paragraph.
function _richTextSnippet(rt) {
  const nodes = Array.isArray(rt?.content) ? rt.content : [];
  for (const node of nodes) {
    if (node?.nodeType !== "paragraph") continue;
    const text = (node.content || [])
      .map(c => (typeof c?.value === "string" ? c.value : ""))
      .join("")
      .trim();
    if (text) return _truncateSnippet(text);
  }
  return "";
}

// A missing or bad date sorts to 0, i.e. the end of the row.
const _newsTs = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; };

const NEWS_ADAPTERS = {
  caseStudy(f, entries) {
    return {
      eyebrow: (f.displayTag || "").trim(),
      headline: (f.companyName || "").trim(),
      snippet: _truncateSnippet(f.featuredDescription)
        || _truncateSnippet(_seoField(f, entries, "description"))
        || _richTextSnippet(f.body),
      url: f.slug ? `https://carta.com/customer-stories/${encodeURIComponent(f.slug)}/` : "",
      ctaLabel: "Read more →",
      sortDate: f.displayDate || "",
      featuredImageLink: f.featuredImage || null,
      logoImageLink: f.logoImage || null,
      seoImageLink: _seoLink(f, entries, "image"),
      _required: [f.companyName, f.slug],
    };
  },
  event(f, entries) {
    return {
      eyebrow: _seoField(f, entries, "eyebrow") || "Virtual Event",
      headline: (f.title || "").trim(),
      snippet: _truncateSnippet(_seoField(f, entries, "description")) || _richTextSnippet(f.description),
      url: f.slug ? `https://carta.com/events/${encodeURIComponent(f.slug)}/` : "",
      ctaLabel: "Watch recording →",
      sortDate: f.startTime || "",
      featuredImageLink: f.thumbnailImage || f.featuredImage || null,
      logoImageLink: null,
      seoImageLink: null,
      _required: [f.title, f.slug],
    };
  },
  webPage(f, entries) {
    // fullSlug is already path-prefixed (e.g. "learn/equity/stock-options"), so keep its
    // slashes — trim only leading/trailing ones, and no encodeURIComponent.
    const slug = String(f.fullSlug || "").replace(/^\/|\/$/g, "");
    return {
      eyebrow: _seoField(f, entries, "eyebrow"),
      headline: (f.displayTitle || "").trim(),
      snippet: _truncateSnippet(_seoField(f, entries, "description")),
      url: slug ? `https://carta.com/${slug}/` : "",
      ctaLabel: "Read more →",
      sortDate: f.displayDate || "",
      featuredImageLink: f.featuredImage || null,
      logoImageLink: null,
      seoImageLink: _seoLink(f, entries, "image"),
      _required: [f.displayTitle, f.fullSlug],
    };
  },
};

// Pure: adapt → drop archived → drop malformed → dedupe → sort → truncate. Assets are
// resolved after truncate, so no wasted asset_data calls.
function _buildNewsCards(items, entries) {
  const seen = new Set();
  return items
    .map(e => {
      const adapt = e && e.fields && NEWS_ADAPTERS[e.content_type];
      return adapt ? adapt(e.fields, entries) : null;  // unmapped/unknown → dropped
    })
    .filter(Boolean)
    .filter(c => !c.headline.toLowerCase().startsWith("[archived]"))
    .filter(c => c.url && c._required.every(v => String(v || "").trim()))
    .filter(c => {
      const key = c.headline.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;  // webPage/blogPost structural dupe
      seen.add(key);
      return true;
    })
    .sort((a, b) => _newsTs(b.sortDate) - _newsTs(a.sortDate))
    .slice(0, NEWS_COUNT);
}

// The template ships static cards. Replace them only once live cards exist; on any
// failure, no connector, or an empty result, keep the static ones.
async function fetchLiveContent() {
  const grid = document.getElementById("plugin-news-grid");
  if (!grid) return;
  if (!(await mcpAvailable())) return;

  try {
    const { items, entries } = await _listNewsContent();
    if (!items.length) return;

    const built = _buildNewsCards(items, entries);
    if (!built.length) return;

    const cards = await Promise.all(built.map(async (c) => {
      const [featured, logo, seoImage] = await Promise.all([
        _resolveNewsAsset(c.featuredImageLink),
        _resolveNewsAsset(c.logoImageLink),
        _resolveNewsAsset(c.seoImageLink),
      ]);
      return { ...c, featuredUrl: featured || seoImage || null, logoUrl: logo || null };
    }));
    renderLiveContent(cards);
  } catch (err) {
    console.error("[captable-home] live news fetch failed — keeping static cards", err);
  }
}

function renderLiveContent(cards) {
  const grid = document.getElementById("plugin-news-grid");
  if (!grid || !cards || !cards.length) return;

  grid.innerHTML = "";
  cards.forEach(cs => {
    const card = document.createElement("a");
    card.className = "plugin-news-card";
    card.href = cs.url;
    card.target = "_blank";
    card.rel = "noopener";
    // A logo whose bytes fail to decode removes its own chip via onerror.
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
    card.addEventListener("click", () => trackHome("click", "CaptableHome.PluginNews.ReadMore"));
    grid.appendChild(card);
  });
}

fetchLiveContent();
