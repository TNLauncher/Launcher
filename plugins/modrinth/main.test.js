// node --test plugins/modrinth
import assert from "node:assert/strict";
import { test } from "node:test";
import { facets, plan } from "./main.js";

test("builds facets", () => {
  const q = (kind, loader) => ({ kind, query: "", gameVersion: "1.21", loader, categories: ["magic"], sort: "", offset: 0, limit: 20 });
  const f = facets(q("modpack", null));
  assert.deepEqual(f[2], ["categories:fabric", "categories:quilt"]);
  assert.deepEqual(f[3], ["categories:magic"]);
  assert.deepEqual(facets(q("mod", "fabric"))[2], ["categories:fabric"]);
  assert.equal(facets(q("resourcepack", null)).length, 3);
});

test("plans packs", () => {
  const index = (dep, env) => ({
    name: "Pack",
    files: [{ path: "mods/a.jar", downloads: ["https://cdn.modrinth.com/a.jar"], env: { client: env } }],
    dependencies: { minecraft: "1.21", [dep]: "1.0" },
  });
  const p = plan(index("fabric-loader", "required"));
  assert.deepEqual([p.gameVersion, p.loader, p.loaderVersion, p.files.length], ["1.21", "fabric", "1.0", 1]);
  assert.equal(plan(index("quilt-loader", "required")).loader, "quilt");
  assert.equal(plan(index("fabric-loader", "unsupported")).files.length, 0);
  assert.throws(() => plan(index("forge", "required")));
});
