// node --test plugins/curseforge/main.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan, searchParams, version } from "./main.js";

const q = (over) => ({ kind: "mod", query: "sodium", gameVersion: "1.21.1", loader: "fabric", categories: [], sort: "", offset: 40, limit: 100, ...over });

test("builds search params", () => {
  const p = searchParams(q());
  assert.deepEqual([p.gameId, p.classId, p.modLoaderType, p.sortField, p.sortOrder, p.index, p.pageSize], ["432", "6", "4", "2", "desc", "40", "50"]);
  assert.equal(searchParams(q({ kind: "resourcepack" })).modLoaderType, undefined);
  assert.equal(searchParams(q({ sort: "4" })).sortOrder, "asc");
  assert.equal(searchParams(q({ categories: ["6814"] })).categoryId, "6814");
  assert.equal(searchParams(q({ categories: ["1", "2"] })).categoryIds, "[1,2]");
  assert.equal(searchParams(q({ kind: "modpack", loader: null })).modLoaderType, undefined);
});

test("maps files to versions", () => {
  const v = version({
    id: 5, displayName: "Sodium 0.6", releaseType: 2, fileDate: "2024-01-01", fileName: "sodium.jar", fileLength: 9, downloadUrl: null,
    gameVersions: ["1.21.1", "Fabric", "Client"], dependencies: [{ modId: 7, relationType: 3 }, { modId: 8, relationType: 4 }],
  });
  assert.deepEqual([v.channel, v.gameVersions, v.loaders, v.files[0].url], ["beta", ["1.21.1"], ["fabric"], ""]);
  assert.deepEqual(v.dependencies, [{ projectId: "7", fileName: null, kind: "required" }]);
});

test("plans packs and refuses blocked files", () => {
  const manifest = { name: "P", overrides: "overrides", minecraft: { version: "1.20.1", modLoaders: [{ id: "fabric-0.15.11", primary: true }] } };
  const files = [{ modId: 1, fileName: "a.jar", downloadUrl: "https://edge.forgecdn.net/a.jar", fileLength: 3 }, { modId: 2, fileName: "p.zip", downloadUrl: "https://edge.forgecdn.net/p.zip" }];
  const p = plan(manifest, files, new Map([[1, 6], [2, 12]]));
  assert.deepEqual([p.loader, p.loaderVersion, p.gameVersion], ["fabric", "0.15.11", "1.20.1"]);
  assert.deepEqual(p.files.map((f) => f.path), ["mods/a.jar", "resourcepacks/p.zip"]);
  assert.equal(plan({ ...manifest, minecraft: { version: "1.20.1", modLoaders: [{ id: "neoforge-21.1.1" }] } }, [], new Map()).loader, "neoforge");
  assert.throws(() => plan(manifest, [{ modId: 1, fileName: "x.jar", displayName: "X", downloadUrl: null }], new Map()), /X/);
});
