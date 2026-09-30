const assert = require("node:assert/strict");
const Module = require("node:module");

let requestHandler = async () => ({ status: 500, text: "unconfigured" });
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Platform: {},
  Plugin: class {}, PluginSettingTab: class {}, SecretComponent: class {}, Setting: class {},
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
  constructor() {
    this.files = new Map();
    this.directories = new Set();
  }

  async exists(path) {
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path) {
    this.directories.add(path);
  }

  async write(path, value) {
    this.files.set(path, String(value));
  }

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

async function run() {
  const internals = PaperLibraryPlugin.mineruInternals;
  assert.equal(internals.normalizePdfAiMode("mineru"), "mineru");
  assert.equal(internals.normalizePdfAiMode("unknown"), "direct");
  assert.equal(internals.normalizeMineruApiBase("http://127.0.0.1:8000/v1/"), "http://127.0.0.1:8000");
  assert.equal(internals.normalizeMineruApiBase("file:///tmp/mineru"), "http://127.0.0.1:8000");
  assert.equal(internals.normalizeMineruTier("ADVANCED"), "advanced");
  assert.equal(internals.mineruSameOrigin("http://127.0.0.1:8000", "https://storage.example/upload"), false);
  assert.equal(internals.resolveMineruUploadUrl("http://127.0.0.1:8000", "/v1/uploads/u/content"),
    "http://127.0.0.1:8000/v1/uploads/u/content");
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

  const adapter = new MemoryAdapter();
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.manifest = { id: "paper-library", dir: ".obsidian/plugins/paper-library" };
  plugin.settings = {
    mineruApiBase: "http://127.0.0.1:8000",
    mineruTier: "standard",
    mineruSecretName: "mineru-test"
  };
  plugin.app = {
    vault: { adapter },
    secretStorage: { getSecret: async (name) => name === "mineru-test" ? "test-token" : "" }
  };
  plugin.mineruActiveTasks = new Set();
  assert.equal(plugin.getMineruCacheRoot(), ".obsidian/plugins/paper-library/mineru-cache/v1");

  const originalParser = plugin.parsePdfWithMineruV1;
  plugin.settings.pdfAiMode = "mineru";
  plugin.settings.aiDirectPdfMaxMb = 32;
  plugin.parsePdfWithMineruV1 = async () => { throw new Error("MinerU unavailable"); };
  await assert.rejects(
    () => plugin.createPdfAIAttachment(new TextEncoder().encode("pdf"), { name: "failure.pdf" }),
    /MinerU unavailable/,
    "MinerU failures must stay visible instead of silently falling back to the source file"
  );
  plugin.parsePdfWithMineruV1 = originalParser;

  const calls = [];
  requestHandler = async (options) => {
    calls.push(options);
    if (options.url === "http://127.0.0.1:8000/v1/uploads") {
      return jsonResponse({
        id: "upload-1",
        status: "pending",
        upload_url: "https://storage.example/upload-1",
        upload_method: "PUT",
        upload_headers: { "x-signed": "yes" }
      });
    }
    if (options.url === "https://storage.example/upload-1") return { status: 200, text: "" };
    if (options.url === "http://127.0.0.1:8000/v1/uploads/upload-1/complete") {
      return jsonResponse({ file: { id: "file-source" } });
    }
    if (options.url === "http://127.0.0.1:8000/v1/parse/jobs" && options.method === "POST") {
      return jsonResponse({ id: "job-1", status: "running" });
    }
    if (options.url === "http://127.0.0.1:8000/v1/parse/jobs/job-1") {
      return jsonResponse({
        id: "job-1",
        status: "completed",
        files: [{ output_files: {
          markdown: { file_id: "markdown-1" },
          structured_content: { file_id: "structured-1" }
        } }]
      });
    }
    if (options.url === "http://127.0.0.1:8000/v1/files/markdown-1/content") {
      return { status: 200, text: "# Parsed paper\n\nMinerU result" };
    }
    if (options.url === "http://127.0.0.1:8000/v1/files/structured-1/content") {
      return jsonResponse({
        pages: [{ page_idx: 0, blocks: [{ type: "text", content: "MinerU result" }] }],
        metadata: { producer: { version: "4.0.0" } }
      });
    }
    throw new Error(`unexpected request ${options.method} ${options.url}`);
  };

  const source = new TextEncoder().encode("fake pdf bytes");
  const progress = [];
  const session = await plugin.parsePdfWithMineruV1(source, {
    name: "paper.pdf",
    path: "Papers/PDFs/paper.pdf",
    pollIntervalMs: 0,
    onProgress: (item) => progress.push(item)
  });
  assert.equal(session.provider, "mineru");
  assert.equal(session.engine, "mineru-v1");
  assert.equal(session.parserVersion, "4.0.0");
  assert.equal(session.pages[0].page, 1);
  assert.equal(session.pages[0].text, "MinerU result");
  assert.equal(session.cacheHit, false);
  assert.ok(progress.some((item) => item.stage === "MinerU 正在解析"));
  assert.equal(calls.find((call) => call.url === "https://storage.example/upload-1").headers.Authorization, undefined,
    "the MinerU bearer token must not leak to a cross-origin signed upload URL");
  assert.equal(calls.find((call) => call.url === "https://storage.example/upload-1").headers["Content-Type"], undefined,
    "the byte upload must preserve the service-provided headers exactly");
  assert.equal(calls.find((call) => call.url.endsWith("/v1/uploads")).headers.Authorization, "Bearer test-token");
  assert.ok([...adapter.files.keys()].some((path) => path.endsWith("/document.md")));
  assert.ok([...adapter.files.keys()].some((path) => path.endsWith("/structured-content.json")));
  assert.ok(![...adapter.files.keys()].some((path) => path.endsWith(".pdf")), "cache must not duplicate the source PDF");

  const networkCallCount = calls.length;
  const cached = await plugin.parsePdfWithMineruV1(source, { name: "paper.pdf", pollIntervalMs: 0 });
  assert.equal(cached.cacheHit, true);
  assert.equal(calls.length, networkCallCount, "a valid cache hit must not contact MinerU again");

  let sameOriginUpload = null;
  requestHandler = async (options) => {
    if (options.url.endsWith("/v1/uploads") && options.method === "POST") {
      return jsonResponse({ id: "upload-2", status: "pending", upload_url: "/v1/uploads/upload-2/content", upload_headers: { "x-upload": "2" } });
    }
    if (options.url.endsWith("/v1/uploads/upload-2/content")) {
      sameOriginUpload = options;
      return { status: 200, text: "" };
    }
    if (options.url.endsWith("/v1/uploads/upload-2/complete")) return jsonResponse({ file: { id: "file-source-2" } });
    if (options.url.endsWith("/v1/parse/jobs") && options.method === "POST") {
      return jsonResponse({ id: "job-2", status: "completed", files: [{ output_files: {
        markdown: { file_id: "markdown-2" }, structured_content: { file_id: "structured-2" }
      } }] });
    }
    if (options.url.endsWith("/v1/files/markdown-2/content")) return { status: 200, text: "Second" };
    if (options.url.endsWith("/v1/files/structured-2/content")) {
      return jsonResponse({ pages: [{ page_idx: 0, blocks: [{ type: "text", content: "Second" }] }] });
    }
    throw new Error(`unexpected same-origin request ${options.method} ${options.url}`);
  };
  await plugin.parsePdfWithMineruV1(new TextEncoder().encode("another pdf"), { name: "second.pdf", pollIntervalMs: 0 });
  assert.equal(sameOriginUpload.headers.Authorization, "Bearer test-token",
    "same-origin upload URLs must retain MinerU authentication");
  assert.deepEqual(Object.keys(sameOriginUpload.headers).sort(), ["Authorization", "x-upload"],
    "the client may add authentication but must otherwise preserve upload_headers exactly");

  requestHandler = async (options) => {
    if (options.url.endsWith("/v1/health")) {
      return jsonResponse({ version: "4.0.0", features: { output_formats: ["markdown", "structured_content"] } });
    }
    if (options.url.endsWith("/v1/parse/jobs?limit=1")) return jsonResponse({ items: [] });
    return jsonResponse({}, 404);
  };
  const health = await plugin.testMineruConnection();
  assert.equal(health.version, "4.0.0");
  assert.equal(plugin.mineruConnectionStatus.ok, true);
}

run().then(() => console.log("MinerU V1 integration tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
