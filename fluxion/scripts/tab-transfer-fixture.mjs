import http from "node:http";
import { pathToFileURL } from "node:url";

export const MAX_REQUEST_RECORDS = 64;
const destinations = new Set(["document", "empty", "image", "iframe", "frame", "script", "style", "worker",
  "serviceworker", "sharedworker", "font", "audio", "video", "object", "embed", "manifest", "report", "track"]);
const modes = new Set(["navigate", "cors", "no-cors", "same-origin", "websocket"]);
const headerCategory = (value, allowed) => value === undefined ? "missing" : allowed.has(value) ? value : "other";

export async function startFixture(port = 0, { onDocumentRequest } = {}) {
  let loads = 0;
  const requests = [];
  const server = http.createServer((request, response) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    response.setHeader("Cache-Control", "no-store");
    if (request.headers.host !== expectedHost) { response.writeHead(400).end(); return; }
    if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }).end(); return; }
    const url = new URL(request.url, `http://${expectedHost}`);
    if (url.pathname === "/state") {
      response.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ loads, requests, omittedRequests: loads - requests.length })); return;
    }
    if (url.pathname !== "/transfer") { response.writeHead(404).end(); return; }
    loads++;
    if (requests.length < MAX_REQUEST_RECORDS) {
      // Record only fixture routes and bounded header categories. Never retain
      // credentials, cookies, arbitrary query text, or raw header values.
      const record = { sequence: loads,
        path: `/transfer${url.search === "?step=1" ? "?step=1" : url.search ? "?[redacted]" : ""}`,
        destination: headerCategory(request.headers["sec-fetch-dest"], destinations),
        mode: headerCategory(request.headers["sec-fetch-mode"], modes) };
      requests.push(record);
      if (typeof onDocumentRequest === "function") onDocumentRequest({ ...record });
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>Fluxion transfer fixture</title>
<label>Unsaved draft <textarea id="draft"></textarea></label><button id="increment">Increment</button>
<script>
document.documentElement.dataset.nonce = crypto.randomUUID();
window.transferFixtureCounter = 0;
document.getElementById("increment").addEventListener("click", () => {
  window.transferFixtureCounter++;
  document.documentElement.dataset.counter = String(window.transferFixtureCounter);
});
</script>`);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture(Number(process.argv[2] || 0), {
    onDocumentRequest: record => console.log(JSON.stringify({ type: "transfer-request", ...record })),
  });
  console.log(JSON.stringify({ origin: fixture.origin }));
  const close = () => { fixture.server.close(); fixture.server.closeAllConnections(); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
}
