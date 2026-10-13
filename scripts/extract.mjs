#!/usr/bin/env node
// Reads the CareBridge V1 canonical pages from Figma (read-only REST API) and
// writes site/data/latest.json. If anything changed, the old file becomes
// site/data/previous.json so the page can show what changed.
//
// Environment:
//   FIGMA_TOKEN     required — a Figma personal access token with the
//                   file_content:read scope (read-only).
//   FIGMA_FILE_KEY  optional — defaults to the CareBridge file.
//   FIGMA_PAGES     optional — comma-separated page ids to read.
//   FORCE_WRITE     optional — "1" writes a new snapshot even when unchanged.
//
// Node 18+ (uses the built-in fetch). No dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FILE_KEY = "34FdCEFoEc7lZ2sVHmCkge";
export const DEFAULT_PAGES = ["271:2", "302:2", "305:2", "329:2", "340:2", "342:2", "344:2", "356:2", "360:2", "361:2", "364:2", "368:2", "388:2"];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

function descendants(node, out = []) {
  for (const c of node.children || []) { out.push(c); descendants(c, out); }
  return out;
}

// A text node whose characters use more than one font size counts as "mixed",
// matching the Figma plugin API, where fontSize is then not a number.
function fontSizeOf(t) {
  const base = t.style && t.style.fontSize;
  if (typeof base !== "number") return null;
  const table = t.styleOverrideTable || {};
  const used = new Set(t.characterStyleOverrides || []);
  for (const k of used) {
    const o = table[k];
    if (o && typeof o.fontSize === "number" && o.fontSize !== base) return null;
  }
  return base;
}

function destinations(node) {
  const out = [];
  for (const it of node.interactions || []) {
    for (const a of it.actions || []) {
      if (a && a.type === "NODE" && a.destinationId) out.push(a.destinationId);
    }
  }
  // Older files can carry only the legacy single prototype link.
  if (!out.length && node.transitionNodeID) out.push(node.transitionNodeID);
  return out;
}

// Same output shape as the in-Figma extraction used by the Claude version:
// frames: [id, name, width, modeIds, title, lockCount]; edges: [from, to, label]
export function extractPage(page) {
  const frames = [], edges = [], seen = {};
  for (const f of page.children || []) {
    if (f.type !== "FRAME") continue;
    const all = descendants(f);
    const texts = all.filter((n) => n.type === "TEXT");
    let title = "", best = 0, locks = 0;
    for (const t of texts) {
      if (t.visible === false) continue;
      const chars = t.characters || "";
      const fs_ = fontSizeOf(t);
      if (fs_ != null && fs_ > best && chars.trim().length > 3) { best = fs_; title = chars; }
      if (/\b(blocked|locked)\b/i.test(chars) && chars.length < 60) locks++;
    }
    const width = Math.round((f.absoluteBoundingBox && f.absoluteBoundingBox.width) || (f.size && f.size.x) || 0);
    frames.push([f.id, clean(f.name).slice(0, 70), width, Object.values(f.explicitVariableModes || {}).join(","), clean(title).slice(0, 70), locks]);
    for (const n of [f].concat(all)) {
      const dests = destinations(n);
      if (!dests.length) continue;
      let lab = n.type === "TEXT" ? n.characters : descendants(n).filter((x) => x.type === "TEXT").map((x) => x.characters).join(" ");
      lab = clean(lab || n.name).slice(0, 44);
      for (const d of dests) {
        const k = f.id + ">" + d + ">" + lab;
        if (seen[k]) continue;
        seen[k] = 1;
        edges.push([f.id, d, lab]);
      }
    }
  }
  return { page: page.id, name: clean(page.name).slice(0, 70), frames, edges };
}

async function fetchPages(token, fileKey, ids) {
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(ids.join(","))}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { "X-Figma-Token": token } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after")) || 20 * attempt;
      console.log(`Figma answered ${res.status}; waiting ${wait}s before retry ${attempt}/3…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 403) throw new Error("Figma refused the token (403). Check that FIGMA_TOKEN is valid, not expired, has the file_content:read scope, and that its account can open the file.");
    if (res.status === 404) throw new Error("Figma could not find the file (404). Check FIGMA_FILE_KEY.");
    if (!res.ok) throw new Error(`Figma answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error("Figma kept rate-limiting or failing after 4 attempts.");
}

function summarize(pages) {
  const frames = {}, dangling = [];
  pages.forEach((p) => p.frames.forEach((f) => (frames[f[0]] = 1)));
  pages.forEach((p) => p.edges.forEach((e) => { if (!frames[e[1]]) dangling.push(e); }));
  return { frames: Object.keys(frames).length, edges: pages.reduce((n, p) => n + p.edges.length, 0), dangling };
}

export async function main() {
  const root = process.env.FLOWMAP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "site", "data");
  const token = process.env.FIGMA_TOKEN;
  if (!token) { console.error("FIGMA_TOKEN is not set. Add it as a repository secret (see README)."); process.exit(1); }
  const fileKey = process.env.FIGMA_FILE_KEY || DEFAULT_FILE_KEY;
  const ids = (process.env.FIGMA_PAGES || DEFAULT_PAGES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  console.log(`Reading ${ids.length} pages from Figma file ${fileKey} (read-only)…`);
  const json = await fetchPages(token, fileKey, ids);
  const pages = [], missing = [];
  for (const id of ids) {
    const entry = json.nodes && json.nodes[id];
    if (!entry || !entry.document) { missing.push(id); continue; }
    pages.push(extractPage(entry.document));
  }
  if (missing.length) console.warn(`Warning: these pages are no longer in the file: ${missing.join(", ")}`);
  if (!pages.length) throw new Error("No pages could be read; nothing was written.");

  const sum = summarize(pages);
  for (const p of pages) console.log(`  ${p.page}  ${p.name.padEnd(60)} ${String(p.frames.length).padStart(4)} screens ${String(p.edges.length).padStart(4)} links`);
  console.log(`Total: ${sum.frames} screens, ${sum.edges} links, ${sum.dangling.length} links to screens outside these pages.`);

  const latestPath = path.join(dataDir, "latest.json");
  const prev = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, "utf8")) : null;
  const same = prev && JSON.stringify(prev.pages) === JSON.stringify(pages);
  let changed = false;
  if (same && process.env.FORCE_WRITE !== "1") {
    console.log("No change since the last extraction; nothing written.");
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    if (prev) fs.writeFileSync(path.join(dataDir, "previous.json"), JSON.stringify(prev));
    const out = { at: new Date().toISOString(), source: "github-action", hasPrevious: !!prev, fileKey, lastModified: json.lastModified || null, frames: sum.frames, edges: sum.edges, missingPages: missing, pages };
    fs.writeFileSync(latestPath, JSON.stringify(out));
    changed = true;
    console.log(`Wrote ${path.relative(root, latestPath)}${prev ? " (old version kept as previous.json)" : ""}.`);
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("Refresh failed: " + e.message); process.exit(1); });
}
