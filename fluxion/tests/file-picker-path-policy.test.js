"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = fs.readFileSync(path.join(__dirname, "../packaging/macos/file-picker-owner.c"), "utf8");
const start = source.indexOf("static int fixture_path_matches("), end = source.indexOf("static int type_fixture_path(", start);
assert.ok(start >= 0 && end > start);
const program = `#include <string.h>\n#include <stdlib.h>\n#include <sys/types.h>\n${source.slice(start, end)}\nint main(int argc, char **argv) {
  if (argc != 4) return 64;
  return fixture_path_matches(argv[1], argv[2], (off_t)strtol(argv[3], NULL, 10)) ? 0 : 1;
}\n`;

for (const migration of [false, true]) test(`native picker path allowlist is exact for ${migration ? "migration" : "upload"} builds`, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fluxion-picker-policy-"));
  try {
    const executable = path.join(directory, "policy");
    const build = spawnSync("cc", ["-Wall", "-Wextra", "-Werror", ...(migration ? ["-DFLUXION_MIGRATION_FIXTURE=1"] : []), "-x", "c", "-", "-o", executable],
      { input: program, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const namespace = migration ? "migration" : "file-picker";
    const filename = migration ? "Fluxion café bookmarks.html" : "Fluxion café upload.txt";
    const size = migration ? 423 : 87;
    const root = "/private/var/folders/fixture/T";
    const valid = `${root}/fluxion-${namespace}-check.Abc123/${filename}`;
    const run = (candidate, bytes = size, temporary = root) => spawnSync(executable, [candidate, temporary, String(bytes)], { encoding: "utf8" }).status;
    assert.equal(run(valid), 0);
    assert.equal(run(valid, size + 1), 1);
    for (const candidate of [
      valid.replace("Abc123", "Abc12"), valid.replace("Abc123", "Abc1234"), valid.replace("Abc123", "Abc12_"),
      valid.replace(filename, `child/${filename}`), valid.replace(filename, "user-secrets.txt"),
      valid.replace(root, `${root}-sibling`), root.slice(0, 10), valid + ".bak",
      `${root}/fluxion-${migration ? "file-picker" : "migration"}-check.Abc123/${filename}`,
    ]) assert.equal(run(candidate), 1, candidate);
    assert.equal(run(valid, size, root + "/nested"), 1);
    if (migration) assert.equal(fs.statSync(path.join(__dirname, "fixtures/migration-bookmarks.html")).size, size);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
