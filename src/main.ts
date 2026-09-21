import { fetchConfig } from "./config";

const status = document.getElementById("status")!;
fetchConfig()
  .then((c) => {
    status.textContent = `Waiting for vehicle... ${Object.keys(c.endpoints).join(", ")}`;
  })
  .catch((e: unknown) => {
    status.textContent = `config.json not loaded: ${String(e)}`;
  });
