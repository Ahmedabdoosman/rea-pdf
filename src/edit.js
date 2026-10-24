// Partial content editing UI: pick a text line to rewrite or delete, and move,
// resize, replace or delete images. The work happens in engine/contentedit.js;
// every change reopens the document (dirty) and can be undone.
import { t } from "./i18n.js";
import { modal, esc } from "./ui.js";
import { tools } from "./platform.js";

const AR = /[؀-ۿ]/;

/** Text lines of a page from pdf.js text content, split at column gaps. */
export async function pageLines(pdfPage) {
  const tc = await pdfPage.getTextContent();
  const items = tc.items.filter((it) => it.str && Math.abs(it.transform[1]) < 0.01 && Math.abs(it.transform[2]) < 0.01)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[3]) || it.height, dir: it.dir }));
  const lines = [];
  for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str.trim() && !lines.length) continue;
    const l = lines.find((ln) => Math.abs(ln.y - it.y) < ln.size * 0.3 && it.x <= ln.x2 + ln.size * 1.2 && it.x + it.w >= ln.x1 - ln.size * 1.2);
    if (l) { l.parts.push(it); l.x1 = Math.min(l.x1, it.x); l.x2 = Math.max(l.x2, it.x + it.w); l.size = Math.max(l.size, it.size); }
    else lines.push({ y: it.y, x1: it.x, x2: it.x + it.w, size: it.size, parts: [it] });
  }
  return lines.filter((l) => l.parts.some((p) => p.str.trim())).map((l) => {
    const rtl = l.parts.some((p) => AR.test(p.str));
    const parts = l.parts.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let text = "";
    parts.forEach((p, i) => {
      const prev = parts[i - 1];
      const gap = prev ? (rtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w)) : 0;
      if (prev && gap > l.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += " ";
      text += p.str;
    });
    return { ...l, rtl, text: text.replace(/\s+/g, " ").trim() };
  });
}

async function toImageBytes(file) {
  if (/\.jpe?g$/i.test(file.name)) return { bytes: file.data, type: "jpg" };
  if (/\.png$/i.test(file.name)) return { bytes: file.data, type: "png" };
  const bmp = await createImageBitmap(new Blob([file.data]));
  const c = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  c.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "png" };
}

export class ContentEditor {
  /** ctx: { container, pdfViewer, eventBus, state, plainBytes, currentBytes, openBytes, busy, toast, confirmBreaksSignatures, onMode } */
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = null; // "text" | "image"
    this.undoStack = [];
    this.images = new Map(); // page -> list (for the open document)
    this.lines = new Map();
    this.confirmed = false; // signature warning shown for this document
    ctx.eventBus._on("pagerendered", ({ pageNumber }) => this.#draw(pageNumber));
  }

  /** A document (re)opened: cached geometry is stale. */
  reset({ keepUndo = false } = {}) {
    this.images.clear();
    this.lines.clear();
    if (!keepUndo) { this.undoStack = []; this.confirmed = false; }
    this.#redrawAll();
  }

  setMode(mode) {
    this.mode = this.mode === mode ? null : mode;
    this.ctx.container.classList.toggle("content-editing", !!this.mode);
    this.ctx.onMode?.(this.mode);
    if (this.mode === "text") this.ctx.toast(t("edit.textHint"));
    if (this.mode === "image") this.ctx.toast(t("edit.imageHint"));
    this.#redrawAll();
  }

  get canUndo() { return this.undoStack.length > 0; }

