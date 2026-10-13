const assert = require("node:assert/strict");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Platform: {},
  addIcon: () => {}, requireApiVersion: () => true,
  loadPdfJs: async () => null, normalizePath: (value) => value,
  requestUrl: async ({ url }) => {
    assert.equal(url, "https://api.github.com/repos/cheemskc/obsidian-paper-library/releases/latest", "本分支应从实际发布仓库检查更新");
    return { status: 200, json: { tag_name: "0.43.0", assets: [
      { name: "paper-library-0.43.0.zip", browser_download_url: "https://github.com/cheemskc/obsidian-paper-library/releases/download/0.43.0/paper-library-0.43.0.zip" }
    ] } };
  }, setIcon: () => {}
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

const {
  normalizePaperLibraryReleaseVersion,
  comparePaperLibraryVersions,
  selectPaperLibraryReleaseAsset,
  isSafePaperLibraryZipEntry,
  isPaperLibraryReleaseFile
} = PaperLibraryPlugin.updateInternals;

assert.equal(normalizePaperLibraryReleaseVersion("v0.42.0"), "0.42.0");
assert.equal(comparePaperLibraryVersions("0.42.0", "0.41.9"), 1);
assert.equal(comparePaperLibraryVersions("0.42.0-beta.1", "0.42.0"), -1);
assert.equal(selectPaperLibraryReleaseAsset({ assets: [
  { name: "paper-library-web-importer-2.1.0.zip" },
  { name: "paper-library-0.42.0.zip", browser_download_url: "complete" }
] }, "0.42.0").browser_download_url, "complete");
assert.equal(isSafePaperLibraryZipEntry("paper-library/vendor/runtime.js"), true);
assert.equal(isSafePaperLibraryZipEntry("paper-library/../../data.json"), false);
assert.equal(isSafePaperLibraryZipEntry("/tmp/main.js"), false);
assert.equal(isPaperLibraryReleaseFile("vendor/claudian.bundle.js"), true);
assert.equal(isPaperLibraryReleaseFile("pipeline/worker.cjs"), true);
assert.equal(isPaperLibraryReleaseFile("data.json"), false);
assert.equal(isPaperLibraryReleaseFile("models/model.onnx"), false);

(async () => {
  const plugin = new PaperLibraryPlugin();
  plugin.manifest = { version: "0.42.6" };
  plugin.isMobileApp = () => false;
  const update = await plugin.checkForPaperLibraryUpdate();
  assert.equal(update.available, true);
  assert.equal(update.version, "0.43.0");
  assert.match(update.assetUrl, /cheemskc\/obsidian-paper-library/);
  console.log("Self-update tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
