import http from "node:http";
import { pathToFileURL } from "node:url";

export async function startAIPrivacyFixture() {
  const state = { models: [], posts: [] };
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const credential = { headerPresent: Boolean(request.headers.authorization),
      expectedCredential: request.headers.authorization === "Bearer fluxion-native-fixture-synthetic-only" };
    const json = value => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && path === "/state") return json(state);
    if (request.method === "GET" && path === "/article") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.end('<!doctype html><html lang="en"><title>Fluxion local AI fixture</title><main><h1>Local browser privacy</h1><p>This controlled article explains that browser page text stays on this machine unless the user explicitly asks a configured provider to process it. Disabling the provider or excluding this site must revoke an unfinished request before any page text leaves the browser.</p></main></html>');
    }
    if (/^\/[ab]\/v1\/models$/.test(path) && request.method === "GET") {
      state.models.push({ path, ...credential });
      return json({ data: [{ id: "fluxion-fixture" }] });
    }
    if (/^\/[ab]\/v1\/chat\/completions$/.test(path) && request.method === "POST") {
      let size = 0;
      const chunks = [];
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536) { response.writeHead(413); response.end(); request.destroy(); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const hasPageContext = body.messages?.some(message => message.role === "user" &&
          message.content?.includes("This controlled article explains"));
        state.posts.push({ path, ...credential, hasPageContext: Boolean(hasPageContext) });
        return json({ choices: [{ message: { content: "The article describes local privacy and explicit page-sharing consent." } }] });
      } catch { response.writeHead(400); response.end(); return; }
    }
    response.writeHead(404); response.end();
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => {
    server.close(resolve); server.closeAllConnections();
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startAIPrivacyFixture();
  process.stdout.write(`${JSON.stringify({ origin: fixture.origin })}\n`);
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => fixture.close().then(() => process.exit(0)));
}
