// `npm run release <version>`: bump the version everywhere, make the two bump commits and tag v<version>.
// Pushing the tag triggers .github/workflows/release.yml.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
const sh = (cmd, ...args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }).trim();
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail("usage: npm run release <major.minor.patch>");
if (sh("git", "status", "--porcelain")) fail("working tree is dirty, commit or stash first");
if (sh("git", "tag", "-l", `v${version}`)) fail(`tag v${version} already exists`);

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};
json("src-tauri/tauri.conf.json", (c) => { c.version = version; });
sh("npm", "version", version, "--no-git-tag-version");
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
writeFileSync("src-tauri/Cargo.toml", cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`));
sh("cargo", "update", "-p", "tnlauncher", "--offline", "--manifest-path", "src-tauri/Cargo.toml");

sh("git", "add", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json");
sh("git", "commit", "-m", `feature(tauri): bump version to ${version}`);
sh("git", "add", "package.json", "package-lock.json");
sh("git", "commit", "-m", `feature(frontend): bump version to ${version}`);
sh("git", "tag", `v${version}`);

console.log(`Tagged v${version}. Publish with:\n  git push && git push origin v${version}`);
