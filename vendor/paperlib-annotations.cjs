// Paper Library's native PDF selection and annotation manager. Independently implemented.
const { ItemView, Notice, Setting, setIcon, normalizePath } = require("obsidian");

const STYLES = [
  { id: "Highlight", label: "高亮" },
  { id: "Underline", label: "下划线" }
];
// Keep old records readable/deletable without offering these styles for new marks.
const LEGACY_STYLES = [
  { id: "Squiggly", label: "波浪线" },
  { id: "StrikeOut", label: "删除线" },
  { id: "Text", label: "文字注释" },
  { id: "Ink", label: "自由画笔" }
];
const COLORS = [
  { id: "yellow", label: "黄色", value: "#ffd65a", meaning: "重点" },
  { id: "orange", label: "橙色", value: "#ff9f43", meaning: "结论" },
  { id: "green", label: "绿色", value: "#7bd88f", meaning: "方法" },
  { id: "blue", label: "蓝色", value: "#6ab7ff", meaning: "数据" },
  { id: "pink", label: "粉色", value: "#ff86b7", meaning: "疑问" }
];
const normalizeSubtype = (value) => [...STYLES, ...LEGACY_STYLES].find(s => s.id !== "Ink" && s.id === value)?.id || "Highlight";
function styleForRecord(settings, record) {
  const id = record.type === "ink" ? "Ink" : normalizeSubtype(record.pdfSubtype);
  const base = [...STYLES, ...LEGACY_STYLES].find(s => s.id === id);
  return { ...base };
}
function colorForRecord(settings, record) {
  const base = COLORS.find(c => c.id === String(record.color).toLowerCase()) || COLORS[0];
  const saved = settings?.annotationColorMeanings;
  return { ...base, meaning: typeof saved?.[base.id] === "string" ? saved[base.id] : base.meaning };
}
// Round each text fragment, not the paragraph bounding box. One compound path
// still paints overlapping selection fragments only once. PDF-point radii scale
// with the native viewport, including rotated pages and on-demand PDF export.
function highlightCornerRadius(mark) {
  return Number.isFinite(mark.highlightCornerRadius) ? Math.max(0, mark.highlightCornerRadius)
    : mark.storageMode === "overlay" ? 2 : 0;
}
function roundedQuadPath(points, radius, pdf = false) {
  if (points.length !== 4 || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) return "";
  const command = (op, ...values) => pdf ? `${values.flat().join(" ")} ${op.toLowerCase()}` : `${op} ${values.flat().join(" ")}`;
  const edges = points.map((p, i) => Math.hypot(p[0] - points[(i + 1) % 4][0], p[1] - points[(i + 1) % 4][1]));
  const r = Math.max(0, Math.min(radius || 0, ...edges.map(n => n / 2)));
  if (!r) return [command("M", points[0]), ...points.slice(1).map(p => command("L", p)), pdf ? "h" : "Z"].join(" ");
  const towards = (a, b, distance) => {
    const t = distance / Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const corners = points.map((p, i) => ({ p, before: towards(p, points[(i + 3) % 4], r), after: towards(p, points[(i + 1) % 4], r) }));
  const commands = [command("M", corners[0].after)];
  for (let i = 1; i <= 4; i++) {
    const { p, before, after } = corners[i % 4];
    const control = a => a.map((n, axis) => n + (p[axis] - n) * 2 / 3);
    commands.push(command("L", before), command("C", control(before), control(after), after));
  }
  return [...commands, pdf ? "h" : "Z"].join(" ");
}
function annotationPopupPosition(anchor, box, bounds) {
  const gap = 10, margin = 8;
  const left = Math.max(bounds.left + margin, Math.min(bounds.right - margin - box.width,
    anchor.left + (anchor.width || 0) / 2 - box.width / 2));
  const above = anchor.top - gap - box.height, below = anchor.bottom + gap;
  const top = above >= bounds.top + margin ? above : below + box.height <= bounds.bottom - margin ? below
    : Math.max(bounds.top + margin, Math.min(bounds.bottom - margin - box.height, below));
  return { left, top };
}
function annotationAppearanceCommands(mark, bounds) {
  const type = normalizeSubtype(mark.pdfSubtype);
  const commands = (mark.pdfRects || []).map(({ rect, quad }) => {
    const x = rect[0] - bounds[0], y = rect[1] - bounds[1];
    const width = Math.max(.1, rect[2] - rect[0]), height = Math.max(.1, rect[3] - rect[1]);
    // One compound fill paints overlaps once, instead of stacking translucent ink.
    if (type === "Highlight") {
      const radius = highlightCornerRadius(mark);
      if (!radius) return `${x} ${y} ${width} ${height} re`;
      const points = quad?.length === 8 && quad.every(Number.isFinite)
        ? [0, 2, 6, 4].map(i => [quad[i] - bounds[0], quad[i + 1] - bounds[1]])
        : [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
      return roundedQuadPath(points, radius, true);
    }
    const lineY = type === "StrikeOut" ? y + height / 2 : y + .8;
    if (type !== "Squiggly") return `1 w ${x} ${lineY} m ${x + width} ${lineY} l S`;
    const points = [`1 w ${x} ${lineY} m`];
    for (let dx = 1.5, step = 1; dx < width; dx += 1.5, step++) points.push(`${x + dx} ${lineY + (step % 2 ? 1.3 : 0)} l`);
    points.push(`${x + width} ${lineY} l S`);
    return points.join(" ");
  }).join("\n");
  return type === "Highlight" && commands ? `${commands}\nf` : commands;
}
function paintAnnotationPreview(context, mark, viewport, box, clip, copy) {
  const type = normalizeSubtype(mark?.pdfSubtype);
  if (!mark?.pdfRects?.length || !viewport?.convertToViewportRectangle || !["Highlight", "Underline"].includes(type)) return false;
  context.save();
  try {
    context.setTransform(copy.width / clip.width * box.width / viewport.width, 0,
      0, copy.height / clip.height * box.height / viewport.height,
      (box.left - clip.left) * copy.width / clip.width, (box.top - clip.top) * copy.height / clip.height);
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = type === "Highlight" ? .38 : 1;
    context.fillStyle = context.strokeStyle = colorForRecord({}, mark).value;
    context.beginPath();
    for (const { rect } of mark.pdfRects) {
      if (type === "Highlight") {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
        context.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else {
        const a = viewport.convertToViewportPoint(rect[0], rect[1] + .8);
        const b = viewport.convertToViewportPoint(rect[2], rect[1] + .8);
        context.moveTo(...a); context.lineTo(...b);
      }
    }
    if (type === "Highlight") context.fill();
    else { context.lineWidth = viewport.scale || 1; context.stroke(); }
    return true;
  } finally { context.restore(); }
}
function button(parent, text, action, className = "") {
  const el = parent.createEl("button", { text, cls: className, attr: { type: "button" } });
  el.addEventListener("click", action);
  return el;
}
function select(parent, label, options, value, onChange) {
  const wrapper = parent.createEl("label", { cls: "paperlib-annotation-filter" });
  wrapper.createSpan({ text: label });
  const el = wrapper.createEl("select");
  for (const [id, text] of options) el.createEl("option", { text, attr: { value: id } });
  el.value = value;
  el.addEventListener("change", () => onChange(el.value));
  return el;
}
function updateRemarkBlock(content, ids, previous, comment, appearance = null) {
  const lines = String(content).split("\n");
  const quote = value => String(value || "").split("\n").map((line, i) => `> ${i === 0 ? "**批注：** " : ""}${line}`);
  for (const id of ids) {
    const marker = lines.findIndex(line => line.trim() === `^${id}`);
    if (marker < 0) continue;
    let start = marker - 1;
    while (start >= 0 && !/^> \[!pdf(?:\||\])/.test(lines[start])) {
      if (/^\^|^#{1,6} /.test(lines[start])) { start = -1; break; }
      start--;
    }
    if (start < 0) continue;
    if (appearance) {
      // Only the generated metadata in this exact ID's block is changed.
      lines[start] = lines[start].replace(/^> \[!pdf(?:\|[^\]]*)?\]\+ (?:高亮|下划线) · p\. (\d+)$/,
        `> [!pdf|${appearance.color}]+ ${STYLES.find(s => s.id === appearance.pdfSubtype).label} · p. $1`);
      if (appearance.oldLink && appearance.newLink) for (let i = start + 1; i < marker; i++)
        if (lines[i].startsWith("> [[")) lines[i] = lines[i].replace(appearance.oldLink, appearance.newLink);
    }
    const remark = lines.findIndex((line, i) => i > start && i < marker && /^> \*\*批注：\*\*/.test(line));
    if (remark >= 0) {
      let end = remark + 1;
      while (end < marker && /^> .+/.test(lines[end]) && !/^> \[\[/.test(lines[end])) end++;
      const actual = lines.slice(remark, end).join("\n");
      if (actual !== quote(previous).join("\n") && actual !== quote(comment).join("\n")) throw new Error("笔记中的备注已被修改，请保留笔记内容后重试");
      lines.splice(remark, end - remark, ...(comment ? quote(comment) : []));
    } else if (comment) {
      const link = lines.findIndex((line, i) => i > start && i < marker && /^> \[\[.*\|打开原文高亮/.test(line));
      lines.splice(link >= 0 ? link : marker, 0, ...quote(comment), ">");
    }
    break;
  }
  return lines.join("\n");
}
function remarkEditor(plugin, parent, entry, state, onSaved, onCancel) {
  const root = parent.createDiv({ cls: "paperlib-annotation-remark-editor" });
  state.root = root;
  const label = root.createEl("label", { cls: "paperlib-annotation-remark-label", text: "标注备注" });
  const note = label.createEl("textarea", { attr: { rows: "4", placeholder: "写下想法或问题（可选）" } });
  note.value = state.comment;
  note.addEventListener("input", () => { state.comment = note.value; });
  const status = root.createDiv({ cls: "paperlib-annotation-error", attr: { role: "status" } });
  const actions = root.createDiv({ cls: "paperlib-annotation-remark-actions" });
  const cancel = button(actions, "取消", onCancel);
  const save = button(actions, "保存备注", () => void commit(), "paperlib-annotation-remark-save");
  const renderState = () => {
    root.setAttribute("aria-busy", String(Boolean(state.saving)));
    note.disabled = save.disabled = cancel.disabled = Boolean(state.saving);
    status.setText(state.saving ? "正在保存…" : state.error || "");
    status.classList.toggle("is-error", Boolean(state.error));
  };
  state.render = renderState;
  const commit = async () => {
    if (state.saving || plugin.disposed) return;
    state.comment = note.value;
    state.saving = true; state.error = ""; renderState();
    try {
      await plugin.updateManagedAnnotationRemark(entry, state.comment, state.previous);
      state.saving = false; onSaved();
    } catch (error) {
      state.saving = false; state.error = error.message || String(error);
      if (state.root?.isConnected) state.render();
      else if (!plugin.disposed) new Notice(`备注保存失败：${state.error}`);
    }
  };
  note.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
    if (event.key === "Escape" && !state.saving) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  });
  renderState(); return note;
}

const eltonCore = require("./elton-annotation-core.cjs");
function install(Plugin, { ANNOTATION_VIEW_TYPE, RESEARCH_VIEW_TYPE, openFigure }) {
  class PdfFiguresPanel {
    constructor(container, plugin, source) {
      this.plugin = plugin;
      this.app = plugin.app;
      this.containerEl = container;
      this.contentEl = container;
      this.source = source;
      this.generation = 0;
      this.closed = false;
    }
    close() { this.closed = true; this.clearFigures(); }
    clearFigures() {
      this.generation++;
      this.observer?.disconnect();
      this.queue = [];
      this.contentEl?.querySelectorAll("canvas").forEach(canvas => { canvas.width = 0; canvas.height = 0; });
      this.contentEl?.empty();
    }
    render() {
      if (this.closed || !this.contentEl?.isConnected) return;
      const source = this.source;
      const key = source?.path || "";
      if (this.sourceKey === key && this.contentEl.firstChild) return;
      this.clearFigures();
      this.sourceKey = key;
      const token = this.generation;
      const root = this.contentEl.createDiv({ cls: "paperlib-figures-sidebar" });
      const heading = root.createDiv({ cls: "paperlib-figures-sidebar-heading" });
      heading.createEl("h3", { text: "文献图片" });
      if (source) heading.createDiv({ cls: "paperlib-figures-source", text: source.paper?.title || source.file.basename });
      const list = root.createDiv({ cls: "paperlib-figures-sidebar-list" });
      if (!source) { list.createDiv({ text: "打开 PDF 或选择一篇有 PDF 的文献。" }); return; }
      const status = list.createDiv({ cls: "paperlib-figures-sidebar-status", text: "正在读取图片…" });
      void this.plugin.getPdfFigureCatalog(source.path).then(catalog => {
        if (token !== this.generation || this.closed || !list.isConnected) return;
        status.setText(catalog.figures.length ? `${catalog.figures.length} 张图片` : "没有识别到图片。");
        const win = this.containerEl.ownerDocument.defaultView;
        const pump = () => {
          if (token !== this.generation || this.closed) return;
          while (this.queue.length && active < 2) {
            const { card, canvas, figure } = this.queue.shift();
            active++;
            void this.plugin.renderPdfFigure(source.path, figure, canvas, { thumbnail: true })
              .then(() => { if (token === this.generation) card.classList.remove("is-loading"); })
              .catch(() => {
                if (token === this.generation) {
                  card.classList.remove("is-loading");
                  card.classList.add("is-error");
                  card.querySelector(".paperlib-figure-load-state").setText("预览加载失败，点击重试");
                }
              }).finally(() => {
                active--;
                if (token !== this.generation || this.closed) { canvas.width = 0; canvas.height = 0; }
                pump();
              });
          }
        };
        let active = 0;
        const enqueue = card => {
          if (card.dataset.queued || token !== this.generation) return;
          card.dataset.queued = "true";
          this.queue.push({ card, canvas: card.querySelector("canvas"), figure: catalog.figures[Number(card.dataset.index)] });
          pump();
        };
        this.observer = typeof win.IntersectionObserver === "function"
          ? new win.IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting) { this.observer.unobserve(entry.target); enqueue(entry.target); }
          }, { root: list, rootMargin: "160px" }) : null;
        catalog.figures.forEach((figure, index) => {
          const card = list.createEl("button", { cls: "paperlib-figure-sidebar-card is-loading", attr: { type: "button" } });
          card.dataset.index = String(index);
          const preview = card.createDiv({ cls: "paperlib-figure-sidebar-preview" });
          preview.createEl("canvas");
          preview.createSpan({ cls: "paperlib-figure-load-state", text: "加载预览…" });
          const meta = card.createDiv({ cls: "paperlib-figure-sidebar-meta" });
          meta.createEl("strong", { text: figure.label || `Figure ${index + 1}` });
          meta.createSpan({ text: `第 ${figure.pageNumber} 页` });
          if (figure.caption) card.createEl("p", { text: figure.caption });
          card.addEventListener("click", () => {
            if (card.classList.contains("is-error")) {
              card.classList.remove("is-error"); card.classList.add("is-loading");
              delete card.dataset.queued; enqueue(card); return;
            }
            openFigure(this.plugin, source, catalog.figures, index);
          });
          if (this.observer) this.observer.observe(card);
          else enqueue(card);
        });
      }).catch(error => {
        if (token !== this.generation || this.closed) return;
        status.setText(`图片暂不可用：${error.message || error}`);
        button(list, "重试", () => { this.sourceKey = null; this.render(); });
      });
    }
  }

  class AnnotationManagerView extends ItemView {
    constructor(leaf, plugin) {
      super(leaf);
      this.plugin = plugin;
      this.filters = { scope: "current", style: "", color: "", query: "" };
      this.remarkDrafts = new Map();
    }
    getViewType() { return ANNOTATION_VIEW_TYPE; }
    getDisplayText() { return "标注管理"; }
    getIcon() { return "highlighter"; }
    getState() { return { filters: this.filters }; }
    async setState(state, result) {
      const filters = state?.filters || {};
      this.filters = {
        scope: filters.scope === "all" ? "all" : "current",
        style: STYLES.some(s => s.id === filters.style) ? filters.style : "",
        color: COLORS.some(c => c.id === filters.color) ? filters.color : "",
        query: String(filters.query || "").slice(0, 500)
      };
      this.render();
      await super.setState(state, result);
    }
    async onOpen() { this.render(); }
    async onClose() { this.remarkDrafts.clear(); this.containerEl.querySelector(".paperlib-annotation-manager")?.remove(); }
    render() {
      const content = this.contentEl || this.containerEl.querySelector(".view-content");
      if (!content) return;
      content.empty();
      const root = content.createDiv({ cls: "paperlib-annotation-manager" });
      const header = root.createDiv({ cls: "paperlib-annotation-manager-heading" });
      header.createEl("h3", { text: "标注管理" });
      const controls = root.createDiv({ cls: "paperlib-annotation-filters" });
      const change = (key, value) => { this.filters[key] = value; this.renderList(); };
      select(controls, "范围", [["current", "当前文献"], ["all", "全部文献"]], this.filters.scope, v => change("scope", v));
      select(controls, "样式", [["", "全部样式"], ...STYLES.map(s => [s.id, s.label])], this.filters.style, v => change("style", v));
      select(controls, "颜色", [["", "全部颜色"], ...COLORS.map(c => [c.id, c.label])], this.filters.color, v => change("color", v));
      const searchLabel = root.createEl("label", { cls: "paperlib-annotation-search" });
      searchLabel.createSpan({ text: "搜索标注" });
      const input = searchLabel.createEl("input", { attr: { type: "search", placeholder: "正文、备注、含义或文献标题", value: this.filters.query } });
      input.addEventListener("input", () => change("query", input.value));
      this.summary = root.createDiv({ cls: "paperlib-annotation-summary" });
      this.list = root.createDiv({ cls: "paperlib-annotation-list" });
      this.renderList();
    }
    renderList() {
      if (!this.list?.isConnected) return;
      const scroll = this.list.scrollTop;
      const active = this.containerEl.ownerDocument.activeElement;
      const focusedId = active?.closest?.(".paperlib-annotation-card")?.dataset.annotationId;
      const selection = active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
      const paper = this.plugin.getCurrentAnnotationPaper();
      const all = this.plugin.getManagedAnnotations(this.filters.scope === "current" ? paper?.id || "missing" : null);
      const liveIds = new Set(this.plugin.getManagedAnnotations().map(entry => entry.record.id));
      for (const id of this.remarkDrafts.keys()) if (!liveIds.has(id)) this.remarkDrafts.delete(id);
      const entries = filterAnnotations(all, this.filters, this.plugin.settings);
      this.summary.setText(`${this.filters.scope === "current" ? paper?.title || "请选择一篇文献" : "全部文献"} · ${entries.length} / ${all.length} 条标注`);
      this.list.empty();
      if (!entries.length) this.list.createDiv({ cls: "paperlib-annotation-empty", text: all.length ? "没有符合筛选条件的标注" : "暂无标注。选中 PDF 文字即可添加。" });
      for (const entry of entries) {
        const { record, paper } = entry;
        const style = styleForRecord(this.plugin.settings, record);
        const color = colorForRecord(this.plugin.settings, record);
        const card = this.list.createEl("article", { cls: "paperlib-annotation-card" });
        card.dataset.annotationId = record.id;
        card.style.setProperty("--annotation-color", color.value);
        const head = card.createDiv({ cls: "paperlib-annotation-card-heading" });
        const badge = head.createSpan({ cls: "paperlib-annotation-style-badge", text: style.label });
        badge.dataset.style = style.id;
        head.createSpan({ text: `第 ${record.page || 1} 页 · ${color.label}` });
        if (this.filters.scope === "all") card.createDiv({ cls: "paperlib-annotation-paper-title", text: paper.title });
        card.createDiv({ cls: "paperlib-annotation-quote", text: record.text || (record.type === "ink" ? "自由画笔标记" : "文字注释") });
        if (record.comment && !this.remarkDrafts.has(record.id)) card.createDiv({ cls: "paperlib-annotation-comment", text: `备注：${record.comment}` });
        const actions = card.createDiv({ cls: "paperlib-annotation-card-actions" });
        button(actions, "回到原文", () => void this.plugin.openResearchSource(paper, record));
        const edit = button(actions, "编辑备注", () => {
          if (this.remarkDrafts.has(record.id)) return;
          this.remarkDrafts.set(record.id, { comment: record.comment || "", previous: record.comment || "" });
          this.renderList();
          [...this.list.querySelectorAll("article")].find(el => el.dataset.annotationId === record.id)?.querySelector("textarea")?.focus();
        }, "paperlib-annotation-edit");
        const draft = this.remarkDrafts.get(record.id);
        edit.disabled = Boolean(draft);
        const remove = button(actions, "删除", async () => {
          remove.disabled = true;
          try { await this.plugin.deleteManagedAnnotation(entry); }
          catch (error) { new Notice(`删除标注失败：${error.message || error}`); remove.disabled = false; }
        }, "paperlib-annotation-delete");
        remove.disabled = Boolean(draft?.saving);
        if (draft) remarkEditor(this.plugin, card, entry, draft,
          () => { this.remarkDrafts.delete(record.id); this.renderList(); },
          () => { this.remarkDrafts.delete(record.id); this.renderList(); });
      }
      this.list.scrollTop = scroll;
      if (selection && focusedId) {
        const note = [...this.list.querySelectorAll("article")].find(el => el.dataset.annotationId === focusedId)?.querySelector("textarea");
        if (note && !note.disabled) { note.focus({ preventScroll: true }); note.setSelectionRange(...selection); }
      }
    }
  }

  // A saved old workspace restores directly into the native reader; no canvas is rendered.
  class LegacyPdfRedirectView extends ItemView {
    getViewType() { return RESEARCH_VIEW_TYPE; }
    getDisplayText() { return "PDF"; }
    getIcon() { return "file-text"; }
    async setState(state, result) {
      await super.setState(state, result);
      const paper = this.plugin.settings.papers.find(p => p.id === state?.paperId);
      const timer = this.containerEl.ownerDocument.defaultView.setTimeout(async () => {
        if (this.leaf.view !== this || this.plugin.disposed) return;
        try {
          const file = paper && this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath || ""));
          if (file?.extension === "pdf") await this.leaf.openFile(file);
          else await this.leaf.setViewState({ type: "empty" });
        } catch (error) { new Notice(`打开 PDF 失败：${error.message || error}`); }
      }, 0);
      this.register(() => this.containerEl.ownerDocument.defaultView.clearTimeout(timer));
    }
  }

  Object.assign(Plugin.prototype, {
    setupAnnotationFeatures() {
      this.registerView(ANNOTATION_VIEW_TYPE, leaf => new AnnotationManagerView(leaf, this));
      this.addCommand({ id: "open-paper-figures", name: "打开文献信息中的图片", callback: () => this.ensureFiguresView(true) });
      this.registerView(RESEARCH_VIEW_TYPE, leaf => {
        const view = new LegacyPdfRedirectView(leaf);
        view.plugin = this;
        return view;
      });
      this.addCommand({ id: "open-annotation-manager", name: "打开标注管理", callback: () => this.ensureAnnotationView(true) });
      this.addCommand({ id: "embed-paper-annotations", name: "将当前文献标注写入 PDF", callback: async () => {
        const paper = this.getCurrentAnnotationPaper();
        if (!paper) return new Notice("请先选择文献");
        try { await this.embedOverlayAnnotations(paper); }
        catch (error) { new Notice(`写入 PDF 失败：${error.message || error}`); }
      } });
      this.addRibbonIcon("highlighter", "标注管理", () => this.ensureAnnotationView(true));
      this.registerEvent(this.app.workspace.on("file-open", file => {
        const paper = this.getPaperForPdfFile(file) || this.settings.papers.find(p => p.notePath === file?.path);
        if (paper) this.annotationCurrentPaperId = paper.id;
        this.closeSelectionAnnotationPopup();
        this.closeAnnotationRemarkPopup();
        this.refreshAnnotationViews();
        if (file?.extension === "pdf") this.figureSidebarPath = file.path;
        else if (paper?.pdfPath) this.figureSidebarPath = paper.pdfPath;
        this.refreshFiguresViews();
      }));
      this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
        if (this.selectionAnnotationPopup?.sourceLeaf && this.selectionAnnotationPopup.sourceLeaf !== leaf)
          this.closeSelectionAnnotationPopup();
      }));
      // Also follow selections made with touch handles and keyboard shortcuts.
      const pointerDown = event => {
        if (event.target?.closest?.(".textLayer")) this.annotationSelecting = true;
      };
      const pointerUp = () => { this.annotationSelecting = false; };
      const selectionChanged = () => {
        if (this.annotationSelecting || this.selectionAnnotationPopup || this.annotationRemarkPopup || this.disposed) return;
        const selection = document.defaultView.getSelection();
        const node = selection?.anchorNode;
        const layer = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(".textLayer");
        if (!layer || selection.isCollapsed) return;
        const leaf = this.app.workspace.getLeavesOfType("pdf").find(l => l.view?.containerEl?.contains(layer));
        if (!leaf || ["ink", "ai-region"].includes(this.nativePdfStates.get(leaf.view.containerEl)?.mode)) return;
        this.scheduleSelectionAnnotationPopup(leaf, leaf.view.containerEl);
      };
      this.registerDomEvent(document, "pointerdown", pointerDown, true);
      this.registerDomEvent(document, "pointerup", pointerUp, true);
      this.registerDomEvent(document, "pointercancel", pointerUp, true);
      this.registerDomEvent(document, "selectionchange", selectionChanged);
      this.app.workspace.onLayoutReady(() => {
        if (!this.disposed) void this.ensureAnnotationView(false).catch(error => console.warn("Paper Library: annotation sidebar unavailable", error));
      });
      this.register(() => {
        this.closeSelectionAnnotationPopup();
        this.closeAnnotationRemarkPopup();
        this.annotationEditDrafts?.clear();
        this.app.workspace.detachLeavesOfType(RESEARCH_VIEW_TYPE);
      });
    },
    async ensureAnnotationView(reveal = false) {
      let leaf = this.app.workspace.getLeavesOfType(ANNOTATION_VIEW_TYPE)[0];
      if (!leaf) {
        leaf = this.app.workspace.getRightLeaf?.(false) || this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: ANNOTATION_VIEW_TYPE, active: reveal });
      }
      if (reveal) await this.app.workspace.revealLeaf(leaf);
      leaf.view?.renderList?.();
      return leaf;
    },
    getFigureSidebarSource(targetPaper = null) {
      const active = this.app.workspace.getActiveFile?.();
      const paper = this.settings.papers.find(p => p.id === this.uiState.selectedId);
      const path = targetPaper
        ? active?.extension === "pdf" && this.getPaperForPdfFile(active)?.id === targetPaper.id ? active.path : targetPaper.pdfPath
        : active?.extension === "pdf" ? active.path : this.figureSidebarPath || paper?.pdfPath;
      const file = path && this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (file?.extension !== "pdf") return null;
      return { path: file.path, file, paper: this.getPaperForPdfFile(file) };
    },
    async ensureFiguresView(reveal = false) {
      const source = this.getFigureSidebarSource();
      if (source?.paper) this.uiState.selectedId = source.paper.id;
      this.uiState.detailTab = "figures";
      const leaf = await this.ensureDetailView(reveal);
      leaf.view?.render?.();
      return leaf;
    },
    createFiguresPanel(container, paper) {
      const panel = new PdfFiguresPanel(container, this, this.getFigureSidebarSource(paper));
      panel.render();
      return panel;
    },
    refreshFiguresViews() {
      if (this.uiState.detailTab !== "figures") return;
      const file = this.app.workspace.getActiveFile?.();
      const paper = file?.extension === "pdf" && this.getPaperForPdfFile(file);
      if (paper) this.uiState.selectedId = paper.id;
      this.refreshDetailViews();
    },
    getCurrentAnnotationPaper() {
      const file = this.app.workspace.getActiveFile?.();
      return this.getPaperForPdfFile(file)
        || this.settings.papers.find(p => p.notePath && p.notePath === file?.path)
        || this.settings.papers.find(p => p.id === this.annotationCurrentPaperId)
        || this.settings.papers.find(p => p.id === (this.uiState.activePdfPaperId || this.uiState.selectedId));
    },
    getManagedAnnotations(paperId = null) {
      const result = [];
      for (const paper of this.settings.papers) {
        if (paperId && paperId !== paper.id) continue;
        const seen = new Set();
        const add = (source, record) => {
          const key = record?.pdfAnnotationId || record?.annotationId || record?.id;
          if (!key || seen.has(key)) return;
          seen.add(key);
          result.push({ paper, source, record });
        };
        // Read all paths, including supplementary PDFs; listing must not mutate user data.
        for (const record of paper.annotations || []) add("annotation", record);
        for (const record of paper.researchWorkspace?.highlights || []) add("canvas-highlight", record);
        for (const record of paper.researchWorkspace?.nodes || []) if (record.type === "excerpt") add("legacy-node", record);
        for (const record of paper.researchWorkspace?.inkStrokes || []) add("ink", record);
      }
      return result.sort((a, b) => String(b.record.createdAt || "").localeCompare(String(a.record.createdAt || "")));
    },
    refreshAnnotationViews() {
      for (const leaf of this.app.workspace?.getLeavesOfType?.(ANNOTATION_VIEW_TYPE) || []) leaf.view?.renderList?.();
    },
    beginNativePdfWriteTransition(file, options = {}) {
      // Do not intercept onModify or suppress Vault events. The native reader must
      // see the saved bytes (and external edits). Bridge its blank repaint with
      // short-lived, viewport-only raster copies, never a second PDF document.
      const transitions = [];
      this.nativePdfWriteTransitions ||= new Set();
      let remainingPixels = 4 * 1024 * 1024 - [...this.nativePdfWriteTransitions].reduce((sum, t) => sum + t.pixels, 0);
      for (const leaf of this.app.workspace?.getLeavesOfType?.("pdf") || []) {
        const view = leaf.view;
        if (this.disposed || view?.file !== file) continue;
        const host = view.containerEl?.querySelector?.(".pdf-container");
        const doc = host?.ownerDocument, win = doc?.defaultView;
        const native = view.viewer?.child?.pdfViewer;
        const bus = native?.eventBus;
        // These are version-checked, optional native internals. Unsupported hosts
        // still save/reload normally; they do not lose annotations.
        if (!host?.isConnected || doc.hidden || !native?.pdfDocument || !bus?.on || !bus?.off) continue;
        const bounds = host.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) continue;
        const beforeDocument = native.pdfDocument;
        const root = doc.createElement("div");
        root.className = "paperlib-pdf-write-transition";
        root.setAttribute("aria-hidden", "true");
        Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none", zIndex: "5" });
        const copies = new Map();
        let pixels = 0;
        for (const source of host.querySelectorAll(".page .canvasWrapper canvas")) {
          if (!source.width || !source.height) continue;
          const box = source.getBoundingClientRect();
          const left = Math.max(box.left, bounds.left, 0), top = Math.max(box.top, bounds.top, 0);
          const right = Math.min(box.right, bounds.right, win.innerWidth), bottom = Math.min(box.bottom, bounds.bottom, win.innerHeight);
          const width = right - left, height = bottom - top;
          const pageNumber = Number(source.closest(".page")?.dataset.pageNumber);
          if (width < 1 || height < 1 || !pageNumber || copies.has(pageNumber) || remainingPixels < width * height / 4) continue;
          const ratio = Math.min(source.width / box.width, Math.sqrt(remainingPixels / (width * height)));
          const copy = doc.createElement("canvas");
          copy.width = Math.max(1, Math.floor(width * ratio));
          copy.height = Math.max(1, Math.floor(height * ratio));
          try {
            const context = copy.getContext("2d");
            if (!context) { copy.width = copy.height = 0; continue; }
            context.drawImage(source, (left - box.left) * source.width / box.width,
              (top - box.top) * source.height / box.height, width * source.width / box.width,
              height * source.height / box.height, 0, 0, copy.width, copy.height);
            if (Number(options.previewMark?.page) === pageNumber) {
              const viewport = native.pdfViewer?.getPageView?.(pageNumber - 1)?.viewport;
              if (paintAnnotationPreview(context, options.previewMark, viewport, box, { left, top, width, height }, copy)) {
                copy.dataset.previewColor = options.previewMark.color;
              }
            }
          } catch (_) { copy.width = copy.height = 0; continue; }
          Object.assign(copy.style, { position: "absolute", left: `${left - bounds.left}px`, top: `${top - bounds.top}px`, width: `${width}px`, height: `${height}px` });
          root.appendChild(copy);
          copies.set(pageNumber, copy);
          pixels += copy.width * copy.height;
          remainingPixels -= copy.width * copy.height;
        }
        if (!copies.size) continue;
        // A self-write reload otherwise applies the reader's default zoom, not
        // the zoom/position currently on screen. Restore at initial-view setup,
        // before painting, rather than zooming a freshly rendered page again.
        const viewer = native.pdfViewer;
        const location = viewer?._location;
        const scale = viewer?.currentScaleValue;
        const originalInitialView = native.getInitialViewOverrides;
        const ownedInitialView = Object.prototype.hasOwnProperty.call(native, "getInitialViewOverrides");
        const originalSetInitialView = native.setInitialView;
        const ownedSetInitialView = Object.prototype.hasOwnProperty.call(native, "setInitialView");
        const scroll = viewer?.container;
        const scrollTop = scroll?.scrollTop, scrollLeft = scroll?.scrollLeft;
        let initialViewOverride, setInitialViewOverride;
        const restoreInitialView = () => {
          if (!initialViewOverride || native.getInitialViewOverrides !== initialViewOverride) return;
          if (ownedInitialView) native.getInitialViewOverrides = originalInitialView;
          else delete native.getInitialViewOverrides;
        };
        const restoreSetInitialView = () => {
          if (!setInitialViewOverride || native.setInitialView !== setInitialViewOverride) return;
          if (ownedSetInitialView) native.setInitialView = originalSetInitialView;
          else delete native.setInitialView;
        };
        if (typeof originalInitialView === "function" && location && scale && Number.isFinite(viewer.currentPageNumber)) {
          const zoom = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) * 100 : scale;
          const state = { hash: `page=${viewer.currentPageNumber}&zoom=${zoom},${location.left},${location.top}`,
            rotation: viewer.pagesRotation, scrollMode: viewer.scrollMode, spreadMode: viewer.spreadMode,
            sidebarView: native.pdfSidebar?.visibleView };
          initialViewOverride = function(...args) {
            restoreInitialView();
            const defaults = originalInitialView.apply(this, args);
            // Never impose the old file's location on a navigation or another
            // reader. This one-shot adapter exists only during our own write.
            if (leaf.view !== view || view.file !== file || this !== native || native.pdfDocument === beforeDocument) return defaults;
            return { ...defaults, ...state };
          };
          native.getInitialViewOverrides = initialViewOverride;
          if (typeof originalSetInitialView === "function" && scroll && Number.isFinite(scrollTop) && Number.isFinite(scrollLeft)) {
            setInitialViewOverride = function(...args) {
              restoreSetInitialView();
              const result = originalSetInitialView.apply(this, args);
              const restoreScroll = () => {
                if (leaf.view === view && view.file === file && this === native && native.pdfDocument !== beforeDocument) {
                  // PDF hash coordinates lose page padding/rounding. Correct
                  // those few pixels before the first paint, not after it.
                  scroll.scrollTop = scrollTop; scroll.scrollLeft = scrollLeft;
                  viewer.update?.();
                }
              };
              if (result?.then) return result.then(value => { restoreScroll(); return value; });
              restoreScroll();
              return result;
            };
            native.setInitialView = setInitialViewOverride;
          }
        }
        let done = false, timeout, guard;
        let resolveFinished;
        const finished = new Promise(resolve => { resolveFinished = resolve; });
        const cancel = () => {
          if (done) return;
          done = true;
          restoreInitialView();
          restoreSetInitialView();
          win.clearTimeout(timeout); win.clearInterval(guard);
          bus.off("pagerendered", rendered);
          host.removeEventListener("wheel", cancel, true);
          host.removeEventListener("pointerdown", cancel, true);
          host.removeEventListener("keydown", cancel, true);
          win.removeEventListener("resize", cancel);
          for (const copy of copies.values()) copy.width = copy.height = 0;
          copies.clear(); root.remove();
          this.nativePdfWriteTransitions.delete(transition);
          resolveFinished();
        };
        const rendered = event => {
          if (native.pdfDocument === beforeDocument) return;
          const copy = copies.get(Number(event.pageNumber));
          if (copy) { copy.width = copy.height = 0; copy.remove(); copies.delete(Number(event.pageNumber)); }
          if (!copies.size) cancel();
        };
        const transition = { root, pixels, finished, cancel };
        this.nativePdfWriteTransitions.add(transition);
        transitions.push(transition);
        bus.on("pagerendered", rendered);
        host.addEventListener("wheel", cancel, { capture: true, passive: true });
        host.addEventListener("pointerdown", cancel, true);
        host.addEventListener("keydown", cancel, true);
        win.addEventListener("resize", cancel);
        guard = win.setInterval(() => {
          const current = host.getBoundingClientRect();
          if (this.disposed || !host.isConnected || doc.hidden || leaf.view !== view || view.file !== file
            || Math.abs(current.width - bounds.width) > 1 || Math.abs(current.height - bounds.height) > 1
            || Math.abs(current.left - bounds.left) > 1 || Math.abs(current.top - bounds.top) > 1) cancel();
        }, 50);
        timeout = win.setTimeout(cancel, 4000);
        host.appendChild(root);
      }
      return {
        finished: Promise.all(transitions.map(t => t.finished)),
        cancel: () => transitions.forEach(t => t.cancel())
      };
    },
    async updateAnnotationNote(file, transform) {
      const editor = (this.app.workspace?.getLeavesOfType?.("markdown") || []).find(leaf => leaf.view?.file === file && leaf.view.editor)?.view.editor;
      if (editor?.replaceRange && editor.offsetToPos) {
        const previous = editor.getValue();
        const next = transform(previous);
        if (next !== previous) {
          let start = 0, end = previous.length, nextEnd = next.length;
          while (start < end && start < nextEnd && previous[start] === next[start]) start++;
          while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
          editor.replaceRange(next.slice(start, nextEnd), editor.offsetToPos(start), editor.offsetToPos(end));
        }
        return;
      }
      if (this.app.vault.process) return this.app.vault.process(file, transform);
      const previous = await this.app.vault.read(file);
      const next = transform(previous);
      if (next !== previous) await this.app.vault.modify(file, next);
    },
    renderAllNativeAnnotationOverlays() {
      for (const leaf of this.app.workspace?.getLeavesOfType?.("pdf") || []) this.renderNativeAnnotationOverlays(leaf);
    },
    renderNativeAnnotationOverlays(leaf) {
      const container = leaf.view?.containerEl, file = leaf.view?.file;
      if (!container) return;
      const paper = this.getPaperForPdfFile(file);
      const marks = paper ? this.getManagedAnnotations(paper.id).filter(e => e.record.storageMode === "overlay" && e.record.pdfPath === file.path) : [];
      const native = leaf.view?.viewer?.child?.pdfViewer;
      const byPage = new Map();
      for (const entry of marks) {
        const number = Number(entry.record.page);
        if (!byPage.has(number)) byPage.set(number, []);
        byPage.get(number).push(entry);
      }
      for (const page of container.querySelectorAll(".page[data-page-number]")) {
        const number = Number(page.dataset.pageNumber), entries = byPage.get(number) || [];
        const pageView = native?.pdfViewer?.getPageView?.(number - 1);
        const viewport = pageView?.viewport;
        let svg = page.querySelector(".paperlib-native-annotation-overlay");
        if (!entries.length || !viewport || !page.querySelector(".canvasWrapper canvas")) { svg?.remove(); continue; }
        const signature = JSON.stringify([file.path, viewport.width, viewport.height, viewport.rotation,
          entries.map(e => [e.record.id, e.record.color, e.record.pdfSubtype, e.record.pdfRects, highlightCornerRadius(e.record)])]);
        if (svg?.dataset.signature === signature) continue;
        svg?.remove();
        const doc = page.ownerDocument, ns = "http://www.w3.org/2000/svg";
        svg = doc.createElementNS(ns, "svg");
        svg.classList.add("paperlib-native-annotation-overlay");
        svg.dataset.signature = signature;
        svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("aria-hidden", "true");
        for (const { record } of entries) {
          const path = doc.createElementNS(ns, "path");
          path.dataset.annotationId = record.id;
          const underline = record.pdfSubtype === "Underline";
          const commands = [];
          for (const item of record.pdfRects || []) {
            if (!item.quad?.every(Number.isFinite) || item.quad.length !== 8) continue;
            const q = item.quad;
            const points = [0, 2, 6, 4].map(i => viewport.convertToViewportPoint(q[i], q[i + 1]));
            if (underline) commands.push(`M ${points[3].join(" ")} L ${points[2].join(" ")}`);
            else commands.push(roundedQuadPath(points, highlightCornerRadius(record) * (viewport.scale || 1)));
          }
          path.setAttribute("d", commands.join(" "));
          const color = colorForRecord(this.settings, record).value;
          path.setAttribute("fill", underline ? "none" : color);
          path.setAttribute("fill-opacity", ".38");
          path.setAttribute("stroke", underline ? color : "none");
          path.setAttribute("stroke-width", "1.5");
          path.setAttribute("vector-effect", "non-scaling-stroke");
          svg.appendChild(path);
        }
        page.appendChild(svg);
      }
    },
    attachNativeAnnotationOverlay(leaf, binding) {
      if (!binding || binding.overlayAttached) return;
      binding.overlayAttached = true;
      const container = binding.container, win = container.ownerDocument.defaultView;
      let frame = null;
      const schedule = () => {
        if (frame !== null || this.disposed || !container.isConnected) return;
        frame = win.requestAnimationFrame(() => { frame = null; if (!this.disposed) this.renderNativeAnnotationOverlays(leaf); });
      };
      const observer = new win.MutationObserver(changes => {
        if (changes.some(c => c.type === "attributes" ? c.target.matches?.(".page, .textLayer")
          : !c.target.closest?.(".paperlib-native-annotation-overlay")
          && [...c.addedNodes, ...c.removedNodes].some(n => !n.classList?.contains("paperlib-native-annotation-overlay")))) schedule();
      });
      observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-loaded"] });
      const resize = new win.ResizeObserver(schedule); resize.observe(container);
      const click = event => {
        if (event.button !== 0 || event.target.closest?.("button, a, .popup, .annotationLayer")) return;
        const selection = win.getSelection();
        if (selection?.toString().trim()) return;
        const page = event.target.closest?.(".page[data-page-number]");
        if (!page) return;
        const number = Number(page.dataset.pageNumber), file = leaf.view?.file;
        const paper = this.getPaperForPdfFile(file);
        const viewport = leaf.view?.viewer?.child?.pdfViewer?.pdfViewer?.getPageView?.(number - 1)?.viewport;
        if (!paper || !viewport) return;
        const box = page.querySelector(".textLayer")?.getBoundingClientRect() || page.getBoundingClientRect();
        const point = viewport.convertToPdfPoint((event.clientX - box.left) * viewport.width / box.width,
          (event.clientY - box.top) * viewport.height / box.height);
        const entry = this.getManagedAnnotations(paper.id).find(e => e.record.storageMode === "overlay"
          && e.record.pdfPath === file.path && Number(e.record.page) === number
          && e.record.pdfRects?.some(({ rect }) => point[0] >= rect[0] && point[0] <= rect[2] && point[1] >= rect[1] && point[1] <= rect[3]));
        if (entry) this.showOverlayAnnotationPopup(entry, container.ownerDocument, { left: event.clientX, top: event.clientY, bottom: event.clientY }, leaf);
      };
      container.addEventListener("click", click);
      binding.cleanupOverlay = () => {
        if (this.selectionAnnotationPopup?.sourceLeaf === leaf) this.closeSelectionAnnotationPopup();
        observer.disconnect(); resize.disconnect();
        if (frame !== null) win.cancelAnimationFrame(frame);
        container.removeEventListener("click", click);
        container.querySelectorAll(".paperlib-native-annotation-overlay").forEach(el => el.remove());
        binding.overlayAttached = false;
      };
      this.renderNativeAnnotationOverlays(leaf);
      const paper = this.getPaperForPdfFile(leaf.view?.file);
      if (paper?.annotations?.some(r => r.pdfExportPending)) {
        void this.enqueueAnnotationMutation(() => this.recoverOverlayPdfExport(paper), paper.id)
          .catch(error => { if (!this.disposed) new Notice(`标注写入状态恢复失败：${error.message || error}；请在设置的 PDF 标注中重试写入 PDF`); });
      }
    },
    showOverlayAnnotationPopup(entry, doc, anchor, sourceLeaf = null) {
      this.closeAnnotationRemarkPopup();
      sourceLeaf ||= this.app.workspace.getLeavesOfType("pdf").find(leaf => leaf.view?.file?.path === entry.record.pdfPath && leaf.view.containerEl.ownerDocument === doc);
      const page = sourceLeaf?.view?.viewer?.child?.pdfViewer?.pdfViewer?.getPageView?.(Number(entry.record.page) - 1);
      const viewport = page?.viewport;
      const layerBox = page?.div?.querySelector(".textLayer")?.getBoundingClientRect();
      if (viewport && layerBox?.width && layerBox.height) {
        const boxes = (entry.record.pdfRects || []).flatMap(item => {
          if (item.quad?.length !== 8 || !item.quad.every(Number.isFinite)) return [];
          const points = [0, 2, 4, 6].map(i => viewport.convertToViewportPoint(item.quad[i], item.quad[i + 1]));
          const xs = points.map(p => layerBox.left + p[0] * layerBox.width / viewport.width);
          const ys = points.map(p => layerBox.top + p[1] * layerBox.height / viewport.height);
          const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
          return [{ left, right, top, bottom, width: right - left }];
        });
        // Anchor to the clicked line, not a point inside its letters or a large
        // native paragraph tooltip. Geometry remains correct after zoom/rotation.
        const distance = box => Math.max(box.left - anchor.left, 0, anchor.left - box.right)
          + Math.max(box.top - anchor.top, 0, anchor.top - box.bottom);
        boxes.sort((a, b) => distance(a) - distance(b));
        if (boxes.length) anchor = boxes[0];
      }
      this.showSelectionAnnotationPopup({ paper: entry.paper, ...entry.record, sourceLeaf }, doc, anchor, entry);
    },
    async saveOverlayAnnotation(context, subtype, color, comment) {
      if (this.disposed) throw new Error("插件已关闭");
      if (context.sourceLeaf && !context.sourceLeaf.view?.viewer?.child?.pdfViewer?.pdfViewer?.getPageView?.(context.page - 1)?.viewport?.convertToViewportPoint)
        throw new Error("当前 PDF 阅读器尚未准备好或不支持即时标注，未添加标注；请重新打开 PDF 后重试");
      if (!context.pdfRects?.length || context.pdfRects.some(item => item.rect?.length !== 4 || !item.rect.every(Number.isFinite)
        || item.quad?.length !== 8 || !item.quad.every(Number.isFinite))) throw new Error("无法读取选区坐标，请重新选择文字");
      const paper = this.getCanonicalPaper(context.paper);
      const key = JSON.stringify([context.pdfPath, context.page, context.range, color, subtype, comment]);
      if ((paper.annotations || []).some(r => r.storageMode === "overlay" && r.selectionKey === key && Date.now() - Date.parse(r.createdAt) < 1500)) return true;
      const id = `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const selectionValue = [context.range.beginIndex, context.range.beginOffset, context.range.endIndex, context.range.endOffset].join(",");
      const record = { id, pdfAnnotationId: id, storageMode: "overlay", selectionKey: key,
        pdfPath: context.pdfPath || paper.pdfPath, page: context.page, text: context.text, comment, color,
        pdfSubtype: subtype, selection: { ...context.range }, selectionSource: "native", rectCoordinateSpace: "pdf",
        highlightCornerRadius: 2,
        pdfRects: context.pdfRects.map(item => ({ rect: [...item.rect], quad: [...item.quad] })),
        createdAt: new Date().toISOString() };
      record.link = `${record.pdfPath}#page=${record.page}&selection=${selectionValue}&color=${encodeURIComponent(color)}`;
      paper.annotations ||= [];
      paper.annotations.push(record);
      // Elton's fast path: paint the single edit before awaiting persistence.
      this.renderAllNativeAnnotationOverlays();
      context.sourceLeaf?.view?.containerEl?.ownerDocument.defaultView.getSelection()?.removeAllRanges();
      const previousColor = this.settings.defaultHighlightColor;
      this.settings.defaultHighlightColor = color;
      try { await this.saveSettings(); }
      catch (error) {
        paper.annotations = paper.annotations.filter(r => r !== record);
        this.settings.defaultHighlightColor = previousColor;
        this.renderAllNativeAnnotationOverlays();
        throw error;
      }
      // The durable record is authoritative. Note failure never loses a mark or
      // causes the next color click to create a duplicate of a successful save.
      try { await this.syncOverlayAnnotationNote(paper, record); }
      catch (error) { new Notice(`标注已保存，但笔记同步失败：${error.message || error}；可在设置的 PDF 标注中重新同步`); }
      if (!this.disposed) { this.refreshAnnotationViews(); this.refreshDetailViews(); }
      return true;
    },
    async syncOverlayAnnotationNote(paper, record) {
      if (this.disposed) return;
      const file = await this.ensurePaperNote(paper);
      if (!file) throw new Error("未找到文献笔记");
      const heading = `## ${this.settings.annotationHeading || "PDF Annotations"}`;
      const quoted = String(record.text || "").split("\n").map(line => `> ${line}`).join("\n");
      const remark = record.comment ? `>\n${record.comment.split("\n").map((line, i) => `> ${i ? "" : "**批注：** "}${line}`).join("\n")}\n` : "";
      await this.updateAnnotationNote(file, content => {
        if (content.split("\n").some(line => line.trim() === `^${record.id}`)) return content;
        if (!content.includes(heading)) content = `${content.trimEnd()}\n\n${heading}\n`;
        return `${content.trimEnd()}\n\n> [!pdf|${record.color}]+ ${styleForRecord(this.settings, record).label} · p. ${record.page}\n${quoted}\n${remark}>\n> [[${record.link}|打开原文高亮 · p. ${record.page}]]\n\n^${record.id}\n`;
      });
      // ensurePaperNote may have assigned notePath after the record save.
      await this.saveSettings();
    },
    async recoverOverlayPdfExport(paper) {
      if (this.disposed) return;
      const grouped = new Map();
      for (const { record } of this.getManagedAnnotations(paper.id)) if (record.pdfExportPending) {
        if (!grouped.has(record.pdfPath)) grouped.set(record.pdfPath, []);
        grouped.get(record.pdfPath).push(record);
      }
      for (const [path, records] of grouped) {
        // Only interrupted exports read PDF bytes. Ordinary edits stay IO-free.
        const ids = await this.getLocalPdfAnnotationIds(path);
        if (this.disposed) return;
        for (const record of records) {
          record.storageMode = ids.has(record.pdfAnnotationId || record.id) ? "pdf" : "overlay";
          delete record.pdfExportPending;
        }
        await this.saveSettings(); this.renderAllNativeAnnotationOverlays();
      }
    },
    async embedOverlayAnnotations(paper) {
      return this.enqueueAnnotationMutation(async () => {
        if (this.overlayEmbedStatePending) { await this.saveSettings(); this.overlayEmbedStatePending = false; }
        await this.recoverOverlayPdfExport(paper);
        const groups = new Map();
        for (const { record } of this.getManagedAnnotations(paper.id)) if (record.storageMode === "overlay") {
          if (!groups.has(record.pdfPath)) groups.set(record.pdfPath, []);
          groups.get(record.pdfPath).push(record);
        }
        if (!groups.size) return new Notice("没有尚未写入 PDF 的标注");
        let count = 0;
        for (const [path, records] of groups) {
          // A durable intent allows recovery if the app stops between the PDF
          // write and the ownership flag save. Never migrate unrelated old marks.
          for (const record of records) record.pdfExportPending = true;
          try { await this.saveSettings(); }
          catch (error) { for (const record of records) delete record.pdfExportPending; throw error; }
          const changed = await this.mutateLocalPdf(path, document => {
            for (const record of records) this.applyLocalPdfAnnotation(document, record);
            return true;
          });
          if (!changed) throw new Error("此文件不支持写入 PDF，独立标注已保留");
          for (const record of records) { record.storageMode = "pdf"; delete record.pdfExportPending; }
          try { await this.saveSettings(); }
          catch (error) {
            this.overlayEmbedStatePending = true;
            this.renderAllNativeAnnotationOverlays();
            throw new Error(`PDF 已写入，但状态保存失败：${error.message || error}；请再次点击写入 PDF`);
          }
          count += records.length;
          this.renderAllNativeAnnotationOverlays();
        }
        this.refreshAnnotationViews(); new Notice(`已将 ${count} 条标注写入 PDF`);
      }, paper.id);
    },
    enqueueAnnotationMutation(action, paperId = null) {
      return eltonCore.enqueue(this, async () => {
        this.activeAnnotationPaperIds ||= new Set();
        if (paperId) this.activeAnnotationPaperIds.add(paperId);
        try { return await action(); }
        finally { if (paperId) this.activeAnnotationPaperIds.delete(paperId); }
      });
    },
    async updateManagedAnnotationRemark(entry, comment, expectedComment = entry.record.comment || "", appearance = null) {
      return this.enqueueAnnotationMutation(async () => {
        if (this.disposed) throw new Error("插件已关闭，请重新打开后重试");
        const fresh = this.getManagedAnnotations(entry.paper.id).find(e => e.record.id === entry.record.id && e.source === entry.source);
        if (!fresh) throw new Error("这条标注已被删除");
        const value = String(comment || "").trim();
        const current = fresh.record.comment || "";
        if (current !== expectedComment && current !== value) throw new Error("备注已在别处修改，请重新打开编辑");
        const { paper, record } = fresh;
        if (appearance && (!STYLES.some(s => s.id === appearance.pdfSubtype) || !COLORS.some(c => c.id === appearance.color)))
          throw new Error("不支持的标注样式或颜色");
        if (appearance && ((record.color !== appearance.expectedColor && record.color !== appearance.color)
          || (record.pdfSubtype !== appearance.expectedStyle && record.pdfSubtype !== appearance.pdfSubtype)))
          throw new Error("标注已在别处修改，请重新打开编辑");
        if (record.pdfExportPending) await this.recoverOverlayPdfExport(paper);
        const ids = new Set([record.id, record.pdfAnnotationId, record.annotationId].filter(Boolean));
        const note = paper.notePath && this.app.vault.getAbstractFileByPath(paper.notePath);
        const oldLink = record.link;
        const newLink = appearance && oldLink ? oldLink.replace(/(&color=)[^&]*/, `$1${encodeURIComponent(appearance.color)}`) : oldLink;
        const transform = content => updateRemarkBlock(content, ids, expectedComment, value,
          appearance && { ...appearance, oldLink, newLink });
        // Check before PDF write and again inside process/Editor, preserving
        // handwritten content and concurrent edits while the reader reloads.
        if (note) {
          const editor = (this.app.workspace?.getLeavesOfType?.("markdown") || []).find(l => l.view?.file === note)?.view.editor;
          transform(editor ? editor.getValue() : await this.app.vault.read(note));
        }
        const changedAppearance = appearance && (record.color !== appearance.color || record.pdfSubtype !== appearance.pdfSubtype);
        if (record.storageMode !== "overlay" && fresh.source !== "ink" && record.pdfAnnotationId && record.pdfPath) {
          if (changedAppearance) await this.upsertLocalPdfAnnotation({ ...record, color: appearance.color, pdfSubtype: appearance.pdfSubtype, comment: value });
          else if (current !== value) await this.updateLocalPdfAnnotationRemark(record, value);
        }
        if (this.disposed) throw new Error("插件已关闭，请重新打开标注后重试保存备注");
        const mirrors = [...(paper.annotations || []), ...(paper.researchWorkspace?.highlights || []),
          ...(paper.researchWorkspace?.nodes || []), ...(paper.researchWorkspace?.inkStrokes || [])];
        const updatedAt = new Date().toISOString();
        const previousMirrors = mirrors.filter(mirror => [mirror.id, mirror.pdfAnnotationId, mirror.annotationId].some(id => id && ids.has(id)))
          .map(mirror => [mirror, { comment: mirror.comment, updatedAt: mirror.updatedAt, color: mirror.color, pdfSubtype: mirror.pdfSubtype, link: mirror.link }]);
        for (const [mirror] of previousMirrors) {
          mirror.comment = value; mirror.updatedAt = updatedAt;
          if (appearance) Object.assign(mirror, { color: appearance.color, pdfSubtype: appearance.pdfSubtype, link: newLink });
        }
        if (record.storageMode === "overlay") this.renderAllNativeAnnotationOverlays();
        try {
          try { await this.saveSettings(); }
          catch (error) {
            if (record.storageMode === "overlay") {
              for (const [mirror, before] of previousMirrors) Object.assign(mirror, before);
              this.renderAllNativeAnnotationOverlays();
            }
            throw error;
          }
          if (note) await this.updateAnnotationNote(note, content => this.mergeResearchWorkspaceSection(transform(content), paper));
        } catch (error) { throw new Error(`备注同步未完成：${error.message || error}；请重试保存`); }
        this.refreshAnnotationViews(); this.refreshDetailViews();
        return true;
      }, entry.paper.id);
    },
    closeAnnotationRemarkPopup() {
      this.annotationRemarkPopup?.cleanup(); this.annotationRemarkPopup = null;
    },
    showAnnotationRemarkPopup(entry, doc, anchor) {
      this.closeSelectionAnnotationPopup(); this.closeAnnotationRemarkPopup();
      const root = doc.body.createDiv({ cls: "paperlib-selection-annotation-popup paperlib-annotation-remark-popup" });
      root.setAttribute("role", "dialog");
      const title = root.createDiv({ cls: "paperlib-annotation-popup-heading", text: "编辑标注备注" });
      title.id = `paperlib-remark-heading-${entry.record.id}`; root.setAttribute("aria-labelledby", title.id);
      const state = { comment: entry.record.comment || "", previous: entry.record.comment || "" };
      const close = () => { if (!state.saving) this.closeAnnotationRemarkPopup(); };
      const note = remarkEditor(this, root, entry, state, () => {
        if (this.annotationRemarkPopup?.root === root) this.closeAnnotationRemarkPopup();
      }, close);
      const win = doc.defaultView;
      const reposition = () => {
        const box = root.getBoundingClientRect();
        root.style.left = `${Math.max(8, Math.min(win.innerWidth - box.width - 8, anchor.left))}px`;
        root.style.top = `${Math.max(8, Math.min(win.innerHeight - box.height - 8, anchor.bottom + 8))}px`;
      };
      const key = event => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); close(); } };
      const outside = event => { if (!root.contains(event.target)) close(); };
      doc.addEventListener("pointerdown", outside, true);
      doc.addEventListener("keydown", key, true); win.addEventListener("resize", reposition);
      this.annotationRemarkPopup = { root, state, cleanup: () => {
        doc.removeEventListener("pointerdown", outside, true);
        doc.removeEventListener("keydown", key, true); win.removeEventListener("resize", reposition); root.remove();
      } };
      reposition(); note.focus({ preventScroll: true });
    },
    attachNativeAnnotationRemarkButton(leaf, binding) {
      const child = leaf.view?.viewer?.child;
      if (binding.remarkChild === child) return;
      binding.cleanupRemark?.();
      if (!child || typeof child.renderAnnotationPopup !== "function") return;
      const plugin = this, original = child.renderAnnotationPopup;
      const owned = Object.prototype.hasOwnProperty.call(child, "renderAnnotationPopup");
      const wrapped = function(annotation, ...args) {
        const result = original.call(this, annotation, ...args);
        const popup = child.activeAnnotationPopupEl, file = leaf.view?.file;
        const page = annotation?.parent?.page?.pageNumber;
        if (this !== child || !popup?.isConnected || !file || !page || annotation?.data?.titleObj?.str !== "Paper Library") return result;
        const generation = plugin.selectionAnnotationGeneration;
        void plugin.getNativeManagedAnnotationEntry(file, page, annotation.data.id).then(entry => {
          if (!entry || plugin.disposed || binding.remarkChild !== child || leaf.view?.file !== file
            || child.activeAnnotationPopupEl !== popup || !popup.isConnected || generation !== plugin.selectionAnnotationGeneration) return;
          if (STYLES.some(style => style.id === entry.record.pdfSubtype)) {
            const anchor = popup.getBoundingClientRect();
            child.destroyAnnotationPopup?.();
            plugin.showOverlayAnnotationPopup(entry, popup.ownerDocument, anchor, leaf);
            return;
          }
          const meta = popup.querySelector(".popupMeta");
          if (!meta || meta.querySelector(".paperlib-native-annotation-edit")) return;
          const edit = button(meta, "", event => {
            event.stopPropagation();
            plugin.showAnnotationRemarkPopup(entry, popup.ownerDocument, popup.getBoundingClientRect());
            child.destroyAnnotationPopup?.();
          }, "clickable-icon paperlib-native-annotation-edit");
          setIcon(edit, "pencil");
          const name = edit.createSpan({ text: "编辑备注", cls: "paperlib-annotation-swatch-name" });
          plugin.annotationEditorLabelId = (plugin.annotationEditorLabelId || 0) + 1;
          name.id = `paperlib-remark-edit-${plugin.annotationEditorLabelId}`;
          edit.setAttribute("aria-labelledby", name.id);
        }).catch(() => { /* Optional internals: leave unsupported native popups untouched. */ });
        return result;
      };
      binding.remarkChild = child;
      binding.cleanupRemark = () => {
        if (child.renderAnnotationPopup === wrapped) {
          if (owned) child.renderAnnotationPopup = original;
          else delete child.renderAnnotationPopup;
        }
        binding.container.querySelectorAll(".paperlib-native-annotation-edit").forEach(el => el.remove());
        binding.remarkChild = null;
      };
      child.renderAnnotationPopup = wrapped;
    },
    async saveSelectionAnnotation(context, subtype, color, comment) {
      return this.enqueueAnnotationMutation(async () => {
        const paper = this.settings.papers.find(p => p.id === context.paper?.id);
        if (!paper) throw new Error("这篇文献已被移除");
        const style = normalizeSubtype(subtype);
        if (style === "Text" && !comment.trim()) throw new Error("请填写注释内容");
        const saved = context.storageMode === "pdf"
          ? await this.savePdfHighlight({ ...context, paper }, color, comment.trim(), { pdfSubtype: style })
          : await this.saveOverlayAnnotation({ ...context, paper }, style, color, comment.trim());
        return saved;
      }, context.paper?.id);
    },
    async deleteManagedAnnotation(entry) {
      return this.enqueueAnnotationMutation(async () => {
        const fresh = this.getManagedAnnotations(entry.paper.id).find(e => e.record.id === entry.record.id && e.source === entry.source);
        if (!fresh) return false;
        const { paper, record, source } = fresh;
        if (record.pdfExportPending) await this.recoverOverlayPdfExport(paper);
        // Do not remove the user's local record when the PDF cannot be updated.
        if (source !== "ink" && record.storageMode !== "overlay") await this.removeLocalPdfAnnotations([record]);
        const ids = new Set([record.id, record.annotationId, record.pdfAnnotationId].filter(Boolean));
        const matches = r => [r.id, r.annotationId, r.pdfAnnotationId].some(id => id && ids.has(id));
        const workspace = paper.researchWorkspace;
        const before = { annotations: paper.annotations, ...(workspace ? Object.fromEntries(["highlights", "nodes", "inkStrokes", "links"].map(key => [key, workspace[key]])) : {}) };
        paper.annotations = (paper.annotations || []).filter(r => !matches(r));
        if (workspace) {
          for (const key of ["highlights", "nodes", "inkStrokes"]) workspace[key] = (workspace[key] || []).filter(r => !matches(r));
          const nodes = new Set(workspace.nodes.map(n => n.id));
          workspace.links = (workspace.links || []).filter(l => nodes.has(l.from) && nodes.has(l.to));
        }
        this.renderAllNativeAnnotationOverlays();
        try { await this.saveSettings(); }
        catch (error) {
          paper.annotations = before.annotations;
          if (workspace) for (const key of ["highlights", "nodes", "inkStrokes", "links"]) workspace[key] = before[key];
          this.renderAllNativeAnnotationOverlays();
          throw error;
        }
        const note = paper.notePath && this.app.vault.getAbstractFileByPath(paper.notePath);
        if (note) await this.updateAnnotationNote(note, content => this.mergeResearchWorkspaceSection(this.removeAnnotationBlocks(content, ids), paper));
        this.refreshResearchPdfHighlights(paper);
        this.refreshDetailViews();
        return true;
      }, entry.paper.id);
    },
    renderAnnotationSettings(container) {
      container.createEl("h3", { text: "PDF 标注" });
      new Setting(container).setName("选中文字时显示标注窗口")
        .setDesc("默认高亮，点击颜色即添加；下划线或备注请在选色前设置。")
        .addToggle(toggle => toggle.setValue(this.settings.selectionAnnotationPopup !== false).onChange(async value => {
          this.settings.selectionAnnotationPopup = value;
          if (!value) this.closeSelectionAnnotationPopup();
          await this.saveSettings();
        }));
      const meanings = this.settings.annotationColorMeanings || {};
      new Setting(container).setName("颜色含义").setHeading();
      for (const color of COLORS) {
        new Setting(container).setName(`${color.label}的悬停提示`)
          .addText(text => text.setPlaceholder("自定义含义（可选）").setValue(typeof meanings[color.id] === "string" ? meanings[color.id] : color.meaning)
            .onChange(async value => {
              this.settings.annotationColorMeanings = { ...this.settings.annotationColorMeanings, [color.id]: value.trim().slice(0, 200) };
              await this.saveSettings();
              this.refreshAnnotationViews();
              this.selectionAnnotationPopup?.refreshMeaning?.();
            }));
      }
      new Setting(container).setName("标注导出与同步").setHeading();
      const current = this.getCurrentAnnotationPaper();
      let targetId = current?.id || "", busy = false, targetControl;
      const annotatedIds = new Set(this.getManagedAnnotations().map(entry => entry.paper.id));
      new Setting(container).setName("操作文献")
        .addDropdown(dropdown => {
          targetControl = dropdown;
          dropdown.addOption("", "请选择文献");
          for (const paper of this.settings.papers) {
            if (paper.id === current?.id || annotatedIds.has(paper.id))
              dropdown.addOption(paper.id, paper.title || paper.pdfPath || "未命名文献");
          }
          dropdown.setValue(targetId).onChange(value => { targetId = value; });
        });
      const run = async (control, name, action) => {
        if (busy) return;
        const paper = this.settings.papers.find(p => p.id === targetId);
        if (!paper) return new Notice("请先选择文献");
        busy = true; control.setDisabled(true); targetControl.setDisabled(true);
        try { await action(paper); }
        catch (error) { new Notice(`${name}失败：${error.message || error}`); }
        finally { busy = false; control.setDisabled(false); targetControl.setDisabled(false); }
      };
      new Setting(container).setName("写入 PDF")
        .setDesc("将所选文献的独立标注写入原 PDF 文件；平时标注不会改写 PDF。")
        .addButton(b => b.setButtonText("写入 PDF").onClick(() => run(b, "写入 PDF", paper => this.embedOverlayAnnotations(paper))));
      new Setting(container).setName("同步笔记")
        .setDesc("标注自动同步到文献笔记；同步失败时可在此重试，不覆盖手写内容。")
        .addButton(b => b.setButtonText("同步笔记").onClick(() => run(b, "同步笔记", async paper => {
          await this.enqueueAnnotationMutation(async () => {
            for (const { record } of this.getManagedAnnotations(paper.id))
              if (record.storageMode === "overlay") await this.syncOverlayAnnotationNote(paper, record);
          }, paper.id);
          new Notice("标注已同步到文献笔记");
        })));
      new Setting(container).setName("标注管理").addButton(b => b.setButtonText("打开右栏").onClick(() => this.ensureAnnotationView(true)));
    },
    closeSelectionAnnotationPopup() {
      this.selectionAnnotationGeneration = (this.selectionAnnotationGeneration || 0) + 1;
      if (this.selectionAnnotationTimer) {
        this.selectionAnnotationTimer.window.clearTimeout(this.selectionAnnotationTimer.id);
        this.selectionAnnotationTimer = null;
      }
      this.selectionAnnotationPopup?.cleanup();
      this.selectionAnnotationPopup = null;
    },
    scheduleSelectionAnnotationPopup(leaf, container) {
      if (this.settings.selectionAnnotationPopup === false || this.disposed) return;
      if (this.selectionAnnotationPopup?.root?.getAttribute("aria-busy") === "true") return;
      if (this.nativeSelectionDrag) return;
      const doc = container.ownerDocument, win = doc.defaultView;
      // Collapsing a text selection is normal while editing a saved mark.
      if (this.selectionAnnotationPopup?.editingEntry && this.selectionAnnotationPopup.root.contains(doc.activeElement)) return;
      const selection = win.getSelection();
      const element = n => n?.nodeType === 3 ? n.parentElement : n;
      const textLayer = element(selection?.anchorNode)?.closest?.(".textLayer");
      if (!selection?.rangeCount || selection.isCollapsed || !textLayer || !container.contains(textLayer)
        || !textLayer.contains(element(selection.focusNode))) {
        this.closeSelectionAnnotationPopup();
        return;
      }
      const file = leaf.view?.file;
      if (!this.getPaperForPdfFile(file)) return;
      this.closeSelectionAnnotationPopup();
      const generation = this.selectionAnnotationGeneration;
      const selectedText = selection.toString();
      this.selectionAnnotationTimer = { window: win, id: win.setTimeout(async () => {
        this.selectionAnnotationTimer = null;
        if (this.disposed || generation !== this.selectionAnnotationGeneration || !container.isConnected) return;
        if (win.getSelection()?.toString() !== selectedText || leaf.view?.file?.path !== file.path) return;
        const anchor = eltonCore.selectionRect(win.getSelection().getRangeAt(0), container);
        try {
          const context = await this.getNativePdfSelectionContext(leaf, textLayer);
          if (!context || this.disposed || generation !== this.selectionAnnotationGeneration || !container.isConnected
            || leaf.view?.file?.path !== file.path || win.getSelection()?.toString() !== selectedText) return;
          this.showSelectionAnnotationPopup(context, doc, anchor);
        } catch (error) { console.warn("Paper Library: selection annotation unavailable", error); }
      }, 120) };
    },
    showSelectionAnnotationPopup(context, doc, anchor, editingEntry = null) {
      this.closeSelectionAnnotationPopup();
      const win = doc.defaultView;
      const root = doc.body.createDiv({ cls: "paperlib-selection-annotation-popup paperlib-annotation-compact-popup", attr: { role: "dialog" } });
      // Leave room for the existing-mark delete action without a second icon row.
      if (editingEntry) root.style.width = "340px";
      const accessibleTitle = root.createSpan({ text: editingEntry ? "编辑标注" : "标注选中文字", cls: "paperlib-annotation-swatch-name" });
      accessibleTitle.id = `paperlib-selection-heading-${this.selectionAnnotationGeneration}`;
      root.setAttribute("aria-labelledby", accessibleTitle.id);
      const draftKey = editingEntry && `${editingEntry.paper.id}:${editingEntry.record.id}`;
      const draftOwner = this.selectionAnnotationGeneration;
      const drafts = this.annotationEditDrafts ||= new Map();
      const draft = draftKey && drafts.get(draftKey);
      let style = draft?.style || (editingEntry ? normalizeSubtype(editingEntry.record.pdfSubtype) : "Highlight");
      let saving = false, deleting = false;
      const initialColor = draft?.color || editingEntry?.record.color || this.settings.defaultHighlightColor;
      let color = COLORS.some(c => c.id === String(initialColor).toLowerCase()) ? String(initialColor).toLowerCase() : "yellow";
      let expected = draft?.expected || (editingEntry && { comment: editingEntry.record.comment || "", color: editingEntry.record.color, style: editingEntry.record.pdfSubtype });
      let savedEdit = editingEntry && JSON.stringify({ style: expected.style, color: expected.color, comment: expected.comment });
      let editTimer = null, editTask = null, composing = false;
      const toolbar = root.createDiv({ cls: "paperlib-annotation-inline-toolbar" });
      const colorGroup = toolbar.createDiv({ cls: "paperlib-annotation-color-options" });
      const styleGroup = toolbar.createDiv({ cls: "paperlib-annotation-style-options" });
      const iconButton = (parent, icon, text, action) => {
        const btn = button(parent, "", action, "clickable-icon paperlib-annotation-icon-button");
        setIcon(btn, icon);
        const name = btn.createSpan({ text, cls: "paperlib-annotation-swatch-name" });
        this.annotationEditorLabelId = (this.annotationEditorLabelId || 0) + 1;
        name.id = `paperlib-annotation-action-${this.annotationEditorLabelId}`;
        btn.setAttribute("aria-labelledby", name.id);
        return btn;
      };
      const styleButtons = [];
      const updateStyles = () => {
        for (const [id, btn] of styleButtons) { btn.classList.toggle("is-active", id === style); btn.setAttribute("aria-pressed", String(id === style)); }
      };
      for (const preset of STYLES) {
        const btn = iconButton(styleGroup, preset.id === "Underline" ? "underline" : "highlighter", preset.label,
          () => { style = preset.id; updateStyles(); if (editingEntry) void commitEdit(); });
        btn.dataset.style = preset.id;
        styleButtons.push([preset.id, btn]);
      }
      const colorButtons = [];
      const refreshMeaning = () => {
        for (const [id, btn] of colorButtons) {
          const value = colorForRecord(this.settings, { color: id }).meaning;
          if (value) btn.setAttribute("title", value);
          else btn.removeAttribute("title");
        }
      };
      const updateColors = () => {
        const value = COLORS.find(c => c.id === color).value;
        root.style.setProperty("--annotation-color", value);
        context.sourceLeaf?.view?.containerEl?.style.setProperty("--paperlib-annotation-selection-color", value);
        for (const [id, btn] of colorButtons) { btn.classList.toggle("is-active", id === color); btn.setAttribute("aria-pressed", String(id === color)); }
        refreshMeaning();
      };
      for (const c of COLORS) {
        const btn = button(colorGroup, "", () => {
          if (saving) return;
          color = c.id; updateColors();
          if (editingEntry) void commitEdit(); else void commit();
        });
        const name = btn.createSpan({ text: c.label, cls: "paperlib-annotation-swatch-name" });
        name.id = `paperlib-swatch-${c.id}-${this.selectionAnnotationGeneration || 0}`;
        btn.setAttribute("aria-labelledby", name.id);
        btn.dataset.color = c.id;
        btn.style.setProperty("--swatch-color", c.value);
        colorButtons.push([c.id, btn]);
      }
      updateStyles(); updateColors();
      const actions = toolbar.createDiv({ cls: "paperlib-annotation-inline-actions" });
      const runAction = action => {
        if (saving) return;
        Promise.resolve().then(action).catch(failure => {
          error.setText(failure.message || String(failure)); error.classList.add("is-error");
        });
      };
      iconButton(actions, "sparkles", "询问 AI", () => runAction(() => this.addAIContext({
        type: "selection", label: `${context.paper.title} · 第 ${context.page} 页选区`,
        detail: `${context.text.length} 字符`, text: context.text, path: context.pdfPath, page: context.page,
        key: `pdf-selection:${context.pdfPath}:${context.page}:${context.text.slice(0, 120)}`
      }, { draft: "请解释这段 PDF 文字，并结合论文上下文回答。" })));
      if (editingEntry) {
        const remove = iconButton(actions, "trash-2", "删除标注", async () => {
          if (saving || deleting) return;
          deleting = true; clearTimer(); setSaving(true); note.disabled = true;
          error.setText("正在删除…"); error.classList.remove("is-error");
          try {
            await this.deleteManagedAnnotation(editingEntry);
            drafts.delete(draftKey);
            if (this.selectionAnnotationPopup?.root === root) this.closeSelectionAnnotationPopup();
          } catch (failure) {
            const exists = this.getManagedAnnotations(editingEntry.paper.id).some(entry => entry.record.id === editingEntry.record.id);
            if (!exists) {
              drafts.delete(draftKey);
              if (this.selectionAnnotationPopup?.root === root) this.closeSelectionAnnotationPopup();
              new Notice(`标注已删除，但同步未完成：${failure.message || String(failure)}`);
              return;
            }
            deleting = false; rememberDraft();
            if (this.selectionAnnotationPopup?.root === root) {
              setSaving(false); error.setText(`删除失败：${failure.message || String(failure)}；请重试。`); error.classList.add("is-error");
            } else new Notice(`删除标注失败：${failure.message || String(failure)}`);
          }
        });
        remove.dataset.action = "delete-annotation";
      }
      const label = root.createEl("label", { cls: "paperlib-annotation-remark-label" });
      label.createSpan({ cls: "paperlib-annotation-swatch-name", text: "标注备注" });
      const note = label.createEl("textarea", { attr: { rows: "2", placeholder: "备注（可选）" } });
      if (editingEntry) note.value = draft?.comment ?? editingEntry.record.comment ?? "";
      const error = root.createDiv({ cls: "paperlib-annotation-error", attr: { role: "status" } });
      const editSnapshot = () => ({ style, color, comment: note.value.trim() });
      const dirtyEdit = () => editingEntry && JSON.stringify(editSnapshot()) !== savedEdit;
      const rememberDraft = () => {
        if (!dirtyEdit()) return;
        if ((drafts.get(draftKey)?.owner || 0) > draftOwner) return;
        drafts.delete(draftKey); drafts.set(draftKey, { ...editSnapshot(), expected: { ...expected }, owner: draftOwner });
        if (drafts.size > 100) drafts.delete(drafts.keys().next().value);
      };
      const clearTimer = () => { if (editTimer !== null) win.clearTimeout(editTimer); editTimer = null; };
      const setSaving = value => {
        saving = value;
        root.setAttribute("aria-busy", String(value));
        for (const [, btn] of [...colorButtons, ...styleButtons]) btn.disabled = value;
        actions.querySelectorAll("button").forEach(btn => { btn.disabled = value; });
        note.disabled = value && !editingEntry;
      };
      const commitEdit = () => {
        if (deleting) return Promise.resolve(false);
        clearTimer(); rememberDraft();
        if (editTask) return editTask;
        if (!dirtyEdit() || this.disposed || composing) return Promise.resolve(true);
        const snapshot = editSnapshot();
        setSaving(true); error.setText("正在保存…"); error.classList.remove("is-error");
        editTask = (async () => {
          let success = false;
          try {
            await this.updateManagedAnnotationRemark(editingEntry, snapshot.comment, expected.comment,
              { pdfSubtype: snapshot.style, color: snapshot.color, expectedColor: expected.color, expectedStyle: expected.style });
            savedEdit = JSON.stringify(snapshot);
            expected = { comment: snapshot.comment, style: snapshot.style, color: snapshot.color };
            success = true;
            if (JSON.stringify(editSnapshot()) === savedEdit && (drafts.get(draftKey)?.owner || 0) <= draftOwner) drafts.delete(draftKey);
            else rememberDraft();
            if (this.selectionAnnotationPopup?.root === root) error.setText("");
            return true;
          } catch (failure) {
            rememberDraft();
            if (this.selectionAnnotationPopup?.root === root) {
              error.setText(`${failure.message || String(failure)}；修改后可重试，草稿已保留。`); error.classList.add("is-error");
            } else new Notice(`标注修改未保存：${failure.message || String(failure)}；重新点击标注可恢复草稿`);
            return false;
          } finally {
            editTask = null;
            if (this.selectionAnnotationPopup?.root === root) setSaving(false);
            // Input stays usable during a slow save; commit the latest draft next.
            if (success && dirtyEdit() && !this.disposed) void commitEdit();
          }
        })();
        return editTask;
      };
      const scheduleEdit = () => {
        clearTimer(); rememberDraft();
        if (!composing) editTimer = win.setTimeout(() => { editTimer = null; void commitEdit(); }, 400);
      };
      if (editingEntry) {
        note.addEventListener("input", scheduleEdit);
        note.addEventListener("compositionstart", () => { composing = true; clearTimer(); });
        note.addEventListener("compositionend", () => { composing = false; scheduleEdit(); });
      }
      const commit = async () => {
        if (saving) return;
        setSaving(true);
        error.setText("正在添加…");
        error.classList.remove("is-error");
        try {
          // Let the pressed/busy state paint before PDF serialization starts.
          await new Promise(resolve => win.setTimeout(resolve, 0));
          const saved = await this.saveSelectionAnnotation(context, style, color, note.value);
          if (this.selectionAnnotationPopup?.root === root) {
            if (saved) this.closeSelectionAnnotationPopup();
            else { error.setText("未添加标注或已保存，请重新选择文字后重试。"); error.classList.add("is-error"); setSaving(false); }
          }
        } catch (failure) {
          if (this.selectionAnnotationPopup?.root === root) {
            error.setText(`${failure.message || String(failure)}；请再次点击颜色重试。`);
            error.classList.add("is-error");
            setSaving(false);
          } else new Notice(`添加标注失败：${failure.message || String(failure)}`);
        }
      };
      const outside = event => { if ((editingEntry || !saving) && !root.contains(event.target)) this.closeSelectionAnnotationPopup(); };
      const key = event => {
        if (event.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); this.closeSelectionAnnotationPopup(); }
        if (editingEntry && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commitEdit(); }
      };
      const preserveSelection = event => { if (event.target.closest?.("button")) event.preventDefault(); };
      toolbar.addEventListener("mousedown", preserveSelection);
      const reposition = () => {
        const source = context.sourceLeaf?.view?.viewer?.child?.pdfViewer?.pdfViewer?.container || context.sourceLeaf?.view?.containerEl;
        const pane = source?.getBoundingClientRect();
        const bounds = pane?.width && pane.height
          ? { left: Math.max(0, pane.left), right: Math.min(win.innerWidth, pane.right), top: Math.max(0, pane.top), bottom: Math.min(win.innerHeight, pane.bottom) }
          : { left: 0, right: win.innerWidth, top: 0, bottom: win.innerHeight };
        root.style.maxWidth = `${Math.max(48, bounds.right - bounds.left - 16)}px`;
        const position = annotationPopupPosition(anchor, root.getBoundingClientRect(), bounds);
        root.style.left = `${position.left}px`; root.style.top = `${position.top}px`;
      };
      doc.addEventListener("pointerdown", outside, true);
      doc.addEventListener("keydown", key, true);
      win.addEventListener("resize", reposition);
      const scrollArea = context.sourceLeaf?.view?.viewer?.child?.pdfViewer?.pdfViewer?.container;
      const scrolled = () => { if (this.selectionAnnotationPopup?.root === root) this.closeSelectionAnnotationPopup(); };
      scrollArea?.addEventListener("scroll", scrolled, { passive: true });
      const resize = context.sourceLeaf?.view?.containerEl && new win.ResizeObserver(reposition);
      if (resize) resize.observe(context.sourceLeaf.view.containerEl);
      this.selectionAnnotationPopup = { root, sourceLeaf: context.sourceLeaf, editingEntry, color: () => color, refreshMeaning, cleanup: () => {
        clearTimer();
        if (editingEntry && !deleting) { rememberDraft(); if (!this.disposed) void commitEdit(); }
        doc.removeEventListener("pointerdown", outside, true);
        doc.removeEventListener("keydown", key, true);
        win.removeEventListener("resize", reposition);
        scrollArea?.removeEventListener("scroll", scrolled); resize?.disconnect();
        toolbar.removeEventListener("mousedown", preserveSelection);
        root.remove();
      } };
      reposition();
      // Keep native selection visible and preserve the captured source; keyboard users may Tab into the dialog.
    }
  });
  Plugin.annotationInternals = { STYLES, COLORS, normalizeSubtype, styleForRecord, colorForRecord, filterAnnotations, annotationAppearanceCommands, roundedQuadPath, annotationPopupPosition, paintAnnotationPreview, updateRemarkBlock };
}

function filterAnnotations(entries, filters, settings) {
  const query = String(filters.query || "").trim().toLocaleLowerCase();
  return entries.filter(({ paper, record }) => {
    const style = styleForRecord(settings, record);
    const color = colorForRecord(settings, record);
    return (!filters.style || style.id === filters.style)
      && (!filters.color || String(record.color).toLowerCase() === filters.color)
      && (!query || [paper.title, record.text, record.comment, style.label, color.label, color.meaning].join(" ").toLocaleLowerCase().includes(query));
  });
}
module.exports = { install, normalizeSubtype, styleForRecord, colorForRecord, annotationAppearanceCommands, filterAnnotations, STYLES, COLORS };
