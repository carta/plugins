// Panel mode: the app runs inside a Claude MCP App panel, where there is no Fund Modeling
// server to call. Every same-origin /api request is sent to the Carta connection instead,
// through `callTool` (supplied by the panel shell), and the answer is rebuilt as a Response so
// the rest of the app keeps using plain fetch.
//
// Wire contract with the connection's read command. Headers travel both ways: If-Match must
// reach the Worker and ETag must reach the app, or every autosave is rejected as a stale write.
//   request:  { method, path, headers, body }   path includes the query string
//   response: { status, headers, body }         body is the response text; /api/load-firm is a
//                                               progress stream, so it arrives whole at the end
/** The URL a fetch() call names, whether given a string, a URL or a Request. */
export const requestUrl = (input) =>
  typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : (input && input.url) || "";

/** The HTTP method a fetch() call uses, upper-cased; GET when none is given. */
export const requestMethod = (input, init = {}) => (init.method || (input && input.method) || "GET").toUpperCase();

export function installMcpFetch(callTool) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    if (!url.startsWith("/api")) return orig(input, init);
    const method = requestMethod(input, init);
    const res = await callTool({
      method,
      path: url,
      headers: Object.fromEntries(new Headers(init.headers || (input && input.headers) || {})),
      body: typeof init.body === "string" ? init.body : null,
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": "application/json", ...(res.headers || {}) },
    });
  };
}
