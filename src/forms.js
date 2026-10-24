// Form design: create text, check box, radio, drop-down and signature fields,
// then move, resize, edit or delete them. Also offers "click to sign" on
// empty signature fields while viewing.
import { t, isRtl } from "./i18n.js";
import { modal, esc } from "./ui.js";
import { rectPicker } from "./redact.js";

export const FIELD_TYPES = ["text", "checkbox", "radio", "dropdown", "signature"];
const DEFAULT_NAME = { text: "Text", checkbox: "Check", radio: "Group", dropdown: "Dropdown", signature: "Signature" };
const DEFAULT_SIZE = { text: [180, 22], checkbox: [14, 14], radio: [14, 14], dropdown: [160, 22], signature: [180, 60] };
const KIND = { Tx: "text", Ch: "dropdown", Sig: "signature" };

const parseId = (id) => {
  const m = /^(\d+)R(\d*)$/.exec(id || "");
  return m ? { num: Number(m[1]), gen: Number(m[2] || 0) } : null;
};
const kindOf = (a) => (a.fieldType === "Btn" ? (a.radioButton ? "radio" : a.checkBox ? "checkbox" : "button") : KIND[a.fieldType] || "other");

/** pdf-lib field and widget for a pdf.js annotation id ("12R"). */
function locate(doc, id) {
  const ref = parseId(id);
  if (!ref) return null;
  for (const field of doc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const r = doc.context.getObjectRef(widget.dict);
      if (r && r.objectNumber === ref.num && r.generationNumber === ref.gen) return { field, widget, ref: r };
    }
  }
  return null;
}

/** Field properties as edited in the dialog. */
function readProps(doc, id) {
  const L = globalThis.PDFLib;
  const hit = locate(doc, id);
  if (!hit) return null;
  const { field } = hit;
  const dict = field.acroField.dict;
  const p = {
    name: field.getName(),
    tooltip: dict.lookupMaybe(L.PDFName.of("TU"), L.PDFString, L.PDFHexString)?.decodeText() || "",
    required: field.isRequired(),
    readOnly: field.isReadOnly(),
  };
  if (field instanceof L.PDFTextField) {
    p.type = "text";
    Object.assign(p, { value: field.getText() || "", align: field.getAlignment(), multiline: field.isMultiline(), maxLen: field.getMaxLength() || "" });
  } else if (field instanceof L.PDFCheckBox) {
    Object.assign(p, { type: "checkbox", checked: field.isChecked() });
  } else if (field instanceof L.PDFRadioGroup) {
    Object.assign(p, { type: "radio", group: p.name, options: field.getOptions(), checked: false });
  } else if (field instanceof L.PDFDropdown) {
    Object.assign(p, { type: "dropdown", options: field.getOptions(), value: field.getSelected()[0] || "", editable: field.isEditable() });
  } else if (field instanceof L.PDFSignature) {
    p.type = "signature";
  } else return null;
  if (p.type === "text" || p.type === "dropdown") p.fontSize = Number(/([\d.]+)\s+Tf/.exec(field.acroField.getDefaultAppearance() || "")?.[1] || 0);
  return p;
}

