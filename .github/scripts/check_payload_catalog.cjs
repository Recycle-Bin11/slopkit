const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = process.argv[2] || "_site";
const source = fs.readFileSync(path.join(root, "payloads/catalog.js"), "utf8");
assert(!source.includes("{%") && !source.includes("{{"), "Catalog must be rendered by Jekyll");
function run(code) {
  const context = { window: {} };
  vm.runInNewContext(code, context);
  return context.window.SLOPKIT_PAYLOADS;
}
const entries = run(source);
assert(Array.isArray(entries));
const metadata = JSON.parse(fs.readFileSync("_data/payloads.json", "utf8"));
const expected = fs.readdirSync("payloads", { withFileTypes: true })
  .filter(f => f.isFile() && /\.elf$/i.test(f.name) && !(metadata[f.name] || {}).hidden)
  .map(f => f.name).sort();
assert.deepEqual(Array.from(entries, e => e.name).sort(), expected);
assert.equal(new Set(entries.map(e => e.name)).size, entries.length);
for (const entry of entries) {
  for (const field of ["name", "title", "description", "info"]) assert.equal(typeof entry[field], "string");
  if (metadata[entry.name] && metadata[entry.name].title)
    assert.equal(entry.title, metadata[entry.name].title);
}
const synthetic = source.replace(/var files = \[[\s\S]*?\];/, function () {
  return "var files = " + JSON.stringify(["new-tool.elf", "KSTUFF.ELF", 'quoted"name.elf', "elfldr-ps5-1360.elf"]) + ";";
});
const added = run(synthetic);
assert(added.some(e => e.name === "new-tool.elf" && e.title === "new tool" && e.description === ""));
assert(added.some(e => e.name === "KSTUFF.ELF" && e.title === "KSTUFF"));
assert(!added.some(e => e.name === "elfldr-ps5-1360.elf"));
const page = fs.readFileSync(path.join(root, "slopkit/poops.html"), "utf8");
assert(page.indexOf("../payloads/catalog.js") < page.indexOf("const PAYLOADS ="));
console.log("Catalog checks passed: discovery, metadata, exclusions, names and load order.");
