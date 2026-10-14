"use strict";
// CSS-only review harness. It uses the shipped stylesheet, not Gecko/XUL.
// Run: node fluxion/scripts/preview-sidebar.cjs, then open localhost:4176.
// Add ?checks to run 72 rendered layout cases; inspect window.sidebarLayoutReport.
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = readFileSync(join(__dirname, "../chrome/fluxion-chrome.js"), "utf8");
const css = source.match(/style\.textContent = `([\s\S]*?)`;/)[1];
const svg = (path, cls = "fluxion-control-glyph") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35"><path d="${path}"/></svg>`;
const folder = svg("M2 4h5l2 2h5v7H2Z", "fluxion-workspace-symbol");
const plus = svg("M8 2v12M2 8h12");
const names = ["Project documentation", "Design references", "Inbox — Research", "Reading list", "Notes from this morning", "Release checklist"];
createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const state = ["expanded", "focus", "compact"].includes(url.searchParams.get("state")) ? url.searchParams.get("state") : "expanded";
  const density = ["compact", "roomy"].includes(url.searchParams.get("density")) ? url.searchParams.get("density") : "standard";
  const rtl = url.searchParams.has("rtl");
  const count = url.searchParams.has("many") ? 45 : 6;
  const theme = url.searchParams.has("light") ? "light" : "dark";
  const tabs = Array.from({ length: count }, (_, i) => `<div class="fluxion-tab" tabindex="0" role="treeitem" aria-selected="${i === 1}">${svg("M3 2h7l3 3v9H3ZM10 2v4h3", "fluxion-fallback")}<span class="fluxion-title">${names[i % names.length]}</span><button class="fluxion-close" aria-label="Close tab">×</button></div>`).join("");
  const folders = url.searchParams.has("folders") ? ["Reference", "Reading list"].map(name =>
    `<div class="fluxion-group is-collapsed"><button class="fluxion-group-heading" role="treeitem" aria-expanded="false"><span class="fluxion-group-disclosure" aria-hidden="true">›</span>${svg("M1 4V2.5h5l2 2h7v9H1Z", "fluxion-folder-icon")}<span class="fluxion-group-name">${name}</span></button></div>`).join("") : "";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" chromedir="${rtl ? "rtl" : "ltr"}" data-fluxion-density="${density}"><meta charset="utf-8"><title>Fluxion sidebar CSS review — not native Gecko</title><style>${css}
  :root {color-scheme:${theme};--fluxion-sidebar-width:252px;--fluxion-persistent-sidebar-top:48px;--fluxion-page-inset:0px}
  body{margin:0;font:13px system-ui;background:var(--fluxion-bg);color:var(--fluxion-ink)}
  #browser{display:flex;height:calc(100vh - 48px)}header{height:48px;display:flex;align-items:center;padding-inline:268px 16px;box-sizing:border-box}
  .address{background:var(--fluxion-bg-raised);border-radius:8px;padding:9px 14px;width:100%;color:var(--fluxion-muted)}
  main{flex:1;margin:0 8px 8px 0;border-radius:8px;background:var(--fluxion-bg-raised);padding:32px;color:var(--fluxion-muted)}
  #fluxion-flow{flex-shrink:0}.fluxion-workspace-symbol{color:inherit}.note{max-width:400px;line-height:1.7}
  </style><header><div class="address">Search or enter address</div></header><div id="browser">
  <div id="fluxion-flow" data-state="${state}" data-revealed="true"><div class="fluxion-surface">
  <div class="fluxion-workspace-heading">${folder}<span>Research</span><button class="fluxion-icon-button fluxion-workspace-more" aria-label="Workspace options">···</button></div>
  <div class="fluxion-tab-tree" role="tree" aria-label="Open tabs in current workspace"><div class="fluxion-folders" role="group" aria-label="Workspace folders">${folders}</div>
  <div class="fluxion-workspace-divider" aria-hidden="true"></div>
  <div class="fluxion-tab-scroll"><div class="fluxion-tabs" role="group">${tabs}</div>
  <div class="fluxion-footer"><button class="fluxion-new-tab" aria-label="New tab">${plus}<span class="fluxion-new-tab-label">New tab</span><kbd class="fluxion-keyhint" aria-hidden="true">⌘T</kbd></button></div></div></div>
  <div class="fluxion-workspaces"><button class="fluxion-icon-button" aria-label="Toggle sidebar">${svg("M2 3h12v10H2ZM6 3v10")}</button><div class="fluxion-workspace-list"><button class="fluxion-workspace" aria-selected="true" aria-label="Research">${folder}</button><button class="fluxion-workspace" aria-label="Development">${svg("M6 4 2 8l4 4m4-8 4 4-4 4", "fluxion-workspace-symbol")}</button></div><button class="fluxion-add-workspace" aria-label="New workspace">${plus}</button></div>
  </div></div><main><p class="note">Sidebar layout review using Fluxion’s actual CSS. This is a visual fixture, not a running browser build.</p></main></div>
  ${url.searchParams.has("checks") ? `<script>${readFileSync(join(__dirname, "sidebar-layout-checks.js"), "utf8")}</script>` : ""}</html>`);
}).listen(4176, "127.0.0.1", () => console.log("Sidebar CSS review: http://127.0.0.1:4176"));
