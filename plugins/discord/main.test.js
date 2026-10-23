// node --test plugins/discord/main.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { line, plural } from "./main.js";

test("copy", () => {
  const f = ["мод", "мода", "модов"];
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 104].map((n) => plural(n, f)), ["мод", "мода", "модов", "модов", "модов", "мод", "мода", "модов", "модов", "мода"]);
  assert.equal(line({ version: "1.21.1", loader: "vanilla", mods: 3 }), "1.21.1 · Ванилла");
  assert.equal(line({ version: "1.21.1", loader: "fabric", mods: 0 }), "1.21.1 · Fabric");
  assert.equal(line({ version: "1.20.4", loader: "quilt", mods: 42 }), "1.20.4 · Quilt · 42 мода");
});
