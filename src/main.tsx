import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { commands } from "./api";
import { installSchema } from "./model";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
commands
  .schema()
  .then((schema) => {
    installSchema(schema);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((e) => {
    root.render(<p role="alert">SSOT Hub 只能在桌面应用中运行：{String(e)}</p>);
  });
