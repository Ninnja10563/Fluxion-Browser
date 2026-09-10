import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const MAX_BODY_BYTES = 128 * 1024;
export const DOWNLOAD_FILENAME = "fluxion-download.txt";
export const DOWNLOAD_TEXT = "Fluxion native browsing verification\nDownloaded bytes survive a real multipart upload.\n";
export const DOWNLOAD_BYTES = Buffer.from(DOWNLOAD_TEXT, "utf8");
export const DOWNLOAD_SHA256 = createHash("sha256").update(DOWNLOAD_BYTES).digest("hex");
export const PARTIAL_FILENAME = "fluxion-partial.bin";
export const PARTIAL_BYTES = Buffer.alloc(512 * 1024);
for (let index = 0; index < PARTIAL_BYTES.length; index += 1) PARTIAL_BYTES[index] = index % 251;
export const PARTIAL_SHA256 = createHash("sha256").update(PARTIAL_BYTES).digest("hex");
export const LOGIN = Object.freeze({ username: "fluxion", password: "fixture-only" });

const page = (title, content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1>${content}</body></html>`;
const loginForm = `<form id="login-form" action="/login" method="post">
<label>Username <input name="username" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form>`;
const uploadForm = `<form id="upload-form" action="/upload" method="post" enctype="multipart/form-data">
<label>Downloaded file <input type="file" name="file" required></label>
<button type="submit">Upload</button></form>`;

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let done = false;
    let size = 0;
    const chunks = [];
    if (Number(request.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      request.resume();
      reject(requestError(413, "Request body exceeds fixture limit"));
      return;
    }
    request.on("data", chunk => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        chunks.length = 0;
        reject(requestError(413, "Request body exceeds fixture limit"));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (!done) { done = true; resolve(Buffer.concat(chunks)); }
    });
    request.on("error", error => { if (!done) { done = true; reject(error); } });
    request.on("aborted", () => {
      if (!done) { done = true; reject(requestError(400, "Request body was interrupted")); }
    });
  });
}

function multipartFile(contentType, body) {
  const match = contentType.match(/^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))\s*$/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary || boundary.length > 70 || !/^[0-9A-Za-z'()+_,./:=?\-]+$/.test(boundary)) {
    throw requestError(400, "Expected a bounded multipart boundary");
  }
  const opening = Buffer.from(`--${boundary}\r\n`);
  const closing = Buffer.from(`\r\n--${boundary}--`);
  if (!body.subarray(0, opening.length).equals(opening)) throw requestError(400, "Invalid multipart opening");
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), opening.length);
  if (headerEnd < 0 || headerEnd - opening.length > 8192) throw requestError(400, "Invalid multipart headers");
  const headers = body.subarray(opening.length, headerEnd).toString("utf8");
  const disposition = headers.split("\r\n").find(header => /^content-disposition:/i.test(header));
  const name = disposition?.match(/;\s*name="([^"]*)"/i)?.[1];
  const filename = disposition?.match(/;\s*filename="([^"]*)"/i)?.[1];
  if (name !== "file" || !filename || filename.length > 255) throw requestError(400, "Expected one file field");
  const contentStart = headerEnd + 4;
  const contentEnd = body.indexOf(closing, contentStart);
  if (contentEnd < 0) throw requestError(400, "Missing multipart closing boundary");
  const trailing = body.subarray(contentEnd + closing.length);
  if (trailing.length && !trailing.equals(Buffer.from("\r\n"))) throw requestError(400, "Unexpected multipart trailing bytes");
  return { filename, bytes: body.subarray(contentStart, contentEnd) };
}

function streamDownload(response, status, headers, payload, duration, segments) {
  response.writeHead(status, headers);
  const chunkSize = Math.ceil(payload.length / segments);
  response.write(payload.subarray(0, chunkSize));
  const timers = [];
  for (let index = 1; index < segments; index += 1) {
    timers.push(setTimeout(() => {
      const chunk = payload.subarray(index * chunkSize, (index + 1) * chunkSize);
      if (index === segments - 1) response.end(chunk);
      else response.write(chunk);
    }, Math.round(duration * index / (segments - 1))));
  }
  response.once("close", () => timers.forEach(clearTimeout));
}

export async function start({ port = 0, slowDurationMs = 2100, partialDurationMs = 4000 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("Fixture port must be an integer from 0 through 65535");
  if (!Number.isInteger(slowDurationMs) || slowDurationMs < 1 || slowDurationMs > 10000) throw new TypeError("Slow download duration must be from 1 through 10000 milliseconds");
  if (!Number.isInteger(partialDurationMs) || partialDurationMs < 1 || partialDurationMs > 10000) throw new TypeError("Partial download duration must be from 1 through 10000 milliseconds");
  const sessions = new Set();
  const state = {
    downloads: 0,
    slowDownloads: 0,
    partialDownloads: 0,
    rangeDownloads: 0,
    uploads: 0,
    upload: { verified: false, filename: "", sha256: "", bytes: 0 },
    logins: 0,
    rejectedLogins: 0,
    authenticatedVisits: 0,
  };
  let origin;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    const send = (status, body, headers = {}) => {
      response.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-fluxion-fixture'; form-action 'self'; base-uri 'none'",
        ...headers,
      });
      response.end(body);
    };
    try {
      const expectedHost = new URL(origin).host;
      if (request.headers.host !== expectedHost) throw requestError(400, "Unexpected fixture host");
      if (request.method === "POST" && request.headers.origin && request.headers.origin !== origin) throw requestError(403, "Cross-origin fixture request rejected");
      const url = new URL(request.url, origin);
      const method = request.method;
      const cookie = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith("fluxion_fixture_session="))?.slice("fluxion_fixture_session=".length);
      if (method === "GET" && url.pathname === "/") {
        send(200, page("Fluxion browsing fixture", `<a id="download-link" href="/download-slow" download="${DOWNLOAD_FILENAME}">Download reference</a>${uploadForm}${loginForm}
<p id="js-result">Waiting for page JavaScript</p><script nonce="fluxion-fixture">document.documentElement.dataset.fixtureScript="executed";document.getElementById("js-result").textContent="Page JavaScript executed";</script>`));
      } else if (method === "GET" && ["/download", "/download-slow", "/download-partial"].includes(url.pathname)) {
        state.downloads += 1;
        const partial = url.pathname === "/download-partial";
        const sourceBytes = partial ? PARTIAL_BYTES : DOWNLOAD_BYTES;
        const filename = partial ? PARTIAL_FILENAME : DOWNLOAD_FILENAME;
        const etag = `"${partial ? PARTIAL_SHA256 : DOWNLOAD_SHA256}"`;
        let start = 0;
        let end = sourceBytes.length - 1;
        let status = 200;
        if (request.headers.range && (!request.headers["if-range"] || request.headers["if-range"] === etag)) {
          const range = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
          if (range && (range[1] || range[2])) {
            if (!range[1]) start = Math.max(0, sourceBytes.length - Number(range[2]));
            else {
              start = Number(range[1]);
              if (range[2]) end = Math.min(end, Number(range[2]));
            }
          }
          if (!range || !(range[1] || range[2]) || !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) || start >= sourceBytes.length || end < start ||
              (!range[1] && Number(range[2]) === 0)) {
            send(416, "", { "Content-Range": `bytes */${sourceBytes.length}` });
            return;
          }
          status = 206;
          state.rangeDownloads += 1;
        }
        const payload = sourceBytes.subarray(start, end + 1);
        const headers = {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(payload.length),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "Accept-Ranges": "bytes",
          ETag: etag,
        };
        if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${sourceBytes.length}`;
        if (partial) {
          state.partialDownloads += 1;
          streamDownload(response, status, headers, payload, partialDurationMs, 4);
        } else if (url.pathname === "/download-slow") {
          state.slowDownloads += 1;
          streamDownload(response, status, headers, payload, slowDurationMs, 3);
        } else send(status, payload, headers);
      } else if (method === "GET" && url.pathname === "/upload") {
        send(200, page("Fluxion upload form", uploadForm));
      } else if (method === "POST" && url.pathname === "/upload") {
        const file = multipartFile(request.headers["content-type"] || "", await readBody(request));
        if (!file.bytes.equals(DOWNLOAD_BYTES)) throw requestError(422, "Uploaded file bytes do not match downloaded fixture");
        state.uploads += 1;
        state.upload = { verified: true, filename: file.filename, sha256: createHash("sha256").update(file.bytes).digest("hex"), bytes: file.bytes.length };
        send(200, page("Fluxion upload complete", '<p id="upload-result">Upload verified</p>'));
      } else if (method === "GET" && url.pathname === "/login") {
        send(200, page("Fluxion sign in", loginForm));
      } else if (method === "POST" && url.pathname === "/login") {
        if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
          throw requestError(415, "Expected an HTML login form");
        }
        const form = new URLSearchParams((await readBody(request)).toString("utf8"));
        if (form.get("username") !== LOGIN.username || form.get("password") !== LOGIN.password) {
          state.rejectedLogins += 1;
          throw requestError(401, "Fixture credentials did not match");
        }
        if (sessions.size >= 32) sessions.delete(sessions.values().next().value);
        const token = randomBytes(16).toString("hex");
        sessions.add(token);
        state.logins += 1;
        send(303, "", {
          Location: "/account",
          "Set-Cookie": `fluxion_fixture_session=${token}; Path=/; HttpOnly; SameSite=Strict`,
        });
      } else if (method === "GET" && url.pathname === "/account") {
        if (!sessions.has(cookie)) throw requestError(401, "Sign in to view the fixture account");
        state.authenticatedVisits += 1;
        send(200, page("Fluxion fixture account", '<p id="account-state" data-authenticated="true">Signed in as fluxion</p><form id="logout-form" action="/logout" method="post"><button type="submit">Sign out</button></form>'));
      } else if (method === "POST" && url.pathname === "/logout") {
        sessions.delete(cookie);
        send(303, "", { Location: "/", "Set-Cookie": "fluxion_fixture_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" });
      } else if (method === "GET" && url.pathname === "/state") {
        send(200, JSON.stringify(state), { "Content-Type": "application/json" });
      } else if (["/", "/download", "/download-slow", "/download-partial", "/upload", "/login", "/account", "/logout", "/state"].includes(url.pathname)) {
        send(405, "Method not allowed");
      } else send(404, "Fixture endpoint not found");
    } catch (error) {
      if (!response.destroyed) send(error.status || 500, error.status ? error.message : "Fixture server failed");
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  let closing;
  const close = () => closing ||= new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  return {
    origin, port: address.port, close,
    download: { filename: DOWNLOAD_FILENAME, text: DOWNLOAD_TEXT, sha256: DOWNLOAD_SHA256, bytes: DOWNLOAD_BYTES.length, path: "/download-slow" },
    partialDownload: { filename: PARTIAL_FILENAME, sha256: PARTIAL_SHA256, bytes: PARTIAL_BYTES.length, path: "/download-partial" },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = args[0] === "--port" ? args[1] : args[0];
  if (args.length > (args[0] === "--port" ? 2 : 1) || (value !== undefined && !/^\d+$/.test(value))) {
    process.stderr.write("usage: node browsing-fixture.mjs [--port] [0-65535]\n");
    process.exitCode = 64;
  } else {
    const fixture = await start({ port: value === undefined ? 0 : Number(value) });
    process.stdout.write(`${JSON.stringify({ origin: fixture.origin, port: fixture.port, download: fixture.download, partialDownload: fixture.partialDownload })}\n`);
    const stop = () => fixture.close().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
