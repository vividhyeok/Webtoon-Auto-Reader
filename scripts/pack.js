const fs = require("node:fs"),
  cp = require("node:child_process"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const files = [
  "manifest.json",
  "shared-settings.js",
  "scene-db.js",
  "background",
  "content",
  "popup",
  "gallery",
  "README.md",
];
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const output = path.join(root, "dist", "webtoon-auto-reader-2.0.1.zip");
cp.execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path ${files.map((f) => quote(path.join(root, f))).join(",")} -DestinationPath ${quote(output)} -Force`,
  ],
  { stdio: "inherit" },
);
console.log(output);