function propsDialog(type, p, { names, isNew }) {
  const align = p.align ?? (isRtl() ? 2 : 0);
  const name = type === "radio" ? "group" : "name";
  const opts = (p.options || []).join("\n");
  const sizes = `<label class="field">${t("form.fontSize")}<select name="fontSize">
    ${[0, 8, 9, 10, 11, 12, 14, 16, 18, 24].map((s) => `<option value="${s}"${(p.fontSize || 0) === s ? " selected" : ""}>${s || t("form.auto")}</option>`).join("")}</select></label>`;
  const chk = (n, on, label) => `<label class="check"><input type="checkbox" name="${n}"${on ? " checked" : ""}> ${label}</label>`;
  const body = `
    <div class="grid2">
      <label class="field">${t(type === "radio" ? "form.group" : "form.name")}<input name="${name}" dir="auto" value="${esc(p[name] ?? p.name ?? "")}"></label>
      <label class="field">${t("form.tooltip")}<input name="tooltip" dir="auto" value="${esc(p.tooltip || "")}"></label>
    </div>
    ${type === "text" ? `
      <label class="field">${t("form.defaultValue")}<input name="value" dir="auto" value="${esc(p.value || "")}"></label>
      <div class="grid2">
        <label class="field">${t("form.align")}<select name="align">
          ${[[2, "form.alignRight"], [1, "form.alignCenter"], [0, "form.alignLeft"]].map(([v, k]) => `<option value="${v}"${align === v ? " selected" : ""}>${t(k)}</option>`).join("")}</select></label>
        ${sizes}
      </div>
      <div class="grid2">
        <label class="field">${t("form.maxLen")}<input name="maxLen" type="number" min="0" value="${esc(p.maxLen || "")}"></label>
        <div class="field">${chk("multiline", p.multiline, t("form.multiline"))}</div>
      </div>` : ""}
    ${type === "dropdown" ? `
      <label class="field">${t("form.options")}<textarea name="options" rows="4" dir="auto">${esc(opts)}</textarea></label>
      <div class="grid2">
        <label class="field">${t("form.defaultValue")}<input name="value" dir="auto" value="${esc(p.value || "")}"></label>
        ${sizes}
      </div>
      ${chk("editable", p.editable, t("form.editable"))}` : ""}
    ${type === "radio" && isNew ? `
      <label class="field">${t("form.exportValue")}<input name="exportValue" dir="auto" value="${esc(p.exportValue || "")}"></label>
      ${chk("checked", p.checked, t("form.selected"))}` : ""}
    ${type === "checkbox" ? chk("checked", p.checked, t("form.checked")) : ""}
    <div class="grid2">${chk("required", p.required, t("form.required"))}${chk("readOnly", p.readOnly, t("form.readOnly"))}</div>
    ${type === "radio" ? `<p class="note">${t("form.radioNote")}</p>` : ""}`;
  return modal({
    title: t(isNew ? "form.newTitle" : "form.editTitle", { type: t(`form.type.${type}`) }),
    body,
    actions: [{ label: t(isNew ? "form.add" : "common.save"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
    validate(v) {
      const n = (v[name] || "").trim();
      if (!n) return t("form.needName");
      if (n.includes(".")) return t("form.noDots");
      const taken = names.get(n);
      if (n !== (p[name] ?? p.name) && taken && !(type === "radio" && taken === "radiobutton" && isNew)) return t("form.nameTaken", { name: n });
      if (type === "dropdown") {
        const list = v.options.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!list.length) return t("form.needOptions");
        if (v.value.trim() && !list.includes(v.value.trim()) && !v.editable) return t("form.valueNotOption");
      }
      if (type === "radio" && isNew && !v.exportValue.trim()) return t("form.needExport");
      return null;
    },
  }).then((res) => {
    if (!res) return null;
    const v = res.data;
    return {
      ...v,
      name: (v[name] || "").trim(),
      tooltip: v.tooltip.trim(),
      align: v.align != null ? Number(v.align) : undefined,
      fontSize: v.fontSize != null ? Number(v.fontSize) : undefined,
      maxLen: v.maxLen ? Number(v.maxLen) : 0,
      options: v.options != null ? v.options.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
      value: v.value?.trim(),
      exportValue: v.exportValue?.trim(),
    };
  });
}

/** Apply common and type-specific properties to a pdf-lib field. */
function applyProps(field, p) {
  const L = globalThis.PDFLib;
  const dict = field.acroField.dict;
  if (p.name && p.name !== field.getName()) field.acroField.setPartialName(p.name);
  if (p.tooltip) dict.set(L.PDFName.of("TU"), L.PDFHexString.fromText(p.tooltip));
  else dict.delete(L.PDFName.of("TU"));
  p.required ? field.enableRequired() : field.disableRequired();
  p.readOnly ? field.enableReadOnly() : field.disableReadOnly();
  if (field instanceof L.PDFTextField) {
    field.setAlignment(p.align ?? 0);
    p.multiline ? field.enableMultiline() : field.disableMultiline();
    if (p.maxLen) field.setMaxLength(p.maxLen); else field.removeMaxLength();
    field.setFontSize(p.fontSize || 0);
    if (p.maxLen && p.value?.length > p.maxLen) p.value = p.value.slice(0, p.maxLen);
    field.setText(p.value || undefined);
  } else if (field instanceof L.PDFCheckBox) {
    p.checked ? field.check() : field.uncheck();
  } else if (field instanceof L.PDFDropdown) {
    p.editable ? field.enableEditing() : field.disableEditing();
    field.setFontSize(p.fontSize || 0);
    field.setOptions(p.options);
    if (p.value) field.select(p.value, !!p.editable); else field.clear();
  }
}

const BORDER = () => globalThis.PDFLib.rgb(0.45, 0.55, 0.65);

export function addField(doc, pageIndex, rect, type, p) {
  const L = globalThis.PDFLib;
  const form = doc.getForm();
  const page = doc.getPage(pageIndex);
  const [x1, y1, x2, y2] = rect;
  const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderColor: BORDER(), borderWidth: 1, backgroundColor: undefined, textColor: L.rgb(0, 0, 0) };
  if (type === "signature") {
    const widget = doc.context.obj({
      Type: "Annot", Subtype: "Widget", FT: "Sig", T: L.PDFHexString.fromText(p.name), Rect: rect, F: 4, P: page.ref,
      MK: { BC: [0.45, 0.55, 0.65] }, ...(p.tooltip ? { TU: L.PDFHexString.fromText(p.tooltip) } : {}), ...(p.required ? { Ff: 2 } : {}),
    });
    const ref = doc.context.register(widget);
    page.node.addAnnot(ref);
    form.acroForm.addField(ref);
    return null;
  }
  let field;
  if (type === "text") { field = form.createTextField(p.name); field.addToPage(page, box); }
  if (type === "checkbox") { field = form.createCheckBox(p.name); field.addToPage(page, box); }
  if (type === "dropdown") { field = form.createDropdown(p.name); field.addToPage(page, box); }
  if (type === "radio") {
    const existing = form.getFieldMaybe(p.name);
    field = existing instanceof L.PDFRadioGroup ? existing : form.createRadioGroup(p.name);
    field.addOptionToPage(p.exportValue, page, box);
    if (p.checked) field.select(p.exportValue);
    const { checked, ...rest } = p;
    applyProps(field, rest);
    return field;
  }
  applyProps(field, p);
  return field;
}

export class FormDesigner {
  /** ctx: { container, pdfViewer, eventBus, state, currentBytes, plainBytes, openBytes, fixAppearances, busy, toast, confirmBreaksSignatures, onSign } */
  constructor(ctx) {
    this.ctx = ctx;
    this.editing = false;
    this.highlight = true;
    this.selected = null;
    this.emptySigs = new Set(); // ids of unsigned signature widgets
    this.stopPicker = null;
    ctx.eventBus._on("pagerendered", ({ pageNumber }) => this.#draw(pageNumber));
    window.addEventListener("keydown", (e) => {
      if (!this.editing || !this.selected || e.target.closest?.("input, textarea, select, dialog")) return;
      if (e.key === "Delete") { e.preventDefault(); this.remove(this.selected); }
      if (e.key === "Escape") this.#select(null);
    });
  }

  /** Called whenever a document opens: find fields and empty signature fields. */
  async refresh(pdf, bytes) {
    this.emptySigs = new Set();
    this.selected = null;
    this.fieldNames = new Map();
    const objs = await pdf.getFieldObjects().catch(() => null);
    if (pdf !== this.ctx.state.pdf) return 0;
    for (const [name, list] of Object.entries(objs || {})) this.fieldNames.set(name, list.find((o) => o.type)?.type || "field"); // the parent entry has no type
    const count = this.fieldNames.size;
    if (Object.values(objs || {}).some((list) => list.some((o) => o.type === "signature"))) {
      try {
        const L = globalThis.PDFLib;
        const doc = await L.PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
        for (const field of doc.getForm().getFields()) {
          if (!(field instanceof L.PDFSignature) || field.acroField.dict.get(L.PDFName.of("V"))) continue;
          for (const w of field.acroField.getWidgets()) {
            const r = doc.context.getObjectRef(w.dict);
            if (r) this.emptySigs.add(`${r.objectNumber}R${r.generationNumber || ""}`);
          }
        }
      } catch (err) { console.warn(err); }
    }
    this.#redrawAll();
    return count;
  }

  setHighlight(on) {
    this.highlight = on;
    this.ctx.container.classList.toggle("no-field-hl", !on);
  }

  setEditing(on) {
    this.editing = on;
    this.ctx.container.classList.toggle("form-editing", on);
    this.ctx.onEditing?.(on);
    if (!on) { this.#select(null); this.cancelCreate(); }
    this.#redrawAll();
  }

  // ---------- create ----------
  create(type) {
    this.cancelCreate();
    if (!this.editing) this.setEditing(true);
    this.ctx.toast(t("form.placeHint", { type: t(`form.type.${type}`) }));
    this.creating = type;
    this.ctx.container.dataset.creating = type;
    const finish = (page, rect) => { this.cancelCreate(); this.#createAt(type, page, rect); };
    // A click without dragging places a field of the default size.
    const click = (e) => {
      const pageDiv = e.target.closest?.(".page");
      if (!pageDiv || this.dragged) return;
      const n = Number(pageDiv.dataset.pageNumber);
      const vp = this.ctx.pdfViewer.getPageView(n - 1).viewport;
      const r = pageDiv.getBoundingClientRect();
      const [x, y] = vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      const [w, h] = DEFAULT_SIZE[type];
      finish(n, [x, y - h, x + w, y]);
    };
    const stop = rectPicker(this.ctx.container, this.ctx.pdfViewer, (page, rect) => { this.dragged = true; finish(page, rect); }, { className: "pick-box sign" });
    this.ctx.container.addEventListener("click", click, true);
    const onKey = (e) => { if (e.key === "Escape") this.cancelCreate(); };
    window.addEventListener("keydown", onKey, true);
    this.dragged = false;
    this.stopPicker = () => { stop(); this.ctx.container.removeEventListener("click", click, true); window.removeEventListener("keydown", onKey, true); };
  }

  cancelCreate() {
    this.stopPicker?.();
    this.stopPicker = null;
    this.creating = null;
    delete this.ctx.container.dataset.creating;
    setTimeout(() => (this.dragged = false));
  }

  async #createAt(type, page, rect) {
    const n = [...this.fieldNames.keys()].length + 1;
    let i = n;
    while (this.fieldNames.has(`${DEFAULT_NAME[type]}${i}`)) i++;
    const base = { name: `${DEFAULT_NAME[type]}${i}`, align: isRtl() ? 2 : 0, fontSize: 12 };
    if (type === "radio") Object.assign(base, { group: this.lastGroup || base.name, exportValue: t("form.choice", { n: this.#radioCount(this.lastGroup) + 1 }) });
    if (type === "dropdown") base.options = [];
    const p = await propsDialog(type, base, { names: this.fieldNames, isNew: true });
    if (!p) return;
    if (type === "radio") this.lastGroup = p.name;
    await this.#mutate((doc) => [addField(doc, page - 1, rect, type, p)]);
  }

  #radioCount(group) {
    if (!group) return 0;
    let n = 0;
    this.ctx.container.querySelectorAll(".fd-box").forEach((b) => { if (b.dataset.name === group) n++; });
    return n;
  }

  // ---------- edit ----------
  async editProps(id) {
    const L = globalThis.PDFLib;
    const bytes = await this.ctx.plainBytes();
    if (!bytes) return;
    const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
    const p = readProps(doc, id);
    if (!p) return this.ctx.toast(t("form.unsupported"), true);
    const res = await propsDialog(p.type, p, { names: this.fieldNames, isNew: false });
    if (!res) return;
    await this.#mutate((d) => {
      const hit = locate(d, id);
      if (p.type === "radio" || p.type === "signature") {
        const { checked, ...rest } = res;
        const field = hit.field;
        if (rest.name !== field.getName()) field.acroField.setPartialName(rest.name);
        const tu = L.PDFName.of("TU");
        rest.tooltip ? field.acroField.dict.set(tu, L.PDFHexString.fromText(rest.tooltip)) : field.acroField.dict.delete(tu);
        rest.required ? field.enableRequired() : field.disableRequired();
        rest.readOnly ? field.enableReadOnly() : field.disableReadOnly();
        return p.type === "radio" ? [field] : [];
      }
      applyProps(hit.field, res);
      return [hit.field];
    });
  }

  async remove(id) {
    await this.#mutate((doc) => {
      const L = globalThis.PDFLib;
      const hit = locate(doc, id);
      if (!hit) return [];
      const { field, ref } = hit;
      const widgets = field.acroField.getWidgets();
      if (widgets.length <= 1) { doc.getForm().removeField(field); return []; }
      // One option of a radio group: drop just this widget.
      const page = doc.findPageForAnnotationRef(ref);
      page?.node.removeAnnot(ref);
      const kids = field.acroField.dict.lookup(L.PDFName.of("Kids"), L.PDFArray);
      const idx = kids.indexOf(ref);
      if (idx >= 0) kids.remove(idx);
      return [field];
    });
  }

  async moveTo(id, rect) {
    await this.#mutate((doc) => {
      const hit = locate(doc, id);
      if (!hit) return [];
      const [x1, y1, x2, y2] = rect;
      hit.widget.setRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
      return [hit.field];
    }, { warn: false });
  }

  /** Rewrite the document with pdf-lib, then reopen it at the same page. */
  async #mutate(fn, { warn = true } = {}) {
    const { ctx } = this;
    if (warn && !(await ctx.confirmBreaksSignatures(await ctx.currentBytes(), t("action.formEdit")))) return false;
    return ctx.busy(t("busy.form"), async () => {
      const bytes = await ctx.plainBytes();
      if (!bytes) return false;
      const L = globalThis.PDFLib;
      const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
      const touched = (await fn(doc)) || [];
      const font = touched.some(Boolean) ? doc.getForm().getDefaultFont() : null;
      for (const f of touched) {
        if (!f || f instanceof L.PDFSignature) continue;
        // Latin values get pdf-lib's appearance; Arabic ones fail here and get an image appearance below.
        try { f.defaultUpdateAppearances(font); } catch { /* non-WinAnsi text */ }
      }
      const out = await ctx.fixAppearances(await doc.save({ updateFieldAppearances: false }));
      const { pdfViewer, state } = ctx;
      const top = ctx.container.scrollTop;
      await ctx.openBytes(out, { name: state.name, path: state.path, dirty: true, page: pdfViewer.currentPageNumber });
      ctx.container.scrollTop = top;
      return true;
    });
  }

  // ---------- overlays ----------
  #select(id) {
    this.selected = id;
    this.ctx.container.querySelectorAll(".fd-box").forEach((b) => b.classList.toggle("sel", b.dataset.id === id));
  }

  #redrawAll() {
    const n = this.ctx.pdfViewer.pagesCount || 0;
    for (let i = 1; i <= n; i++) this.#draw(i);
  }

  async #draw(pageNumber) {
    const view = this.ctx.pdfViewer.getPageView?.(pageNumber - 1);
    const pageDiv = view?.div;
    if (!pageDiv) return;
    pageDiv.querySelector(".form-layer")?.remove();
    if (!view.pdfPage || (!this.editing && !this.emptySigs.size)) return;
    const pdf = this.ctx.state.pdf;
    const annots = await view.pdfPage.getAnnotations().catch(() => []);
    if (pdf !== this.ctx.state.pdf) return;
    const widgets = annots.filter((a) => a.annotationType === 20 && a.fieldName != null && (this.editing || this.emptySigs.has(a.id)));
    pageDiv.querySelector(".form-layer")?.remove();
    if (!widgets.length) return;
    const layer = document.createElement("div");
    layer.className = "form-layer";
    const vp = view.viewport;
    for (const a of widgets) {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      const pos = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      const el = document.createElement(this.editing ? "div" : "button");
      Object.assign(el.style, { left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px`, height: `${pos.height}px` });
      if (!this.editing) {
        el.type = "button";
        el.className = "fd-sign";
        el.innerHTML = `<span>✎ ${t("form.clickToSign")}${a.alternativeText ? ` — ${esc(a.alternativeText)}` : ""}</span>`;
        el.title = a.fieldName;
        el.onclick = () => this.ctx.onSign({ name: a.fieldName, pageIndex: pageNumber - 1, rect: a.rect });
      } else {
        const kind = kindOf(a);
        el.className = `fd-box fd-${kind}${a.id === this.selected ? " sel" : ""}`;
        el.dataset.id = a.id;
        el.dataset.name = a.fieldName;
        el.title = `${a.fieldName} — ${t(`form.type.${kind}`, {}) || kind}`;
        el.innerHTML = `<span class="fd-label">${esc(a.fieldName)}${kind === "radio" && a.buttonValue && !/^\d+$/.test(a.buttonValue) ?` · ${esc(a.buttonValue)}` : ""}</span>
          <span class="fd-tools"><button type="button" data-act="props" title="${t("form.properties")}">✎</button><button type="button" data-act="del" title="${t("common.delete")}">🗑</button></span>
          <span class="fd-handle"></span>`;
        this.#wire(el, a, pageNumber, vp);
      }
      layer.append(el);
    }
    pageDiv.append(layer);
  }

  #wire(el, a, pageNumber, vp) {
    el.addEventListener("dblclick", (e) => { e.stopPropagation(); this.editProps(a.id); });
    el.querySelector("[data-act=props]").onclick = (e) => { e.stopPropagation(); this.editProps(a.id); };
    el.querySelector("[data-act=del]").onclick = (e) => { e.stopPropagation(); this.remove(a.id); };
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".fd-tools") || this.creating) return;
      e.preventDefault();
      e.stopPropagation();
      this.#select(a.id);
      const resize = e.target.classList.contains("fd-handle");
      const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const page = el.parentElement.getBoundingClientRect();
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (resize) {
          el.style.width = `${Math.max(8, Math.min(start.w + dx, page.width - start.left))}px`;
          el.style.height = `${Math.max(8, Math.min(start.h + dy, page.height - start.top))}px`;
        } else {
          el.style.left = `${Math.max(0, Math.min(start.left + dx, page.width - start.w))}px`;
          el.style.top = `${Math.max(0, Math.min(start.top + dy, page.height - start.h))}px`;
        }
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (!moved) return;
        const l = el.offsetLeft, tp = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
        const [px1, py1] = vp.convertToPdfPoint(l, tp);
        const [px2, py2] = vp.convertToPdfPoint(l + w, tp + h);
        this.moveTo(a.id, [Math.min(px1, px2), Math.min(py1, py2), Math.max(px1, px2), Math.max(py1, py2)]);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }
}
