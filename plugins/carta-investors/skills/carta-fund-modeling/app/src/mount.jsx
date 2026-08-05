import React from "react";
import { createRoot } from "react-dom/client";
import { resolveDashToken, installApiAuth } from "./dash-token.js";
import AuthError from "./AuthError.jsx";

// Shared launch gate for both entrypoints: AuthError when there is no valid token.
export async function mountWithAuth(render) {
  const root = createRoot(document.getElementById("root"));
  const token = await resolveDashToken();
  if (!token) {
    root.render(<AuthError />);
    return;
  }
  installApiAuth(token);
  render(root);
}
