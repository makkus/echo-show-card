import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { basename } from "node:path";

const root = new URL("../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("hacs.json", root), "utf8"));
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
assert.equal(typeof metadata.name, "string");
assert.ok(metadata.name.trim());
assert.equal(metadata.content_in_root, true);
assert.equal(basename(metadata.filename), metadata.filename);
assert.equal(metadata.filename, `${pkg.name}.js`);
assert.match(metadata.homeassistant, /^\d{4}\.\d{1,2}\.\d+$/);
for (const path of [metadata.filename, "README.md", "LICENSE", "examples/dashboard.yaml"]) {
  await access(new URL(path, root));
}
const source = await readFile(new URL(metadata.filename, root), "utf8");
assert.ok(source.includes('customElements.define("echo-show-card", EchoShowCard)'));
console.log("HACS package metadata and required files are valid locally.");
