const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const workerSource = fs.readFileSync(path.join(__dirname, "../browser-extension/service-worker.js"), "utf8");
const pdf = Buffer.from("%PDF-1.7 test\n%%EOF");

function worker({ fetchImpl, downloads = {}, tabs = {} } = {}) {
  const context = vm.createContext({
    chrome: {
      storage: { local: { get: async () => ({ paperlibToken: "test-token" }) } },
      runtime: { onMessage: { addListener() {} } }, downloads, tabs
    },
    fetch: fetchImpl, Blob, TextEncoder, TextDecoder, URL, URLSearchParams,
    Uint8Array, DataView, AbortSignal, atob,
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInContext(workerSource, context);
  return (expression) => vm.runInContext(expression, context);
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

(async () => {
  // A publisher can return an ordinary HTML page without CAPTCHA markers,
  // a redirect, or even application/pdf headers. None may create a disk file.
  for (const scenario of ["html", "html-as-pdf", "forbidden", "network", "stale-content-script"]) {
    let diskDownloads = 0;
    let imported = false;
    const noHtmlDownload = worker({ downloads: {
      onChanged: { addListener() {}, removeListener() {} },
      download(_options, callback) { diskDownloads += 1; callback(undefined); }
    }, tabs: { sendMessage: async () => ({ ok: true, base64: Buffer.from("<html>Login</html>").toString("base64") }) }, fetchImpl: async (url) => {
      if (url.endsWith("/api/ping")) return json({ ok: true });
      if (url.endsWith("/api/import")) return json({ ok: false, needsLogin: true });
      if (url.endsWith("/api/import-pdf")) { imported = true; return json({ ok: true }); }
      if (url.includes("semanticscholar.org")) return json(null);
      if (url.includes("export.arxiv.org")) return new Response("<feed></feed>");
      if (scenario === "network") throw new Error("Failed to fetch");
      return new Response("<!DOCTYPE html><html><body>Sign in to view this article</body></html>", {
        status: scenario === "forbidden" ? 403 : 200,
        headers: { "content-type": scenario === "html-as-pdf" ? "application/pdf" : "text/html" }
      });
    } });
    const result = await noHtmlDownload(`importCurrentPaper({title:"Publisher paper",pdfUrl:"https://publisher.test/main.pdf"},true,${scenario === "stale-content-script" ? 42 : "null"})`);
    assert.equal(result.ok, false, scenario);
    assert.equal(diskDownloads, 0, `${scenario}: 未确认 PDF 字节时不应调用浏览器落盘下载`);
    assert.equal(imported, false, `${scenario}: HTML 不应提交为 PDF`);
  }

  let redirectFollowed = false;
  const publisher = http.createServer((req, res) => {
    if (req.url === "/article.pdf") {
      res.writeHead(302, { location: "/login" });
      res.end();
    } else {
      redirectFollowed = true;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>Sign in to view this article</html>");
    }
  });
  await new Promise((resolve) => publisher.listen(0, "127.0.0.1", resolve));
  try {
    const publisherUrl = `http://127.0.0.1:${publisher.address().port}/article.pdf`;
    const run = worker({
      downloads: { download() { assert.fail("重定向到登录页时不应落盘下载"); } },
      fetchImpl: async (url) => {
        if (url.startsWith(publisherUrl)) return fetch(url);
        if (url.endsWith("/api/ping")) return json({ ok: true });
        if (url.endsWith("/api/import")) return json({ ok: false, needsLogin: true });
        if (url.endsWith("/api/import-pdf")) assert.fail("重定向后的 HTML 不应提交为 PDF");
        if (url.includes("export.arxiv.org")) return new Response("<feed></feed>");
        return json(null);
      }
    });
    const result = await run(`importCurrentPaper({title:"Redirected paper",pdfUrl:${JSON.stringify(publisherUrl)}},true,null)`);
    assert.equal(result.ok, false);
    assert.equal(result.code, "needs-login");
    assert.equal(redirectFollowed, true, "应实际跟随 HTTP 重定向并验证最终响应");
  } finally {
    publisher.closeAllConnections();
    await new Promise((resolve) => publisher.close(resolve));
  }

  for (const includePdf of [false, true]) {
    let payload;
    const run = worker({ fetchImpl: async (url, options) => {
      if (url.endsWith("/api/ping")) return json({ ok: true });
      if (url.endsWith("/api/import-pdf")) {
        const bytes = Buffer.from(await options.body.arrayBuffer());
        const length = bytes.readUInt32BE(0);
        payload = JSON.parse(bytes.subarray(4, 4 + length));
        assert.equal(bytes.subarray(4 + length).toString(), pdf.toString());
        return json({ ok: true });
      }
      if (url.endsWith("/api/import")) { payload = JSON.parse(options.body); return json({ ok: true }); }
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    } });
    const result = await run(`importCurrentPaper({title:"Test paper",pdfUrl:"https://publisher.test/main.pdf"},${includePdf},null,"Reading/加工")`);
    assert.equal(result.ok, true);
    assert.deepEqual(payload.metadata.collections, ["Reading/加工"], "两种导入通道都应传递所选分类");
  }

  let attemptedDownload = false;
  let attemptedImport = false;
  const challenge = worker({ fetchImpl: async (url) => {
    if (url.endsWith("/api/ping")) return json({ ok: true });
    if (url.includes("/api/import")) attemptedImport = true;
    return new Response("<html><h1>Are you a robot?</h1><p>captcha challenge</p></html>", { status: 403 });
  }, downloads: { download() { attemptedDownload = true; } } });
  const result = await challenge('importCurrentPaper({title:"Inconel 718",pdfUrl:"https://www.sciencedirect.com/science/article/pii/S0020740326008489/pdfft"},true,null)');
  assert.equal(result.code, "needs-verification");
  assert.match(result.pdfUrl, /S0020740326008489/);
  assert.equal(attemptedDownload, false, "验证页面不应下载成假 PDF");
  assert.equal(attemptedImport, false, "验证 HTML 不应提交入库");
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      value: "", children: [], disabled: false,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name), toggle(name, force) {
          const show = force === undefined ? !classes.has(name) : force;
          if (show) classes.add(name); else classes.delete(name);
          return show;
        } },
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
      get childElementCount() { return this.children.length; }
    };
  }
  const popup = vm.createContext({ document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element
  }, Intl, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../browser-extension/popup.js"), "utf8").replace("void initialize();", ""), popup);
  vm.runInContext('currentPaper = {title:"Existing paper"}; collectionsReady = true; ui.collection.value = "Reading"; renderLibraryPaper({title:"Existing paper",hasPdf:false,collections:["Reading"]})', popup);
  assert.equal(elements.get("import-actions").classList.contains("hidden"), false);
  assert.equal(elements.get("import-pdf-btn").classList.contains("hidden"), false, "仅元数据条目应仍能补充 PDF");
  assert.equal(elements.get("import-pdf-btn").textContent, "下载并补充 PDF");
  vm.runInContext('renderLibraryPaper({title:"Existing paper",hasPdf:true,collections:["Reading"]})', popup);
  assert.equal(elements.get("import-pdf-btn").classList.contains("hidden"), true);
  assert.equal(elements.get("metadata-btn").disabled, false, "已有 PDF 时仍可添加 Collection");
  vm.runInContext('setBusy(true)', popup);
  assert.equal(elements.get("collection-select").disabled, true);
  assert.equal(elements.get("metadata-btn").disabled, true);
  vm.runInContext('currentPaper = {title:"Video",isPaper:false}; render(currentPaper); renderLibraryPaper(null)', popup);
  assert.equal(elements.get("empty-card").classList.contains("hidden"), false);
  assert.equal(elements.get("import-pdf-btn").disabled, true, "非论文网页不应启用下载");
  let popupImports = 0;
  popup.chrome = { runtime: { sendMessage: async (message) => {
    if (message.type === "paperlib:import") popupImports += 1;
    return undefined;
  } } };
  vm.runInContext('currentPaper = {title:"Publisher paper"}; importing = false; renderLibraryPaper(null)', popup);
  await vm.runInContext("refreshCollections()", popup);
  assert.match(elements.get("collection-state").textContent, /扩展后台尚未更新/);
  assert.equal(elements.get("import-pdf-btn").disabled, true);
  assert.equal(elements.get("metadata-btn").disabled, true);
  await vm.runInContext("importPaper(true)", popup);
  assert.equal(popupImports, 0, "分类握手失败时不应调用旧后台的下载实现");
  popup.chrome.runtime.sendMessage = async () => ({ ok: true, collections: [] });
  await vm.runInContext("refreshCollections()", popup);
  assert.equal(elements.get("import-pdf-btn").disabled, false, "有效的空分类列表仍可保存到未分类");
  assert.equal(elements.get("metadata-btn").disabled, false);
  const detectorSource = fs.readFileSync(path.join(__dirname, "../browser-extension/detector.js"), "utf8");
  function detectPage(href, metadata) {
    let listener;
    const location = new URL(href);
    const context = vm.createContext({ location, URL,
      document: { contentType: "text/html", title: metadata["og:title"] || "Page",
        querySelector(selector) {
          const name = selector.match(/meta\[name="([^"]+)"\]/)?.[1];
          return metadata[name] ? { getAttribute: () => metadata[name] } : null;
        }, querySelectorAll: () => [] },
      chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }
    });
    vm.runInContext(detectorSource, context);
    let paper;
    listener({ type: "paperlib:detect" }, null, (value) => { paper = value; });
    return paper;
  }
  const article = detectPage("https://www.sciencedirect.com/science/article/pii/S0020740326008489", {
    citation_title: "Ultrasonic oblique vibration cutting for Inconel 718: Mechanisms and performance",
    citation_doi: "10.1016/j.ijmecsci.2026.111994",
    citation_pdf_url: "https://www.sciencedirect.com/science/article/pii/S0020740326008489/pdfft"
  });
  assert.equal(article.isPaper, true);
  assert.match(article.pdfUrl, /S0020740326008489\/pdfft/);
  assert.equal(detectPage("https://www.bilibili.com/video/BV1WbpR6HEbj/", { "og:title": "Video title" }).isPaper, false);
  console.log("Browser extension tests passed: no HTML disk downloads, binary/metadata collection forwarding and ScienceDirect challenge handling");
})().catch((error) => { console.error(error); process.exitCode = 1; });
