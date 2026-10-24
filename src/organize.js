// Page organizer: reorder, rotate, delete, insert, extract — built with pdf-lib.
import { icon } from "./icons.js";
import { t } from "./i18n.js";

const A4 = [595.28, 841.89];
let keySeq = 0;

export class Organizer {
  constructor({ grid, loadPdf, toast, onStatus, onHistory }) {
    this.grid = grid;
    this.loadPdf = loadPdf; // (bytes) => pdf.js PDFDocumentProxy
    this.toast = toast;
    this.onStatus = onStatus;
    this.onHistory = onHistory;
    this.sources = new Map(); // id -> { bytes, pdf }
    this.items = [];          // { key, src, index, rot, blank, size }
    this.selected = new Set();
    this.history = [];
    this.anchor = null;
    this.thumbSize = 170;
    this.dirty = false;
    this.#wireGrid();
  }

  // ---------- model ----------
  async load(bytes) {
    await this.reset();
    const id = await this.#addSource(bytes);
    const { pdf } = this.sources.get(id);
    this.items = Array.from({ length: pdf.numPages }, (_, i) => this.#item(id, i));
    this.history = [];
    this.dirty = false;
    this.selected.clear();
    this.render();
  }

  async reset() {
    for (const s of this.sources.values()) await s.pdf.destroy().catch(() => {});
    this.sources.clear();
    this.items = [];
    this.selected.clear();
    this.grid.textContent = "";
  }

  async #addSource(bytes) {
    const id = `s${this.sources.size + 1}_${Date.now()}`;
    const pdf = await this.loadPdf(bytes.slice());
    this.sources.set(id, { bytes, pdf });
    return id;
  }