  async undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    const { state, pdfViewer } = this.ctx;
    await this.ctx.openBytes(prev, { name: state.name, path: state.path, dirty: true, page: pdfViewer.currentPageNumber, keepEditUndo: true });
    this.ctx.toast(t("edit.undone"));
  }

  async #run(fn) {
    const { ctx } = this;
    if (!this.confirmed) {
      if (!(await ctx.confirmBreaksSignatures(await ctx.currentBytes(), t("action.contentEdit")))) return false;
      this.confirmed = true;
    }
    return ctx.busy(t("busy.editing"), async () => {
      const bytes = await ctx.plainBytes();
      if (!bytes) return false;
      const out = await fn(bytes);
      if (!out) return false;
      this.undoStack.push(bytes);
      if (this.undoStack.length > 15) this.undoStack.shift();
      const top = ctx.container.scrollTop;
      await ctx.openBytes(out, { name: ctx.state.name, path: ctx.state.path, dirty: true, page: ctx.pdfViewer.currentPageNumber, keepEditUndo: true });
      ctx.container.scrollTop = top;
      return true;
    });
  }

  // ---------- text ----------
  async editLine(pageNumber, line) {
    const res = await modal({
      title: t("edit.lineTitle"),
      wide: true,
      body: `
        <label class="field">${t("edit.lineText")}<textarea name="text" rows="2" dir="auto">${esc(line.text)}</textarea></label>
        <div class="grid2">
          <label class="field">${t("edit.fontSize")}<input name="size" type="number" min="4" max="200" step="0.5" value="${Math.round(line.size * 10) / 10}"></label>
          <label class="field">${t("edit.align")}<select name="align">
            <option value="">${t("edit.alignAuto")}</option><option value="right">${t("edit.alignRight")}</option><option value="left">${t("edit.alignLeft")}</option></select></label>
        </div>
        <label class="check"><input type="checkbox" name="bold"> ${t("edit.bold")}</label>
        <p class="note">${t("edit.fontNote")}</p>`,
      actions: [{ label: t("edit.replace"), value: "ok", primary: true }, { label: t("edit.deleteLine"), value: "delete", danger: true }, { label: t("common.cancel"), value: "cancel" }],
      validate: (v, action) => (action === "ok" && !v.text.trim() ? t("edit.needText") : null),
    });
    if (!res) return;
    const del = res.action === "delete";
    let result = null;
    const ok = await this.#run(async (bytes) => {
      result = await tools.contentReplaceText({
        pdf: bytes, pageIndex: pageNumber - 1,
        target: { baseline: line.y, x1: line.x1, x2: line.x2, size: line.size },
        text: del ? "" : res.data.text.replace(/\s*\n\s*/g, " "), size: Number(res.data.size) || null, bold: res.data.bold || null, align: res.data.align || null,
      });
      return result.pdf;
    });
    if (!ok) return;
    if (!del && result.width > (line.x2 - line.x1) * 1.15) this.ctx.toast(t("edit.longer"));
    else this.ctx.toast(t(del ? "edit.lineDeleted" : "edit.lineReplaced"));
  }

  // ---------- images ----------
  async replaceImage(pageNumber, img) {
    const files = await tools.pickImages();
    if (!files?.length) return;
    const image = await toImageBytes(files[0]);
    if (await this.#run(async (bytes) => (await tools.contentEditImage({ pdf: bytes, pageIndex: pageNumber - 1, id: img.id, action: "replace", image })).pdf)) this.ctx.toast(t("edit.imageReplaced"));
  }

  async deleteImage(pageNumber, img) {
    if (await this.#run(async (bytes) => (await tools.contentEditImage({ pdf: bytes, pageIndex: pageNumber - 1, id: img.id, action: "delete" })).pdf)) this.ctx.toast(t("edit.imageDeleted"));
  }

  async moveImage(pageNumber, img, rect) {
    await this.#run(async (bytes) => (await tools.contentEditImage({ pdf: bytes, pageIndex: pageNumber - 1, id: img.id, action: "move", rect })).pdf);
  }

  // ---------- overlays ----------
  #redrawAll() {
    const n = this.ctx.pdfViewer.pagesCount || 0;
    for (let i = 1; i <= n; i++) this.#draw(i);
  }

  async #draw(pageNumber) {
    const view = this.ctx.pdfViewer.getPageView?.(pageNumber - 1);
    const pageDiv = view?.div;
    if (!pageDiv) return;
    pageDiv.querySelector(".edit-layer")?.remove();
    if (!this.mode || !view.pdfPage) return;
    const pdf = this.ctx.state.pdf;
    let items;
    if (this.mode === "text") {
      if (!this.lines.has(pageNumber)) this.lines.set(pageNumber, await pageLines(view.pdfPage).catch(() => []));
      items = this.lines.get(pageNumber);
    } else {
      if (!this.images.has(pageNumber)) {
        const bytes = await pdf.getData();
        this.images.set(pageNumber, await tools.contentListImages({ pdf: bytes, pageIndex: pageNumber - 1 }).catch(() => []));
      }
      items = this.images.get(pageNumber);
    }
    if (pdf !== this.ctx.state.pdf || !this.mode) return;
    pageDiv.querySelector(".edit-layer")?.remove();
    const layer = document.createElement("div");
    layer.className = "edit-layer";
    const vp = view.viewport;
    for (const it of items) {
      const rect = this.mode === "text" ? [it.x1, it.y - it.size * 0.28, it.x2, it.y + it.size * 0.9] : it.rect;
      const [a, b, c, d] = vp.convertToViewportRectangle(rect);
      const el = document.createElement("div");
      Object.assign(el.style, { left: `${Math.min(a, c)}px`, top: `${Math.min(b, d)}px`, width: `${Math.abs(c - a)}px`, height: `${Math.abs(d - b)}px` });
      if (this.mode === "text") {
        el.className = "ed-line";
        el.title = it.text;
        el.onclick = () => this.editLine(pageNumber, it);
      } else {
        el.className = "ed-img";
        el.innerHTML = `<span class="fd-tools"><button type="button" data-act="replace" title="${t("edit.replaceImage")}">🔁</button><button type="button" data-act="del" title="${t("common.delete")}">🗑</button></span><span class="fd-handle"></span>`;
        el.querySelector("[data-act=replace]").onclick = (e) => { e.stopPropagation(); this.replaceImage(pageNumber, it); };
        el.querySelector("[data-act=del]").onclick = (e) => { e.stopPropagation(); this.deleteImage(pageNumber, it); };
        this.#wireDrag(el, pageNumber, it, vp);
      }
      layer.append(el);
    }
    pageDiv.append(layer);
  }

  #wireDrag(el, pageNumber, img, vp) {
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".fd-tools")) return;
      e.preventDefault();
      e.stopPropagation();
      const resize = e.target.classList.contains("fd-handle");
      const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const ratio = start.w / start.h;
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (resize) {
          // Corner drag keeps the image's proportions unless Shift is held.
          const w = Math.max(8, start.w + dx);
          el.style.width = `${w}px`;
          el.style.height = `${ev.shiftKey ? Math.max(8, start.h + dy) : w / ratio}px`;
        } else {
          el.style.left = `${start.left + dx}px`;
          el.style.top = `${start.top + dy}px`;
        }
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (!moved) return;
        const l = el.offsetLeft, tp = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
        const [x1, y1] = vp.convertToPdfPoint(l, tp + h);
        const [x2, y2] = vp.convertToPdfPoint(l + w, tp);
        this.moveImage(pageNumber, img, [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }
}
