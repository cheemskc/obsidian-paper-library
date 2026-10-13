const assert = require("node:assert/strict");
const Module = require("node:module");

let requestHandler = async () => ({ status: 500, text: "unconfigured" });
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Platform: {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  addIcon: () => {}, requireApiVersion: () => true, loadPdfJs: async () => ({}),
  normalizePath: (value) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""),
  requestUrl: (options) => requestHandler(options), setIcon: () => {}
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

class MemoryAdapter {
  constructor() { this.files = new Map(); this.directories = new Set(); }
  async exists(path) { return this.files.has(path) || this.directories.has(path); }
  async mkdir(path) { this.directories.add(path); }
  async write(path, value) { this.files.set(path, String(value)); }
  async read(path) {
    if (!this.files.has(path)) throw new Error(`missing ${path}`);
    return this.files.get(path);
  }
  async rmdir(path) {
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    for (const key of [...this.directories]) if (key === path || key.startsWith(`${path}/`)) this.directories.delete(key);
  }
}

function jsonResponse(payload, status = 200) {
  return { status, json: payload, text: JSON.stringify(payload) };
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  Object.entries(files).forEach(([name, text]) => {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  });
  const centralData = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  const output = Buffer.concat([...localParts, centralData, eocd]);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

async function run() {
  const internals = PaperLibraryPlugin.mineruInternals;
  assert.equal(internals.normalizePdfAiMode("mineru"), "mineru");
  assert.equal(internals.normalizePdfAiMode("unknown"), "direct");
  assert.equal(internals.MINERU_DEFAULT_API_BASE, "https://mineru.net");
  assert.equal(internals.normalizeMineruApiBase("https://mineru.net/v1/"), "https://mineru.net");
  assert.equal(internals.isOfficialMineruApiBase("https://mineru.net"), true);
  assert.equal(internals.normalizeMineruTier("ADVANCED"), "advanced");
  assert.deepEqual(internals.mineruPagesFromStructuredContent({
    pages: [{ page_idx: 2, blocks: [
      { type: "text", content: "Result" },
      { type: "table", content: "| A | B |", captions: ["Table 1"] }
    ] }]
  }), [{
    page: 3,
    text: "Result\n\n| A | B |\nTable 1",
    blocks: [
      { type: "text", text: "Result" },
      { type: "table", text: "| A | B |\nTable 1" }
    ]
  }]);
  const archive = storedZip({
    "result/full.md": "# Parsed paper\n\nMinerU result",
    "result/paper_content_list.json": JSON.stringify([
      { page_idx: 0, type: "text", text: "MinerU result" }
    ])
  });
  const extracted = internals.extractMineruZipEntries(archive);
  assert.equal(new TextDecoder().decode(extracted.get("result/full.md")), "# Parsed paper\n\nMinerU result");

  const adapter = new MemoryAdapter();
  const secrets = new Map([["legacy-mineru", "legacy-token"]]);
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.manifest = { id: "paper-library", dir: ".obsidian/plugins/paper-library" };
  plugin.settings = {
    mineruApiBase: "http://127.0.0.1:8000",
    mineruTier: "basic",
    mineruSecretName: "legacy-mineru",
    pdfAiMode: "mineru",
    aiDirectPdfMaxMb: 32
  };
  plugin.app = {
    vault: { adapter },
    secretStorage: {
      getSecret: (name) => secrets.get(name) || null,
      setSecret: (name, value) => secrets.set(name, value)
    }
  };
  plugin.saveSettings = async () => {};
  plugin.mineruActiveTasks = new Set();
  assert.equal(plugin.getMineruApiBase(), "https://mineru.net");
  assert.equal(plugin.getMineruStoredApiKey(), "legacy-token", "legacy SecretComponent values must remain readable");
  await plugin.setMineruApiKey("cloud-token");
  assert.equal(secrets.get("paper-library-mineru-api-key"), "cloud-token");
  assert.equal(plugin.settings.mineruSecretName, "");
  assert.equal(plugin.getMineruCacheRoot(), ".obsidian/plugins/paper-library/mineru-cache/v1");

  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    if (options.url === "https://mineru.net/api/v4/file-urls/batch") {
      return jsonResponse({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://storage.example/upload-1"] } });
    }
    if (options.url === "https://storage.example/upload-1") return { status: 200, text: "" };
    if (options.url === "https://mineru.net/api/v4/extract-results/batch/batch-1") {
      return jsonResponse({ code: 0, data: { batch_id: "batch-1", extract_result: [{
        file_name: "paper.pdf", state: "done", full_zip_url: "https://cdn.example/result.zip"
      }] } });
    }
    if (options.url === "https://cdn.example/result.zip") return { status: 200, arrayBuffer: archive, text: "" };
    throw new Error(`unexpected request ${options.method} ${options.url}`);
  };

  const source = new TextEncoder().encode("fake pdf bytes");
  const progress = [];
  const session = await plugin.parsePdfWithMineruCloud(source, {
    name: "paper.pdf",
    path: "Papers/PDFs/paper.pdf",
    pollIntervalMs: 0,
    onProgress: (item) => progress.push(item)
  });
  assert.equal(session.provider, "mineru");
  assert.equal(session.engine, "mineru-cloud-v4");
  assert.equal(session.tier, "vlm");
  assert.equal(session.pages[0].text, "MinerU result");
  assert.equal(session.cacheHit, false);
  assert.ok(progress.some((item) => item.stage === "下载 MinerU 结果"));
  assert.equal(calls.find((call) => call.url === "https://storage.example/upload-1").headers.Authorization, undefined,
    "the MinerU bearer token must not leak to the signed upload URL");
  assert.equal(calls.find((call) => call.url === "https://cdn.example/result.zip").headers.Authorization, undefined,
    "the MinerU bearer token must not leak to the result CDN");
  assert.equal(calls.find((call) => call.url.endsWith("/api/v4/file-urls/batch")).headers.Authorization, "Bearer cloud-token");
  assert.ok([...adapter.files.keys()].some((path) => path.endsWith("/document.md")));
  assert.ok([...adapter.files.keys()].some((path) => path.endsWith("/structured-content.json")));
  assert.ok(![...adapter.files.keys()].some((path) => path.endsWith(".pdf")), "cache must not duplicate the source PDF");

  const networkCallCount = calls.length;
  const cached = await plugin.parsePdfWithMineruCloud(source, { name: "paper.pdf", pollIntervalMs: 0 });
  assert.equal(cached.cacheHit, true);
  assert.equal(calls.length, networkCallCount, "a valid cache hit must not contact MinerU again");

  requestHandler = async (options) => {
    assert.equal(options.headers.Authorization, "Bearer cloud-token");
    return jsonResponse({ code: -60012, msg: "task not found or expire" });
  };
  const health = await plugin.testMineruConnection();
  assert.equal(health.code, -60012);
  assert.equal(plugin.mineruConnectionStatus.ok, true);

  const originalParser = plugin.parsePdfWithMineruCloud;
  plugin.parsePdfWithMineruCloud = async () => { throw new Error("MinerU unavailable"); };
  await assert.rejects(
    () => plugin.createPdfAIAttachment(new TextEncoder().encode("pdf"), { name: "failure.pdf" }),
    /MinerU unavailable/,
    "MinerU failures must stay visible instead of silently falling back to the source file"
  );
  plugin.parsePdfWithMineruCloud = originalParser;
}

run().then(() => console.log("MinerU cloud integration tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
