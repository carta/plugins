import React from "react";
import Root from "./Root.jsx";
import { installPinpoint } from "./bridge-client.js";
import { mountWithAuth } from "./mount.jsx";

await mountWithAuth((root) => {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
  installPinpoint();
});
