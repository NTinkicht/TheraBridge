// Offline test of scripts/extract.mjs with a mocked Figma REST response.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
import { extractPage, main } from "../scripts/extract.mjs";

const text = (id, characters, fontSize, extra = {}) => ({ id, type: "TEXT", name: "t", characters, style: { fontSize }, ...extra });
const page = {
  id: "1:2", name: "38 —  Parent   PWA", type: "CANVAS", children: [
    { id: "10:1", type: "FRAME", name: "P / Check / 390", absoluteBoundingBox: { width: 390 }, explicitVariableModes: { "VariableCollectionId:1": "14:2" }, children: [
      text("10:2", "Check before sending", 24),
      text("10:3", "Mixed size headline that must be ignored", 30, { characterStyleOverrides: [0, 1], styleOverrideTable: { 1: { fontSize: 12 } } }),
      text("10:4", "Hidden giant", 40, { visible: false }),
      text("10:5", "Export blocked", 12),
      { id: "10:6", type: "INSTANCE", name: "Button", interactions: [{ trigger: { type: "ON_CLICK" }, actions: [{ type: "NODE", destinationId: "11:1", navigation: "NAVIGATE" }, { type: "BACK" }] }],
        children: [text("10:7", "Send to", 14), text("10:8", "Dr.\n Ahmed", 14)] },
      { id: "10:9", type: "INSTANCE", name: "Dup", interactions: [{ actions: [{ type: "NODE", destinationId: "11:1" }] }], children: [text("10:10", "Send to Dr. Ahmed", 14)] },
      { id: "10:11", type: "RECTANGLE", name: "Legacy link", transitionNodeID: "11:1" }
    ] },
    { id: "11:1", type: "FRAME", name: "P / Sending / 390", absoluteBoundingBox: { width: 390 }, children: [text("11:2", "Sending your update", 22)] },
    { id: "12:1", type: "SECTION", name: "not a frame", children: [] }
  ]
};

const r = extractPage(page);
assert.deepEqual(r.frames, [["10:1", "P / Check / 390", 390, "14:2", "Check before sending", 1], ["11:1", "P / Sending / 390", 390, "", "Sending your update", 0]]);
assert.deepEqual(r.edges, [["10:1", "11:1", "Send to Dr. Ahmed"], ["10:1", "11:1", "Legacy link"]]);
assert.equal(r.name, "38 — Parent PWA");
console.log("extractPage: ok");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "flowmap-"));
process.env.FLOWMAP_ROOT = root; process.env.FIGMA_TOKEN = "test"; process.env.FIGMA_PAGES = "1:2,9:9";
let status = 200, calls = 0;
globalThis.fetch = async (url, opts) => {
  calls++;
  assert.ok(url.includes("/v1/files/34FdCEFoEc7lZ2sVHmCkge/nodes?ids=1%3A2%2C9%3A9"), url);
  assert.equal(opts.headers["X-Figma-Token"], "test");
  return { status, ok: status === 200, headers: { get: () => null }, json: async () => ({ lastModified: "2026-10-13T10:00:00Z", nodes: { "1:2": { document: page }, "9:9": null } }), text: async () => "" };
};
const out = path.join(root, "site", "data");
await main();
const first = JSON.parse(fs.readFileSync(path.join(out, "latest.json"), "utf8"));
assert.equal(first.frames, 2); assert.equal(first.edges, 2); assert.deepEqual(first.missingPages, ["9:9"]); assert.ok(!fs.existsSync(path.join(out, "previous.json")));
await main(); // unchanged → no write
assert.equal(JSON.parse(fs.readFileSync(path.join(out, "latest.json"), "utf8")).at, first.at);
page.children[1].children[0].characters = "Sending now";
await main(); // changed → previous kept
assert.ok(fs.existsSync(path.join(out, "previous.json")));
assert.equal(JSON.parse(fs.readFileSync(path.join(out, "previous.json"), "utf8")).at, first.at);
status = 403;
await assert.rejects(main(), /refused the token/);
console.log("main: ok (" + calls + " mocked calls)");
