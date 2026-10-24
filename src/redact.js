// Redaction: mark areas (drag or text search), then burn them in.
// Applying rasterizes every marked page with the boxes painted black, so the
// hidden text, vectors and annotations are removed from the file — not covered.
import { t } from "./i18n.js";

/** Drag a rectangle on any page. Calls onRect(pageNumber, pdfRect) per drag until stop(). */
export function rectPicker(container, pdfViewer, onRect, { className = "pick-box" } = {}) {
  let drag = null;
  const down = (e) => {
    const pageDiv = e.target.closest?.(".page");
    if (!pageDiv || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = pageDiv.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = className;
    pageDiv.append(box);
    drag = { pageDiv, r, box, x: e.clientX - r.left, y: e.clientY - r.top };
    move(e);
  };
  const move = (e) => {
    if (!drag) return;
    const { r, box, x, y } = drag;
    const cx = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    const cy = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    Object.assign(box.style, { left: `${Math.min(x, cx)}px`, top: `${Math.min(y, cy)}px`, width: `${Math.abs(cx - x)}px`, height: `${Math.abs(cy - y)}px` });
  };
  const up = () => {
    if (!drag) return;
    const { pageDiv, box } = drag;
    drag = null;
    const left = parseFloat(box.style.left), top = parseFloat(box.style.top);
    const w = parseFloat(box.style.width), h = parseFloat(box.style.height);
    box.remove();
    if (!(w > 4 && h > 4)) return;
    const n = Number(pageDiv.dataset.pageNumber);
    const vp = pdfViewer.getPageView(n - 1).viewport;
    const [x1, y1] = vp.convertToPdfPoint(left, top);
    const [x2, y2] = vp.convertToPdfPoint(left + w, top + h);
    onRect(n, [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]);
  };
  container.addEventListener("mousedown", down, true);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  container.classList.add("picking");
  return () => {
    container.removeEventListener("mousedown", down, true);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    container.classList.remove("picking");
  };
}

export class Redactor {
  constructor({ container, pdfViewer, eventBus }) {
    this.container = container;
    this.pdfViewer = pdfViewer;
    this.marks = new Map(); // pageNumber -> [{ id, rect }]
    this.seq = 0;
    this.onChange = null;
    // pdf.js rebuilds page DOM on zoom/scroll; redraw our layer whenever a page renders.
    eventBus._on("pagerendered", ({ pageNumber }) => this.#draw(pageNumber));
  }

  get count() {
    let n = 0;
    for (const list of this.marks.values()) n += list.length;
    return n;
  }

  clear() {
    const pages = [...this.marks.keys()];
    this.marks.clear();
    pages.forEach((p) => this.#draw(p));
    this.onChange?.();
  }

  add(pageNumber, rect) {
    const list = this.marks.get(pageNumber) || [];
    list.push({ id: ++this.seq, rect });
    this.marks.set(pageNumber, list);
    this.#draw(pageNumber);
    this.onChange?.();
  }

  remove(pageNumber, id) {
    const list = (this.marks.get(pageNumber) || []).filter((m) => m.id !== id);
    list.length ? this.marks.set(pageNumber, list) : this.marks.delete(pageNumber);
    this.#draw(pageNumber);
    this.onChange?.();
  }

  #draw(pageNumber) {
    const pageDiv = this.container.querySelector(`.page[data-page-number="${pageNumber}"]`);
    if (!pageDiv) return;
    pageDiv.querySelector(".redact-layer")?.remove();
    const list = this.marks.get(pageNumber);
    if (!list?.length) return;
    const vp = this.pdfViewer.getPageView(pageNumber - 1).viewport;
    const layer = document.createElement("div");
    layer.className = "redact-layer";
    for (const m of list) {
      const [a, b, c, d] = vp.convertToViewportRectangle(m.rect);
      const el = document.createElement("div");
      el.className = "redact-mark";
      Object.assign(el.style, { left: `${Math.min(a, c)}px`, top: `${Math.min(b, d)}px`, width: `${Math.abs(c - a)}px`, height: `${Math.abs(d - b)}px` });
      const x = document.createElement("button");
      x.type = "button";
      x.title = t("redact.removeMark");
      x.textContent = "×";
      x.onclick = (e) => { e.stopPropagation(); this.remove(pageNumber, m.id); };
      x.onmousedown = (e) => e.stopPropagation();
      el.append(x);
      layer.append(el);
    }
    pageDiv.append(layer);
  }

  /** Mark every occurrence of `term` across the document. Returns the number of matches. */
  async markText(pdf, term) {
    const needle = normalize(term.trim());
    if (!needle) return 0;
    let found = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      for (const it of items) {
        if (!it.str) continue;
        const hay = normalize(it.str);
        let from = 0, at;
        while ((at = hay.indexOf(needle, from)) !== -1) {
          this.add(n, itemSubRect(it, at, needle.length, hay.length));
          found++;
          from = at + needle.length;
        }
      }
    }
    return found;
  }

  /** Burn marks into the document. Returns new PDF bytes. */
  async apply({ bytes, loadPdf, stripMetadata }) {
    const { PDFDocument, PDFName } = globalThis.PDFLib;
    const src = await loadPdf(bytes.slice());
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    const scale = 200 / 72;
    for (const [n, list] of [...this.marks.entries()].sort((a, b) => a[0] - b[0])) {
      const page = await src.getPage(n);
      const vp = page.getViewport({ scale });
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
      ctx.fillStyle = "#000";
      for (const m of list) {
        const [a, b, c, d] = vp.convertToViewportRectangle(m.rect);
        ctx.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      }
      const jpg = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9))).arrayBuffer());
      const img = await out.embedJpg(jpg);
      const w = vp.width / scale, h = vp.height / scale;
      out.removePage(n - 1);
      const np = out.insertPage(n - 1, [w, h]);
      np.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    await src.destroy();
    if (stripMetadata) {
      out.setTitle(""); out.setAuthor(""); out.setSubject(""); out.setKeywords([]);
      out.setCreator("REA PDF"); out.setProducer("REA PDF");
      out.catalog.delete(PDFName.of("Metadata"));
    }
    return out.save();
  }
}

// Strip Arabic diacritics and tatweel; unify alef/yaa/taa-marbuta forms for matching.
function normalize(s) {
  return s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

// Approximate the PDF-space box of a substring within a text item, assuming
// evenly spaced glyphs (padded so nothing slips through).
function itemSubRect(it, start, len, total) {
  const [a, b, , , e, f] = it.transform;
  const fontH = it.height || Math.hypot(a, b) || 10;
  const w = it.width || fontH * total * 0.5;
  let f1 = start / total, f2 = (start + len) / total;
  if (it.dir === "rtl") [f1, f2] = [1 - f2, 1 - f1];
  const pad = fontH * 0.08;
  return [e + w * f1 - pad, f - fontH * 0.3, e + w * f2 + pad, f + fontH * 1.0];
}
