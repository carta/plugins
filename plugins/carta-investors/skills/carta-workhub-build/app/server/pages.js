// The Worker's own pages: what a visitor sees before the Workhub page can load.

// The artifact's favicon, inline: the Worker serves no /favicon.ico.
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🗂️</text></svg>',
)}">`;

const STYLE = `
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8f8f8;color:#1a1a1a}
  .card{text-align:center;padding:48px 40px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:380px;width:100%}
  h1{font-size:22px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;color:#666;margin:0 0 28px}
  a{display:inline-block;padding:12px 32px;background:#1a1a1a;color:#fff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none}
  a:hover{background:#333}`;

function card(title, body, status) {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Carta Workhub</title>${FAVICON}<style>${STYLE}</style></head><body>
<div class="card">${body}</div>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const loginPage = () =>
  card(
    "Sign in",
    `<h1>Carta Workhub</h1><p>Sign in with your Carta account to see the work you have sent your Carta team.</p>
<a href="/auth/login">Sign in with Carta</a>`,
    200,
  );

// set_context refused the hostname's firm for this user. The Workhub page itself would
// only show its load-error banner with Retry, which sends the user to retry what cannot work.
export const noAccessPage = () =>
  card(
    "No access",
    `<h1>No access to this firm</h1><p>Your Carta account cannot open this firm's Workhub. Sign in with the account you use for this firm.</p>
<a href="/auth/logout">Sign in with another account</a>`,
    403,
  );

// Carta did not answer the access check, which says nothing about access.
export const unavailablePage = () =>
  card(
    "Unavailable",
    `<h1>Carta could not be reached</h1><p>Your Workhub could not check your access to this firm just now. Try again in a moment.</p>
<a href="/">Try again</a>`,
    502,
  );
