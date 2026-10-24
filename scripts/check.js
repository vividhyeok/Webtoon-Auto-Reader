const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process");
for (const folder of [
  "background",
  "content",
  "popup",
  "gallery",
  "tests",
  "scripts",
])
  for (const file of fs.readdirSync(folder, { recursive: true }))
    if (file.endsWith(".js"))
      cp.execFileSync(process.execPath, ["--check", path.join(folder, file)], {
        stdio: "inherit",
      });
for (const file of ["shared-settings.js", "scene-db.js"])
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
const m = JSON.parse(fs.readFileSync("manifest.json"));
for (const file of [
  m.background.service_worker,
  m.action.default_popup,
  ...m.content_scripts.flatMap((s) => s.js),
])
  if (!fs.existsSync(file)) throw Error("Missing " + file);
console.log("JavaScript syntax and manifest paths: OK");
