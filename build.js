const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = __dirname;
// Keep the native annotation UI in the single-file Obsidian entry point.
const entryPath = path.join(root, "main.js");
const eltonSource = fs.readFileSync(path.join(root, "vendor/elton-annotation-core.cjs"), "utf8");
const annotationSource = fs.readFileSync(path.join(root, "vendor/paperlib-annotations.cjs"), "utf8")
  .replace('require("./elton-annotation-core.cjs")', () => `(function() { const module = { exports: {} };\n${eltonSource}\nreturn module.exports; })()`);
const annotationBundle = "/* paperlib-annotations:begin */\nconst __paperlibAnnotationModule = { exports: {} };\n(function(require, module, exports) {\n"
  + annotationSource + "\n})(require, __paperlibAnnotationModule, __paperlibAnnotationModule.exports);\n/* paperlib-annotations:end */";
const entrySource = fs.readFileSync(entryPath, "utf8");
if (!entrySource.includes("/* paperlib-annotations:begin */")) throw new Error("Missing annotation bundle markers");
const nextEntry = entrySource.replace(/\/\* paperlib-annotations:begin \*\/[\s\S]*?\/\* paperlib-annotations:end \*\//, () => annotationBundle);
if (nextEntry !== entrySource) fs.writeFileSync(entryPath, nextEntry);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const files = [
  "main.js",
  "manifest.json",
  "styles.css",
  "versions.json",
  "doclayout_extract.py",
  "DOCLAYOUT_NOTICE.md",
  "ELTON_NOTICE.md",
  "LICENSE",
  "vendor",
  "pipeline"
];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paper-library-release-"));
const packageRoot = path.join(temporaryRoot, "paper-library");
const outputDirectory = path.join(root, "dist");
const output = path.join(outputDirectory, `paper-library-${manifest.version}.zip`);

try {
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const relativePath of files) {
    const source = path.join(root, relativePath);
    if (!fs.existsSync(source)) throw new Error(`Missing release file: ${relativePath}`);
    fs.cpSync(source, path.join(packageRoot, relativePath), { recursive: true });
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.rmSync(output, { force: true });
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      packageRoot,
      output
    ], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qry", output, "paper-library"], { cwd: temporaryRoot, stdio: "inherit" });
  }
  console.log(output);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
