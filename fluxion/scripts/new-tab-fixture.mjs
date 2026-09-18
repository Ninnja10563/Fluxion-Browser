import http from "node:http";
import { pathToFileURL } from "node:url";

export async function startFixture(port = 0) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const searchOrigin = `http://fluxion-new-tab.example.com:${server.address().port}`;
    response.setHeader("Cache-Control", "no-store");
    if (![new URL(origin).host, new URL(searchOrigin).host].includes(request.headers.host)) { response.writeHead(400).end(); return; }
    const url = new URL(request.url, origin);
    if (request.method === "GET" && url.pathname === "/state") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ requests })); return;
    }
    if (request.method === "GET" && url.pathname === "/engine.xml") {
      response.writeHead(200, { "Content-Type": "application/opensearchdescription+xml" }).end(`<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
<ShortName>Fluxion local POST fixture</ShortName><Description>Isolated native new tab verification</Description>
<InputEncoding>UTF-8</InputEncoding><Url type="text/html" method="POST" template="${searchOrigin}/search"><Param name="q" value="{searchTerms}"/></Url>
</OpenSearchDescription>`); return;
    }
    if ((url.pathname !== "/page" || request.method !== "GET") &&
        (url.pathname !== "/search" || request.method !== "POST")) {
      request.resume(); response.writeHead(405).end(); return;
    }
    if (requests.length >= 40) { request.resume(); response.writeHead(429).end(); return; }
    let body = "", oversized = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (body.length + chunk.length > 2048) oversized = true;
      else body += chunk;
    });
    request.on("end", () => {
      if (oversized) { response.writeHead(413).end(); return; }
      requests.push({ method: request.method, path: url.pathname, query: url.search, body });
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
        "<!doctype html><meta charset=utf-8><title>Fluxion new tab fixture</title><p>Native navigation fixture</p>");
    });
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