  #item(src, index, extra = {}) {
    return { key: `k${++keySeq}`, src, index, rot: 0, blank: false, ...extra };
  }

  #snapshot() {
    this.history.push(this.items.map((it) => ({ ...it })));
    if (this.history.length > 50) this.history.shift();
    this.dirty = true;
    this.onHistory?.(this.history.length > 0);
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.items = prev;
    this.selected = new Set([...this.selected].filter((k) => prev.some((it) => it.key === k)));
    this.dirty = this.history.length > 0;
    this.onHistory?.(this.history.length > 0);
    this.render();
  }

  #targets() {
    return this.items.filter((it) => this.selected.has(it.key));
  }

  rotate(delta, keys) {
    const set = keys ? new Set(keys) : this.selected;
    if (!set.size) return this.toast(t("org.selectOne"));
    this.#snapshot();
    for (const it of this.items) if (set.has(it.key)) it.rot = (it.rot + delta + 360) % 360;
    this.render();
  }

  remove(keys) {
    const set = keys ? new Set(keys) : this.selected;
    if (!set.size) return this.toast(t("org.selectOne"));
    if (set.size >= this.items.length) return this.toast(t("org.cantDeleteAll"));
    this.#snapshot();
    this.items = this.items.filter((it) => !set.has(it.key));
    for (const k of set) this.selected.delete(k);
    this.render();
  }

  #insertIndex() {
    let last = -1;
    this.items.forEach((it, i) => { if (this.selected.has(it.key)) last = i; });
    return last >= 0 ? last + 1 : this.items.length;
  }

  async insertDocs(docs) {
    if (!docs.length) return;
    this.#snapshot();
    let at = this.#insertIndex();
    const added = [];
    for (const doc of docs) {
      const id = await this.#addSource(doc.data);
      const n = this.sources.get(id).pdf.numPages;
      for (let i = 0; i < n; i++) added.push(this.#item(id, i));
    }
    this.items.splice(at, 0, ...added);
    this.selected = new Set(added.map((it) => it.key));
    this.render();
    this.toast(t("org.added", { n: added.length }));
  }

  async insertBlank() {
    this.#snapshot();
    const at = this.#insertIndex();
    const ref = this.items[at - 1] || this.items[0];
    let size = A4;
    if (ref && !ref.blank) {
      const page = await this.sources.get(ref.src).pdf.getPage(ref.index + 1);
      const vp = page.getViewport({ scale: 1 });
      size = [vp.width, vp.height];
    } else if (ref?.blank) size = ref.size;
    const it = this.#item(null, -1, { blank: true, size });
    this.items.splice(at, 0, it);
    this.selected = new Set([it.key]);
    this.render();
  }

  move(keys, targetKey, after) {
    const moving = this.items.filter((it) => keys.includes(it.key));
    if (!moving.length || keys.includes(targetKey)) return;
    this.#snapshot();
    const rest = this.items.filter((it) => !keys.includes(it.key));
    let at = rest.findIndex((it) => it.key === targetKey);
    if (at < 0) at = rest.length; else if (after) at += 1;
    rest.splice(at, 0, ...moving);
    this.items = rest;
    this.render();
  }

  selectAll() {
    const all = this.selected.size !== this.items.length;
    this.selected = all ? new Set(this.items.map((it) => it.key)) : new Set();
    this.#paintSelection();
  }

  // ---------- output ----------
  async build(items = this.items) {
    const { PDFDocument, degrees } = globalThis.PDFLib;
    const out = await PDFDocument.create();
    const libDocs = new Map();
    const copied = new Map(); // item.key -> PDFPage

    // Copy pages per source in one batch (preserves shared resources).
    const bySrc = new Map();
    for (const it of items) if (!it.blank) (bySrc.get(it.src) || bySrc.set(it.src, []).get(it.src)).push(it);
    for (const [src, list] of bySrc) {
      let lib = libDocs.get(src);
      if (!lib) {
        lib = await PDFDocument.load(this.sources.get(src).bytes, { ignoreEncryption: true, updateMetadata: false });
        libDocs.set(src, lib);
      }
      const pages = await out.copyPages(lib, list.map((it) => it.index));
      list.forEach((it, i) => copied.set(it.key, pages[i]));
    }
    for (const it of items) {
      if (it.blank) { out.addPage(it.size); continue; }
      const page = copied.get(it.key);
      if (it.rot) page.setRotation(degrees((page.getRotation().angle + it.rot) % 360));
      out.addPage(page);
    }
    return out.save();
  }

  buildSelected() {
    const sel = this.#targets();
    if (!sel.length) { this.toast(t("org.selectToExtract")); return null; }
    return this.build(sel);
  }

  // ---------- view ----------
  setThumbSize(px) {
    this.thumbSize = px;
    this.grid.style.setProperty("--thumb", `${px}px`);
    this.render();
  }

  render() {
    const grid = this.grid;
    grid.textContent = "";
    const frag = document.createDocumentFragment();
    this.items.forEach((it, i) => {
      const card = document.createElement("div");
      card.className = "org-card";
      card.draggable = true;
      card.dataset.key = it.key;
      card.innerHTML = `
        <div class="org-actions">
          <button data-act="rotl" title="${t("org.rotateLeft")}">${icon("rotl")}</button>
          <button data-act="rotr" title="${t("org.rotateRight")}">${icon("rotate")}</button>
          <button data-act="del" title="${t("org.delete")}">${icon("trash")}</button>
        </div>
        ${it.src && this.items[0]?.src !== it.src ? `<span class="org-badge">${t("org.badgeInserted")}</span>` : ""}
        ${it.blank ? `<span class="org-badge">${t("org.badgeBlank")}</span>` : ""}
        <div class="org-frame"><canvas></canvas></div>
        <div class="org-label">${i + 1}</div>`;
      frag.append(card);
      this.#drawThumb(it, card.querySelector("canvas"));
    });
    grid.append(frag);
    this.#paintSelection();
  }

  async #drawThumb(it, canvas) {
    const box = this.thumbSize;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (it.blank) {
      const [w, h] = it.size;
      const s = box / Math.max(w, h);
      canvas.width = w * s * dpr; canvas.height = h * s * dpr;
      canvas.style.width = `${w * s}px`; canvas.style.height = `${h * s}px`;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const page = await this.sources.get(it.src).pdf.getPage(it.index + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const s = box / Math.max(vp1.width, vp1.height);
      const vp = page.getViewport({ scale: s * dpr });
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = `${vp.width / dpr}px`; canvas.style.height = `${vp.height / dpr}px`;
      await page.render({ canvasContext: ctx, viewport: vp }).promise.catch(() => {});
    }
    canvas.style.transform = it.rot ? `rotate(${it.rot}deg)` : "";
  }

  #paintSelection() {
    for (const card of this.grid.children) card.classList.toggle("selected", this.selected.has(card.dataset.key));
    const n = this.selected.size;
    this.onStatus?.(t("org.status", { n: this.items.length }) + (n ? ` · ${t("org.selected", { n })}` : ""));
  }

  #wireGrid() {
    const grid = this.grid;
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".org-card");
      if (!card) { if (e.target === grid) { this.selected.clear(); this.#paintSelection(); } return; }
      const key = card.dataset.key;
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "rotl") return this.rotate(-90, [key]);
      if (act === "rotr") return this.rotate(90, [key]);
      if (act === "del") return this.remove([key]);
      if (e.shiftKey && this.anchor) {
        const a = this.items.findIndex((it) => it.key === this.anchor);
        const b = this.items.findIndex((it) => it.key === key);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.selected = new Set(this.items.slice(lo, hi + 1).map((it) => it.key));
      } else if (e.ctrlKey || e.metaKey) {
        this.selected.has(key) ? this.selected.delete(key) : this.selected.add(key);
        this.anchor = key;
      } else {
        this.selected = new Set([key]);
        this.anchor = key;
      }
      this.#paintSelection();
    });

    let dragKeys = [];
    const clearMarks = () => grid.querySelectorAll(".drop-before,.drop-after").forEach((c) => c.classList.remove("drop-before", "drop-after"));
    const isAfter = (card, x) => {
      const r = card.getBoundingClientRect();
      const rtl = getComputedStyle(grid).direction === "rtl";
      return rtl ? x < r.left + r.width / 2 : x > r.left + r.width / 2;
    };
    grid.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".org-card");
      if (!card) return;
      const key = card.dataset.key;
      dragKeys = this.selected.has(key) ? this.items.filter((it) => this.selected.has(it.key)).map((it) => it.key) : [key];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      requestAnimationFrame(() => dragKeys.forEach((k) => grid.querySelector(`[data-key="${k}"]`)?.classList.add("dragging")));
    });
    grid.addEventListener("dragover", (e) => {
      const card = e.target.closest(".org-card");
      if (!card || !dragKeys.length) return;
      e.preventDefault();
      clearMarks();
      card.classList.add(isAfter(card, e.clientX) ? "drop-after" : "drop-before");
    });
    grid.addEventListener("drop", (e) => {
      const card = e.target.closest(".org-card");
      if (!card || !dragKeys.length) return;
      e.preventDefault();
      const after = isAfter(card, e.clientX);
      clearMarks();
      this.move(dragKeys, card.dataset.key, after);
      dragKeys = [];
    });
    grid.addEventListener("dragend", () => {
      clearMarks();
      grid.querySelectorAll(".dragging").forEach((c) => c.classList.remove("dragging"));
      dragKeys = [];
    });
  }
}
