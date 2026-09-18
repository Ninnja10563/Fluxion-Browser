import http from "node:http";
import { pathToFileURL } from "node:url";

export async function startFixture(port = 0) {
  const state = { armed: 0, unload: 0 };
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== new URL(origin).host) { response.writeHead(400).end(); return; }
    const url = new URL(request.url, origin);
    if (url.pathname === "/event" && request.method === "POST") {
      if (!["armed", "unload"].includes(url.searchParams.get("name"))) { response.writeHead(400).end(); return; }
      state[url.searchParams.get("name")]++;
      request.resume(); response.writeHead(204).end(); return;
    }
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (url.pathname === "/state") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state)); return;
    }
    if (url.pathname !== "/page") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html>
<meta charset="utf-8"><title>Fluxion duplicate fixture</title>
<style>html,body{margin:0;height:100%}button{width:100%;height:100%;font:16px system-ui}</style>
<button>Arm unsaved-page protection</button>
<script>
document.querySelector("button").addEventListener("click", event => {
  if (!event.isTrusted || !navigator.userActivation.isActive) return;
  navigator.sendBeacon("/event?name=armed");
  window.addEventListener("beforeunload", event => {
    navigator.sendBeacon("/event?name=unload");
    event.preventDefault(); event.returnValue = "";
  });
}, { once: true });
</script>`);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, origin } = await startFixture();
  console.log(JSON.stringify({ origin }));
  const close = () => { server.close(); server.closeAllConnections(); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
}
