// REA PDF — renderer entry point
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";
import { hydrateIcons, icon } from "./icons.js";
import { platform, fileToDoc, isDesktop, security, tools } from "./platform.js";
import { ocrDocument, compressDocument, COMPRESSION, exportWord, exportText, exportImages, imagesToPdf, fixArabicAppearances } from "./tools.js";
import { Organizer } from "./organize.js";
import { STAMPS, makeStampFile } from "./stamps.js";
import { ViewerL10n } from "./l10n.js";
import { t, applyDom, setLang, getLang, onLangChange } from "./i18n.js";
import { modal } from "./ui.js";
import { createSignature, savedSignatures, deleteSignature, dataUrlToFile } from "./signature-pad.js";
import { Redactor, rectPicker } from "./redact.js";
import { FormDesigner } from "./forms.js";
import { Comments } from "./comments.js";
import { ContentEditor } from "./edit.js";
import { startReview, mergeReview, exportXfdf, reviewers } from "./review.js";
import { readRouting, startRouting, offerDraft, showRouting } from "./routing.js";
import {
  protectDocument, unprotectDocument, signDocument, verifySignatures, signatureStatus, showSignatures,
  hasSignatures, isEncryptedBytes, confirmBreaksSignatures,
} from "./secure.js";

globalThis.pdfjsLib = pdfjsLib; // pdf_viewer.mjs reads the core library from here
const { EventBus, PDFLinkService, PDFFindController, PDFViewer } = await import("../node_modules/pdfjs-dist/web/pdf_viewer.mjs");
const { AnnotationEditorType: AET, AnnotationEditorParamsType: AEP } = pdfjsLib;

const lib = (p) => new URL(`../node_modules/pdfjs-dist/${p}`, import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = lib("build/pdf.worker.mjs");
const DOC_OPTS = {
  cMapUrl: lib("cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: lib("standard_fonts/"),
  isEvalSupported: false,
};
const loadPdf = (data) => pdfjsLib.getDocument({ ...DOC_OPTS, data }).promise;

const $ = (id) => document.getElementById(id);
applyDom();
hydrateIcons();

// ---------- feedback ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
async function busy(text, fn) {
  $("busyText").textContent = text;
  $("busy").hidden = false;
  try { return await fn(); }
  catch (err) { console.error(err); toast(t("err.generic", { msg: err.message || err }), true); }
  finally { $("busy").hidden = true; }
}
const progress = (text) => ($("busyText").textContent = text);

// ---------- viewer ----------
const container = $("viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const findController = new PDFFindController({ eventBus, linkService });
const HIGHLIGHT_COLORS = { yellow: "#FFF176", green: "#A5D6A7", blue: "#90CAF9", pink: "#F48FB1", red: "#EF9A9A" };
const l10n = new ViewerL10n();
l10n.translate(container);
const pdfViewer = new PDFViewer({
  container,
  viewer: $("viewer"),
  eventBus,
  l10n,
  linkService,
  findController,
  annotationEditorMode: AET.NONE,
  imageResourcesPath: lib("web/images/"), // sticky-note icons
  annotationEditorHighlightColors: Object.entries(HIGHLIGHT_COLORS).map(([k, v]) => `${k}=${v}`).join(","),
});
linkService.setViewer(pdfViewer);
// pdf.js needs an absolutely positioned container, so make room for the bars above it.
// (applied on the next frame, so the resize doesn't re-enter the observer loop)
new ResizeObserver(() => requestAnimationFrame(() => (container.style.top = `${$("viewerBars").offsetHeight}px`))).observe($("viewerBars"));

const state = {
  name: null,
  path: null,
  pdf: null,
  dirty: false,
  annotDirty: false,
  orgStale: true,
  tool: "select",
  screen: "home",
  color: { highlight: HIGHLIGHT_COLORS.yellow, freetext: "#13212E", ink: "#0071B9" },
  size: { freetext: 16, ink: 3 },
};

function setDirty(d) {
  state.dirty = d;
  platform.setDirty(d);
  const title = $("docTitle");
  title.textContent = state.name || "";
  if (d) title.insertAdjacentHTML("beforeend", `<span class="dirty">● ${t("doc.unsaved")}</span>`);
  platform.setTitle(state.name ? `${state.name}${d ? " •" : ""} — REA PDF` : "REA PDF");
}

async function openBytes(bytes, { name, path = null, dirty = false, page = null, password, keepEditUndo = false } = {}) {
  // A document in a shared review folder opens with every reviewer's comments merged in.
  let review = null;
  if (path && !dirty && tools) {
    const info = await tools.reviewInfo({ filePath: path }).catch(() => null);
    if (info) {
      review = info;
      bytes = await mergeReview(bytes, info).catch((err) => { console.warn(err); return bytes; });
    }
  } else if (dirty && path && state.review && path === state.path) review = state.review;
  let usedPassword = password;
  const task = pdfjsLib.getDocument({ ...DOC_OPTS, data: bytes.slice(), password });
  task.onPassword = async (update, reason) => {
    const pw = await askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    usedPassword = pw;
    pw === null ? task.destroy() : update(pw);
  };
  let pdf;
  try { pdf = await task.promise; }
  catch (err) {
    if (err?.name !== "AbortException") toast(t("err.openFailed"), true);
    return false;
  }
  const old = state.pdf;
  Object.assign(state, { pdf, name, path, review, annotDirty: false, orgStale: true, password: usedPassword ?? "", encrypted: isEncryptedBytes(bytes) });
  redactor.clear();
  if (state.tool === "redact") setTool("select");
  checkSignatures(bytes);
  designer.refresh(pdf, bytes).then((n) => { if (n && !dirty) toast(t("form.detected", { n })); }).catch(() => {});
  pdf.annotationStorage.onSetModified = () => { state.annotDirty = true; state.orgStale = true; setDirty(true); };
  linkService.setDocument(pdf, null);
  pdfViewer.setDocument(pdf);
  // The previous document is destroyed only once the viewer has switched over,
  // so page requests still in flight for it don't fail.
  const dropOld = () => { clearTimeout(dropTimer); old?.destroy(); };
  const dropTimer = setTimeout(dropOld, 10000);
  eventBus._on("pagesinit", function init() {
    eventBus._off("pagesinit", init);
    pdfViewer.currentScaleValue = state.scaleValue || "auto";
    if (page) pdfViewer.currentPageNumber = Math.min(page, pdf.numPages);
    setTimeout(dropOld, 500);
  });
  $("pageCount").textContent = pdf.numPages;
  buildThumbs(pdf);
  document.querySelectorAll(".tab[data-tab]").forEach((t) => (t.disabled = false));
  ["btnSave", "btnSaveAs", "btnPrint"].forEach((id) => ($(id).disabled = false));
  setDirty(dirty);
  if (path) addRecent(path, name);
  showScreen("view");
  setTool("select");
  comments.refresh().catch(() => {}); // a newer document may already have replaced this one
  editor.reset({ keepUndo: keepEditUndo });
  $("toolGroup").querySelector('[data-tool="editundo"]').disabled = !editor.canUndo;
  paintReviewBar();
  await refreshRouting(bytes);
  return true;
}

// Current document bytes including any unsaved annotation edits.
async function currentBytes() {
  if (!state.pdf) return null;
  if (!state.annotDirty) return state.pdf.getData();
  let bytes = await state.pdf.saveDocument();
  // New comments carry the author's name and a unique id (needed for replies and shared review).
  if (tools) bytes = await tools.comments({ pdf: bytes, ops: [{ op: "normalize", author: comments.author }] }).then((r) => r.pdf).catch((err) => { console.warn(err); return bytes; });
  // Arabic text boxes get an image appearance so other readers show them correctly.
  return fixArabicAppearances(bytes, loadPdf).catch((err) => { console.warn(err); return bytes; });
}

// Unencrypted bytes for operations that rebuild the file (pdf-lib can't write encrypted input).
async function plainBytes() {
  const bytes = await currentBytes();
  if (!bytes || !state.encrypted) return bytes;
  if (!security) { toast(t("err.decryptDesktopOnly"), true); return null; }
  return security.decrypt({ pdf: bytes, password: state.password || "" });
}

// Signature banner: verify embedded signatures whenever a document opens.
let sigList = [];
async function checkSignatures(bytes) {
  const banner = $("sigBanner");
  banner.hidden = true;
  sigList = [];
  if (!security || !hasSignatures(bytes)) return;
  if (state.encrypted) {
    // Signature contents are encrypted too; they can't be checked from the raw file.
    return paintBanner({ level: "warn", text: t("sig.bannerEncrypted") });
  }
  paintBanner({ level: "checking", text: t("sig.bannerChecking") });
  const pdfAtStart = state.pdf;
  try { sigList = await verifySignatures(bytes); } catch { return paintBanner(null); }
  if (state.pdf !== pdfAtStart) return; // another document opened meanwhile
  paintBanner(signatureStatus(sigList));
}
function paintBanner(st) {
  const banner = $("sigBanner");
  banner.hidden = !st;
  if (!st) return;
  banner.className = `sig-banner ${st.level}`;
  banner.innerHTML = `${icon("shield")}<span>${st.text}</span><span class="muted">— ${t("sig.bannerDetails")}</span>`;
}
async function openSignaturePanel() {
  if (state.encrypted) return toast(t("sig.removeProtectionToVerify"));
  const bytes = await currentBytes();
  if (!hasSignatures(bytes)) return toast(t("sig.none"));
  await showSignatures(
    async () => verifySignatures(await currentBytes()),
    (list) => { sigList = list; paintBanner(signatureStatus(list)); },
    { addLtv: addLtvToDocument },
  );
}

// Embed long-term validation data, saving in place (incremental, signatures stay valid).
async function addLtvToDocument() {
  return busy(t("busy.ltv"), async () => {
    const { bytes, added } = await security.addLtv({ pdf: await currentBytes() });
    const res = state.path && isDesktop ? await platform.save(state.path, bytes) : await platform.saveAs(state.name, bytes);
    if (!res) return false;
    await openBytes(bytes, { name: res.name, path: res.path ?? state.path, page: pdfViewer.currentPageNumber });
    toast(t("ltv.added", { certs: added.Certs, ocsps: added.OCSPs, crls: added.CRLs }));
    return true;
  });
}
$("sigBanner").onclick = openSignaturePanel;

async function confirmDiscard() {
  if (!state.dirty) return true;
  const r = await platform.confirm(t("confirm.unsaved"), t("confirm.unsavedDetail"), [t("confirm.discard"), t("common.cancel")]);
  return r === 0;
}

// ---------- file actions ----------
async function doOpen() {
  if (!(await confirmDiscard())) return false;
  const [doc] = await platform.open(false);
  if (!doc) return false;
  return busy(t("busy.opening"), () => openBytes(doc.data, { name: doc.name, path: doc.path }));
}

async function openPath(p) {
  if (!(await confirmDiscard())) return;
  await busy(t("busy.opening"), async () => {
    const doc = await platform.readPath(p);
    await openBytes(doc.data, { name: doc.name, path: doc.path });
  });
}

async function doSave(saveAs = false) {
  if (!state.pdf) return;
  if (state.review && !saveAs) return publishReview();
  if (state.screen === "organize" && organizer.dirty && !(await applyOrganize())) return;
  await commitEditing();
  await busy(t("busy.saving"), async () => {
    const data = await currentBytes();
    const res = !saveAs && state.path && isDesktop
      ? await platform.save(state.path, data)
      : await platform.saveAs(state.name || `${t("doc.untitled")}.pdf`, data);
    if (!res) return;
    const page = pdfViewer.currentPageNumber;
    state.scaleValue = pdfViewer.currentScaleValue;
    await openBytes(new Uint8Array(data), { name: res.name, path: res.path ?? state.path, page, password: state.password || undefined });
    toast(t("toast.saved"));
  });
}

async function doMerge() {
  const docs = await platform.open(true);
  if (!docs.length) return;
  if (docs.length < 2) return toast(t("merge.needTwo"));
  if (!(await confirmDiscard())) return;
  await busy(t("busy.merging"), async () => {
    const { PDFDocument } = globalThis.PDFLib;
    const out = await PDFDocument.create();
    for (const d of docs) {
      const src = await PDFDocument.load(d.data, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    await openBytes(await out.save(), { name: `${t("merge.fileName")}.pdf`, dirty: true });
    toast(t("merge.done", { n: docs.length }));
  });
}

async function doPrint() {
  if (!state.pdf) return;
  await commitEditing();
  await busy(t("busy.print"), async () => {
    const box = $("printContainer");
    box.textContent = "";
    const pdf = await loadPdf(await currentBytes());
    const urls = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 150 / 72 });
      const canvas = Object.assign(document.createElement("canvas"), { width: vp.width, height: vp.height });
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, intent: "print" }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = new Image();
      img.src = url;
      await img.decode();
      box.append(img);
    }
    pdf.destroy();
    window.print();
    box.textContent = "";
    urls.forEach(URL.revokeObjectURL);
  });
}

// ---------- tools ----------
const TOOL_MODE = { highlight: AET.HIGHLIGHT, freetext: AET.FREETEXT, ink: AET.INK, image: AET.STAMP, stamp: AET.STAMP };

function setMode(mode) {
  return new Promise((resolve) => {
    if (!state.pdf || pdfViewer.annotationEditorMode === mode) return resolve();
    const done = (e) => { if (e.mode === mode) { eventBus._off("annotationeditormodechanged", done); resolve(); } };
    eventBus._on("annotationeditormodechanged", done);
    try { pdfViewer.annotationEditorMode = { mode }; }
    catch { eventBus._off("annotationeditormodechanged", done); return resolve(); } // editor not ready yet
    setTimeout(resolve, 1500);
  });
}

// Leaving edit mode commits in-progress drawings/text into annotation storage.
const commitEditing = () => (pdfViewer.annotationEditorMode !== AET.NONE ? setMode(AET.NONE).then(() => setTool("select")) : Promise.resolve());

function sendParam(type, value) {
  eventBus.dispatch("switchannotationeditorparams", { source: window, type, value });
}

let stopRedactPicker = null;

async function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll("#toolGroup .tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  container.classList.toggle("hand", tool === "hand");
  await setMode(TOOL_MODE[tool] ?? AET.NONE);
  // Redaction mode: drag rectangles to mark areas.
  $("redactBar").hidden = tool !== "redact";
  if (tool === "redact" && !stopRedactPicker) stopRedactPicker = rectPicker(container, pdfViewer, (n, r) => redactor.add(n, r));
  if (tool !== "redact" && stopRedactPicker) { stopRedactPicker(); stopRedactPicker = null; }
  renderToolOptions();
  if (tool === "highlight") sendParam(AEP.HIGHLIGHT_DEFAULT_COLOR, state.color.highlight);
  if (tool === "freetext") { sendParam(AEP.FREETEXT_COLOR, state.color.freetext); sendParam(AEP.FREETEXT_SIZE, state.size.freetext); }
  if (tool === "ink") { sendParam(AEP.INK_COLOR, state.color.ink); sendParam(AEP.INK_THICKNESS, state.size.ink); }
}

const PALETTE = {
  highlight: Object.values(HIGHLIGHT_COLORS),
  freetext: ["#13212E", "#0071B9", "#003462", "#C62828", "#2E7D32"],
  ink: ["#0071B9", "#003462", "#13212E", "#C62828", "#2E7D32", "#F9A825"],
};

function renderToolOptions() {
  const tool = state.tool;
  const colors = PALETTE[tool];
  $("optColor").hidden = !colors;
  $("optSize").hidden = !(tool === "freetext" || tool === "ink");
  if (colors) {
    $("swatches").innerHTML = colors
      .map((c) => `<button class="swatch${c === state.color[tool] ? " on" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`)
      .join("");
  }
  if (tool === "ink") Object.assign($("sizeRange"), { min: 1, max: 20, value: state.size.ink });
  if (tool === "freetext") Object.assign($("sizeRange"), { min: 8, max: 72, value: state.size.freetext });
}

$("swatches").addEventListener("click", (e) => {
  const c = e.target.dataset.color;
  if (!c) return;
  const tool = state.tool;
  state.color[tool] = c;
  if (tool === "highlight") { sendParam(AEP.HIGHLIGHT_DEFAULT_COLOR, c); sendParam(AEP.HIGHLIGHT_COLOR, c); }
  if (tool === "freetext") sendParam(AEP.FREETEXT_COLOR, c);
  if (tool === "ink") sendParam(AEP.INK_COLOR, c);
  renderToolOptions();
});
$("sizeRange").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  if (state.tool === "ink") { state.size.ink = v; sendParam(AEP.INK_THICKNESS, v); }
  if (state.tool === "freetext") { state.size.freetext = v; sendParam(AEP.FREETEXT_SIZE, v); }
});

// Images and stamps go through the editor's own paste path, so they become
// regular, movable, resizable stamp annotations.
async function insertImage(file) {
  await setTool("image");
  // The editor registers its types when the page's editor layer is first built.
  const sel = `.page[data-page-number="${pdfViewer.currentPageNumber}"] .annotationEditorLayer`;
  for (let i = 0; i < 40 && !container.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => requestAnimationFrame(r));
  const before = container.querySelectorAll(".stampEditor canvas").length;
  const dt = new DataTransfer();
  dt.items.add(file);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  // The editor decodes the image asynchronously; saving before that fails.
  for (let i = 0; i < 60 && container.querySelectorAll(".stampEditor canvas").length <= before; i++) await new Promise((r) => setTimeout(r, 50));
}

const needsDesktop = () => { if (security) return false; toast(t("err.desktopOnly"), true); return true; };

$("toolGroup").addEventListener("click", async (e) => {
  const setBtn = e.target.closest("[data-set]");
  if (setBtn && setBtn.parentElement.id === "toolSets") return showToolSet(setBtn.dataset.set);
  const protect = e.target.closest("[data-protect]")?.dataset.protect;
  if (protect) {
    e.target.closest(".dropdown").classList.remove("open");
    if (needsDesktop()) return;
    await commitEditing();
    return protect === "add" ? protectDocument(secCtx) : unprotectDocument(secCtx);
  }
  const toolAction = e.target.closest("[data-ocr], [data-compress], [data-export]");
  if (toolAction) {
    e.target.closest(".dropdown").classList.remove("open");
    const { ocr, compress, export: exp } = toolAction.dataset;
    if (ocr) return runOcr(ocr === "all");
    if (compress) return runCompress(compress);
    return runExport(exp);
  }
  const reviewAct = e.target.closest("[data-review]")?.dataset.review;
  if (reviewAct) {
    e.target.closest(".dropdown").classList.remove("open");
    if (needsDesktop()) return;
    await commitEditing();
    return reviewAct === "start" ? doStartReview() : syncReview();
  }
  const fieldBtn = e.target.closest("[data-field]");
  if (fieldBtn) { await commitEditing(); return designer.create(fieldBtn.dataset.field); }
  const btn = e.target.closest("[data-tool]");
  if (!btn) return;
  if (btn.dataset.tool === "fieldhl") { designer.setHighlight(!designer.highlight); btn.classList.toggle("active", designer.highlight); return; }
  if (btn.dataset.tool === "fieldedit") { await commitEditing(); designer.setEditing(!designer.editing); return; }
  const tool = btn.dataset.tool;
  if (tool === "image") { const inp = $("imageFile"); inp.value = ""; inp.click(); return; }
  if (["stamp", "protect", "ocr", "compress", "export", "review"].includes(tool)) { btn.parentElement.classList.toggle("open"); return; }
  if (tool === "edittext" || tool === "editimg") { if (needsDesktop()) return; await commitEditing(); return editor.setMode(tool === "edittext" ? "text" : "image"); }
  if (tool === "editundo") return editor.undo();
  if (tool === "note") { if (needsDesktop()) return; await commitEditing(); return comments.startNote(); }
  if (tool === "route") { if (needsDesktop()) return; await commitEditing(); return startRouting(collabCtx); }
  if (tool === "handsign") { renderHandSignMenu(); btn.parentElement.classList.toggle("open"); return; }
  if (tool === "certsign") { if (needsDesktop()) return; await commitEditing(); return signDocument(secCtx); }
  if (tool === "verify") { if (needsDesktop()) return; return openSignaturePanel(); }
  setTool(state.tool === tool && tool !== "select" ? "select" : tool);
});

function showToolSet(name) {
  document.querySelectorAll("#toolSets [data-set]").forEach((b) => b.classList.toggle("on", b.dataset.set === name));
  document.querySelectorAll("#toolGroup .set").forEach((s) => (s.hidden = s.dataset.set !== name));
  if (state.tool !== "select" && state.tool !== "hand") setTool("select");
  if (name !== "forms" && designer.editing) designer.setEditing(false);
  if (name !== "edit" && editor.mode) editor.setMode(editor.mode);
}

// ---------- handwritten signatures ----------
function renderHandSignMenu() {
  const list = savedSignatures();
  $("handSignMenu").innerHTML = `${list.map((s) => `<div class="saved"><button data-use="${s.id}"><img src="${s.url}" alt="${t("handsign.saved")}"></button><button class="del" data-del="${s.id}" title="${t("common.delete")}">×</button></div>`).join("")}
    ${list.length ? "<hr>" : ""}<button data-new>✎ ${t("handsign.new")}</button>`;
}
$("handSignMenu").addEventListener("click", async (e) => {
  const menu = e.currentTarget.closest(".dropdown");
  const del = e.target.closest("[data-del]")?.dataset.del;
  if (del) { deleteSignature(del); renderHandSignMenu(); return; }
  menu.classList.remove("open");
  const use = e.target.closest("[data-use]")?.dataset.use;
  if (use) return insertImage(await dataUrlToFile(savedSignatures().find((s) => s.id === use).url));
  if (e.target.closest("[data-new]")) {
    const file = await createSignature();
    if (file) { await insertImage(file); toast(t("handsign.placeHint")); }
  }
});

// ---------- redaction ----------
const redactor = new Redactor({ container, pdfViewer, eventBus });
redactor.onChange = () => ($("redactCount").textContent = t("redact.count", { n: redactor.count }));
redactor.onChange();
$("redactFind").onclick = async () => {
  const term = $("redactSearch").value.trim();
  if (!term) return;
  const n = await busy(t("busy.searching"), () => redactor.markText(state.pdf, term));
  toast(n ? t("redact.marked", { n }) : t("redact.notFound"));
};
$("redactSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") $("redactFind").click(); });
$("redactClear").onclick = () => redactor.clear();
$("redactApply").onclick = async () => {
  if (!redactor.count) return toast(t("redact.nothing"));
  if (!(await confirmBreaksSignatures(await currentBytes(), t("action.redact")))) return;
  const pages = redactor.marks.size;
  const ok = await modal({
    title: t("redact.confirmTitle"),
    body: `<p>${t("redact.confirmBody", { n: redactor.count, pages })}</p>
      <p class="note">${t("redact.confirmNote")}</p>`,
    actions: [{ label: t("redact.apply"), value: "ok", danger: true }, { label: t("common.cancel"), value: "cancel" }],
  });
  if (!ok) return;
  await commitEditing();
  await busy(t("busy.redacting"), async () => {
    const bytes = await plainBytes();
    if (!bytes) return;
    const out = await redactor.apply({ bytes, loadPdf, stripMetadata: $("redactMeta").checked });
    const page = pdfViewer.currentPageNumber;
    await openBytes(out, { name: state.name.replace(/(\.pdf)?$/i, ` - ${t("suffix.redacted")}.pdf`), path: null, dirty: true, page });
    toast(t("redact.done"));
  });
};

// Context for secure.js flows.
const secCtx = {
  state, pdfViewer, container, platform, toast, busy, plainBytes, currentBytes, progress,
  // After signing a routed document, offer a draft to the next signer.
  afterSign: (saved) => state.routing && offerDraft(collabCtx, state.routing, saved.path),
  openBytes: (bytes, opts) => openBytes(bytes, opts),
};

// ---------- forms ----------
const designer = new FormDesigner({
  container, pdfViewer, eventBus, state, currentBytes, plainBytes, busy, toast, confirmBreaksSignatures,
  openBytes: (bytes, opts) => openBytes(bytes, opts),
  fixAppearances: (bytes) => fixArabicAppearances(bytes, loadPdf).catch((err) => { console.warn(err); return bytes; }),
  onEditing: (on) => $("toolGroup").querySelector('[data-tool="fieldedit"]').classList.toggle("active", on),
  onSign: async (field) => { if (needsDesktop()) return; await commitEditing(); return signDocument(secCtx, { field }); },
});

// ---------- partial content editing ----------
const editor = new ContentEditor({
  container, pdfViewer, eventBus, state, plainBytes, currentBytes, busy, toast, confirmBreaksSignatures,
  openBytes: (bytes, opts) => openBytes(bytes, opts),
  onMode: (mode) => {
    $("toolGroup").querySelector('[data-tool="edittext"]').classList.toggle("active", mode === "text");
    $("toolGroup").querySelector('[data-tool="editimg"]').classList.toggle("active", mode === "image");
  },
});

// ---------- comments, shared review, signing order ----------
async function draft(d) {
  try {
    await tools.outlookDraft(d);
    toast(t("mail.draftReady"));
  } catch (err) { toast(err.message, true); }
}
const collabCtx = {
  state, container, pdfViewer, platform, toast, busy, plainBytes, currentBytes, confirmBreaksSignatures, draft,
  openBytes: (bytes, opts) => openBytes(bytes, opts),
  author: () => comments.author,
};
const comments = new Comments({
  container, pdfViewer, state, plainBytes, busy, toast,
  pane: $("commentsPane"),
  openBytes: (bytes, opts) => openBytes(bytes, opts),
  onCount: (n) => ($("cmCount").textContent = n || ""),
  onShow: () => showSide("comments"),
  changeName,
});
security?.settingsGet().then((s) => { comments.author = s.author || ""; comments.render(); }).catch(() => {});
if (!security) comments.author = t("cm.guest");

async function changeName() {
  const res = await modal({
    title: t("cm.nameTitle"),
    body: `<label class="field">${t("cm.nameLabel")}<input name="name" dir="auto" value="${escapeHtml(comments.author)}"></label><p class="note">${t("cm.nameNote")}</p>`,
    actions: [{ label: t("common.save"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
    validate: (v) => (v.name.trim() ? null : t("cm.needName")),
  });
  if (!res) return;
  comments.author = res.data.name.trim();
  await security?.settingsSet({ author: comments.author });
  comments.render();
}

function showSide(name) {
  document.querySelectorAll("[data-side]").forEach((b) => b.classList.toggle("on", b.dataset.side === name));
  $("thumbs").hidden = name !== "pages";
  $("commentsPane").hidden = name !== "comments";
  $("sidebar").classList.toggle("wide", name === "comments");
  $("sidebar").classList.remove("collapsed");
  if (name === "comments") comments.render();
}
document.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => showSide(b.dataset.side)));

function paintReviewBar() {
  const r = state.review;
  $("reviewBar").hidden = !r;
  if (r) $("reviewText").textContent = t("review.bar", { title: r.meta.title, n: reviewers(r).length });
}
async function publishReview() {
  await commitEditing();
  await busy(t("busy.publishing"), async () => {
    const bytes = await currentBytes();
    const xfdf = await exportXfdf(bytes, { author: comments.author, fileName: state.review.meta.document });
    await tools.reviewPublish({ dir: state.review.dir, author: comments.author, xfdf });
    setDirty(false);
    toast(t("review.published"));
  });
}
async function syncReview() {
  if (!state.review) return toast(t("review.notInReview"));
  if (state.dirty) await publishReview();
  const page = pdfViewer.currentPageNumber;
  const doc = await platform.readPath(state.path);
  await openBytes(doc.data, { name: doc.name, path: doc.path, page });
  toast(t("review.synced", { n: comments.threads.length }));
}
async function doStartReview() {
  const created = await startReview(collabCtx);
  if (!created) return;
  const doc = await platform.readPath(created.path);
  await openBytes(doc.data, { name: doc.name, path: doc.path });
  toast(t("review.started"));
}
$("reviewSync").onclick = () => syncReview();
$("reviewPublish").onclick = () => publishReview();

async function refreshRouting(bytes) {
  state.routing = null;
  // The slip is written without object streams, so a byte search finds it cheaply.
  if (new TextDecoder("latin1").decode(bytes).includes("/REARouting")) state.routing = await readRouting(bytes);
  paintRouteBar();
}
function paintRouteBar() {
  const r = state.routing;
  $("routeBar").hidden = !r;
  if (!r) return;
  $("routeText").textContent = r.next
    ? t("route.bar", { title: r.title, done: r.done, n: r.signers.length, name: r.next.name })
    : t("route.barDone", { title: r.title, n: r.signers.length });
  $("routeDraft").textContent = t(r.next ? "route.draftNext" : "route.draftInitiator");
}
$("routeDetails").onclick = () => state.routing && showRouting(state.routing);
$("routeDraft").onclick = () => {
  if (!state.routing) return;
  if (state.dirty) return toast(t("route.saveFirst"), true);
  offerDraft(collabCtx, state.routing, state.path);
};

// ---------- tools: OCR, compression, conversion ----------
const toolCtx = { state, loadPdf, plainBytes, currentBytes, toast, progress, platform };
const sizeText = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} ${t("unit.mb")}` : `${Math.max(1, Math.round(n / 1024))} ${t("unit.kb")}`);
const withName = (suffix) => `${(state.name || t("doc.untitled")).replace(/\.pdf$/i, "")} - ${suffix}.pdf`;

async function runOcr(all) {
  if (needsDesktop()) return;
  await commitEditing();
  if (!(await confirmBreaksSignatures(await currentBytes(), t("action.ocr")))) return;
  await busy(t("busy.ocrPrep"), async () => {
    const out = await ocrDocument(toolCtx, { all });
    if (!out) return;
    await openBytes(out, { name: withName(t("suffix.searchable")), path: null, dirty: true, page: pdfViewer.currentPageNumber });
    toast(t("ocr.done", { pages: toolCtx.lastOcr.pages, conf: toolCtx.lastOcr.confidence }));
  });
}

async function runCompress(level) {
  await commitEditing();
  if (!(await confirmBreaksSignatures(await currentBytes(), t("action.compress")))) return;
  await busy(t("busy.compressing"), async () => {
    const r = await compressDocument(toolCtx, level);
    if (!r) return;
    if (r.after >= r.before * 0.97) return toast(t("compress.already", { size: sizeText(r.before) }));
    await openBytes(r.bytes, { name: withName(t("suffix.compressed")), path: null, dirty: true, page: pdfViewer.currentPageNumber });
    toast(t("compress.done", { before: sizeText(r.before), after: sizeText(r.after), pct: Math.round((1 - r.after / r.before) * 100) }));
  });
}

async function runExport(kind) {
  if (needsDesktop()) return;
  await commitEditing();
  await busy(t("busy.converting"), async () => {
    if (kind === "docx" || kind === "txt") {
      const res = await (kind === "docx" ? exportWord : exportText)(toolCtx);
      if (res) toast(t("export.saved", { name: res.name }) + (kind === "docx" ? t("export.docxNote") : ""));
    } else {
      const res = await exportImages(toolCtx, { format: kind, dpi: 150 });
      if (res) toast(t("export.imagesSaved", { n: res.count, dir: res.dir }));
    }
  });
}

async function runImagesToPdf() {
  if (needsDesktop()) return;
  if (!(await confirmDiscard())) return;
  await busy(t("busy.images"), async () => {
    const out = await imagesToPdf(toolCtx);
    if (out) await openBytes(out, { name: `${t("images.fileName")}.pdf`, dirty: true });
  });
}
$("toolGroup").querySelectorAll('[data-tool="certsign"], [data-tool="verify"], [data-tool="protect"]').forEach((b) => {
  if (!security) b.title = t("err.desktopOnly");
});
$("imageFile").addEventListener("change", (e) => e.target.files[0] && insertImage(e.target.files[0]));

// Stamps in the interface language first, then the other language.
function renderStampMenu() {
  const order = STAMPS.map((s, i) => ({ s, i })).sort((a, b) => (a.s.lang === getLang() ? 0 : 1) - (b.s.lang === getLang() ? 0 : 1));
  $("stampMenu").innerHTML = order.map(({ s, i }, k) =>
    `${k && order[k - 1].s.lang !== s.lang ? "<hr>" : ""}<button data-stamp="${i}"><span class="stamp-chip" style="color:${s.color}" dir="${s.lang === "ar" ? "rtl" : "ltr"}">${s.text}</span></button>`).join("");
}
renderStampMenu();
$("stampMenu").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-stamp]");
  if (!b) return;
  b.closest(".dropdown").classList.remove("open");
  insertImage(await makeStampFile(STAMPS[Number(b.dataset.stamp)]));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown")) document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
});

// Hand tool: drag to scroll.
let drag = null;
container.addEventListener("mousedown", (e) => {
  if (state.tool !== "hand" || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, l: container.scrollLeft, t: container.scrollTop };
  container.classList.add("dragging");
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  container.scrollLeft = drag.l - (e.clientX - drag.x);
  container.scrollTop = drag.t - (e.clientY - drag.y);
});
window.addEventListener("mouseup", () => { drag = null; container.classList.remove("dragging"); });

// ---------- navigation & zoom ----------
eventBus._on("pagechanging", ({ pageNumber }) => {
  $("pageInput").value = pageNumber;
  markThumb(pageNumber);
});
$("pageInput").addEventListener("change", (e) => {
  const n = parseInt(String(e.target.value).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), 10);
  if (n >= 1 && n <= pdfViewer.pagesCount) pdfViewer.currentPageNumber = n;
  else e.target.value = pdfViewer.currentPageNumber;
});
$("btnPrev").onclick = () => pdfViewer.previousPage();
$("btnNext").onclick = () => pdfViewer.nextPage();
$("btnZoomIn").onclick = () => pdfViewer.increaseScale();
$("btnZoomOut").onclick = () => pdfViewer.decreaseScale();
$("btnRotateView").onclick = () => (pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360);
$("zoomSelect").addEventListener("change", (e) => (pdfViewer.currentScaleValue = e.target.value));
eventBus._on("scalechanging", ({ scale, presetValue }) => {
  const sel = $("zoomSelect");
  const val = presetValue || String(Math.round(scale * 100) / 100);
  if ([...sel.options].some((o) => o.value === val && !o.hidden)) sel.value = val;
  else {
    const custom = sel.querySelector('option[value="custom"]');
    custom.textContent = `${Math.round(scale * 100)}%`;
    sel.value = "custom";
  }
});
container.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  e.deltaY < 0 ? pdfViewer.increaseScale() : pdfViewer.decreaseScale();
}, { passive: false });

// ---------- find ----------
let findTimer;
function find(type = "", previous = false) {
  eventBus.dispatch("find", {
    source: window, type, query: $("findInput").value, caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious: previous, matchDiacritics: false,
  });
}
$("findInput").addEventListener("input", () => {
  clearTimeout(findTimer);
  if (!$("findInput").value) $("findCount").textContent = "";
  findTimer = setTimeout(() => find(""), 250);
});
$("findInput").addEventListener("keydown", (e) => { if (e.key === "Enter") find("again", e.shiftKey); });
eventBus._on("updatefindmatchescount", ({ matchesCount: m }) => {
  if (!$("findInput").value) return;
  $("findCount").textContent = m.total ? t("find.count", { current: m.current, total: m.total }) : "";
});
eventBus._on("updatefindcontrolstate", ({ state: s, matchesCount: m }) => {
  if (!$("findInput").value) { $("findCount").textContent = ""; return; }
  if (s === 1 && $("findInput").value) $("findCount").textContent = t("find.none");
  else if (m?.total) $("findCount").textContent = t("find.count", { current: m.current, total: m.total });
});

// ---------- thumbnails sidebar ----------
let thumbObserver;
function buildThumbs(pdf) {
  const box = $("thumbs");
  box.textContent = "";
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting || en.target.dataset.done) continue;
      en.target.dataset.done = "1";
      renderThumb(pdf, en.target).catch(() => {}); // the document may have been closed meanwhile
    }
  }, { root: box, rootMargin: "300px" });
  for (let i = 1; i <= pdf.numPages; i++) {
    const t = document.createElement("div");
    t.className = "thumb";
    t.dataset.page = i;
    t.innerHTML = `<div class="ph" style="width:120px;height:160px"></div><span>${i}</span>`;
    t.onclick = () => (pdfViewer.currentPageNumber = i);
    box.append(t);
    thumbObserver.observe(t);
  }
  markThumb(1);
}
async function renderThumb(pdf, el) {
  if (pdf !== state.pdf) return;
  const page = await pdf.getPage(Number(el.dataset.page));
  const vp1 = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: (120 / vp1.width) * dpr });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = `${vp.width / dpr}px`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.catch(() => {});
  el.querySelector(".ph")?.replaceWith(canvas);
}
function markThumb(n) {
  const box = $("thumbs");
  box.querySelector(".thumb.current")?.classList.remove("current");
  const t = box.querySelector(`.thumb[data-page="${n}"]`);
  if (t) { t.classList.add("current"); t.scrollIntoView({ block: "nearest" }); }
}
$("btnToggleSidebar").onclick = () => $("sidebar").classList.toggle("collapsed");

// ---------- organize ----------
const organizer = new Organizer({
  grid: $("orgGrid"),
  loadPdf,
  toast,
  onStatus: (s) => ($("orgStatus").textContent = s),
  onHistory: (can) => ($("orgUndo").disabled = !can),
});

async function enterOrganize() {
  await commitEditing();
  if (state.orgStale) {
    const ok = await busy(t("busy.orgPrep"), async () => {
      const bytes = await plainBytes();
      if (!bytes) return false;
      await organizer.load(bytes);
      if (state.encrypted) toast(t("org.encryptedWarn"));
      return true;
    });
    if (!ok) return false;
    state.orgStale = false;
    $("orgUndo").disabled = true;
  }
  return true;
}

async function applyOrganize() {
  if (!(await confirmBreaksSignatures(await currentBytes(), t("action.organize")))) return false;
  return busy(t("busy.applying"), async () => {
    const bytes = await organizer.build();
    organizer.dirty = false; // before openBytes switches screens, so it doesn't re-prompt
    const ok = await openBytes(bytes, { name: state.name, path: state.path, dirty: true, page: 1 });
    if (ok) toast(t("org.applied"));
    return ok;
  });
}

$("orgRotateLeft").onclick = () => organizer.rotate(-90);
$("orgRotateRight").onclick = () => organizer.rotate(90);
$("orgDelete").onclick = () => organizer.remove();
$("orgUndo").onclick = () => organizer.undo();
$("orgSelectAll").onclick = () => organizer.selectAll();
$("orgBlank").onclick = () => organizer.insertBlank();
$("orgInsert").onclick = async () => organizer.insertDocs(await platform.open(true));
$("orgZoom").addEventListener("change", (e) => organizer.setThumbSize(Number(e.target.value)));
$("orgApply").onclick = () => (organizer.dirty ? applyOrganize() : showScreen("view"));
$("orgExtract").onclick = async () => {
  const bytes = await busy(t("busy.extracting"), () => organizer.buildSelected());
  if (!bytes) return;
  const base = (state.name || t("doc.untitled")).replace(/\.pdf$/i, "");
  const res = await platform.saveAs(`${base} - ${t("suffix.extracted")}.pdf`, bytes);
  if (res) toast(t("org.extracted"));
};

// ---------- screens ----------
async function showScreen(name) {
  if (name === state.screen) return;
  if (state.screen === "organize" && organizer.dirty) {
    const r = await platform.confirm(t("org.pendingTitle"), t("org.pendingDetail"), [t("org.applyBtn"), t("org.discardBtn"), t("common.cancel")]);
    if (r === 2) return;
    if (r === 0) { if (!(await applyOrganize())) return; if (name === "view") return; }
    else { organizer.dirty = false; state.orgStale = true; }
  }
  if (name === "organize" && !(await enterOrganize())) return;
  state.screen = name;
  $("screenHome").hidden = name !== "home";
  $("screenView").hidden = name !== "view";
  $("screenOrganize").hidden = name !== "organize";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
}
document.querySelectorAll(".tab[data-tab]").forEach((t) => (t.onclick = () => showScreen(t.dataset.tab)));

// ---------- home ----------
$("btnOpen").onclick = doOpen;
$("btnHomeOpen").onclick = doOpen;
$("btnSave").onclick = () => doSave(false);
$("btnSaveAs").onclick = () => doSave(true);
$("btnPrint").onclick = doPrint;

document.querySelector(".tool-grid").addEventListener("click", async (e) => {
  const act = e.target.closest("[data-action]")?.dataset.action;
  if (!act) return;
  if (act === "merge") return doMerge();
  if (act === "images") return runImagesToPdf();
  if (!state.pdf && !(await doOpen())) return;
  if (act === "comment") { await showScreen("view"); showToolSet("comment"); setTool("highlight"); }
  if (act === "sign" || act === "protect") { await showScreen("view"); showToolSet("secure"); }
  if (act === "ocr" || act === "compress" || act === "export") { await showScreen("view"); showToolSet("tools"); }
  if (act === "organize") showScreen("organize");
  if (act === "open" && state.pdf) showScreen("view");
});

function loadRecent() {
  try { return JSON.parse(localStorage.getItem("midad.recent") || "[]"); } catch { return []; }
}
function addRecent(path, name) {
  const list = [{ path, name, at: Date.now() }, ...loadRecent().filter((r) => r.path !== path)].slice(0, 8);
  try { localStorage.setItem("midad.recent", JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  const list = isDesktop ? loadRecent() : [];
  $("recentBox").hidden = !list.length;
  $("recentList").innerHTML = list.map((r, i) => `<li data-i="${i}"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.path)}</small></li>`).join("");
}
$("recentList").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) openPath(loadRecent()[Number(li.dataset.i)].path);
});
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Drag & drop PDFs anywhere (images dropped while editing are handled by the editor).
const dz = $("dropZone");
window.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.items].some((i) => i.type === "application/pdf")) { e.preventDefault(); dz.classList.add("over"); }
});
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dz.classList.remove("over"); });
window.addEventListener("drop", async (e) => {
  dz.classList.remove("over");
  const file = [...e.dataTransfer.files].find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  if (!file) return;
  e.preventDefault();
  if (state.screen === "organize") return organizer.insertDocs([await fileToDoc(file)]);
  if (!(await confirmDiscard())) return;
  const doc = await fileToDoc(file);
  busy(t("busy.opening"), () => openBytes(doc.data, { name: doc.name }));
});

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const b = $("btnTheme");
  b.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  b.title = theme === "dark" ? t("theme.light") : t("theme.dark");
  try { localStorage.setItem("midad.theme", theme); } catch {}
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("midad.theme"); } catch {}
applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("btnTheme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---------- language ----------
$("btnLang").onclick = () => setLang(getLang() === "ar" ? "en" : "ar");
onLangChange(() => {
  applyTheme(document.documentElement.dataset.theme);
  renderStampMenu();
  setDirty(state.dirty);
  redactor.onChange();
  if (!$("sigBanner").hidden) paintBanner(state.encrypted ? { level: "warn", text: t("sig.bannerEncrypted") } : signatureStatus(sigList));
  if (organizer.items.length) organizer.render(); // card tooltips and badges
  $("findCount").textContent = "";
  paintReviewBar();
  paintRouteBar();
  comments.render();
});

// ---------- password prompt ----------
function askPassword(retry) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "pw-dialog";
    d.innerHTML = `<form method="dialog">
      <h3>${retry ? t("pw.wrong") : t("pw.protected")}</h3>
      <input type="password" autofocus placeholder="${t("pw.placeholder")}">
      <div class="row"><button value="ok" class="primary">${t("pw.open")}</button><button value="cancel" class="ghost">${t("common.cancel")}</button></div>
    </form>`;
    document.body.append(d);
    d.addEventListener("close", () => {
      const v = d.returnValue === "ok" ? d.querySelector("input").value : null;
      d.remove();
      resolve(v);
    });
    d.showModal();
  });
}

// ---------- keyboard ----------
window.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, [contenteditable='true'], .freeTextEditor");
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === "o") { e.preventDefault(); doOpen(); return; }
  if (ctrl && k === "s") { e.preventDefault(); doSave(e.shiftKey); return; }
  if (ctrl && k === "p") { e.preventDefault(); doPrint(); return; }
  if (ctrl && k === "f" && state.pdf) { e.preventDefault(); showScreen("view"); $("findInput").focus(); $("findInput").select(); return; }
  if (typing) return;
  if (state.screen === "organize") {
    if (e.key === "Delete") { e.preventDefault(); organizer.remove(); }
    if (ctrl && k === "z") { e.preventDefault(); organizer.undo(); }
    if (ctrl && k === "a") { e.preventDefault(); organizer.selectAll(); }
    return;
  }
  if (state.screen === "view" && state.pdf) {
    if (ctrl && (k === "=" || k === "+")) { e.preventDefault(); pdfViewer.increaseScale(); }
    if (ctrl && k === "-") { e.preventDefault(); pdfViewer.decreaseScale(); }
    if (e.key === "Escape") setTool("select");
    if (!ctrl && pdfViewer.annotationEditorMode === AET.NONE) {
      if (k === "v") setTool("select");
      if (k === "h") setTool("hand");
    }
  }
});

// ---------- startup ----------
renderRecent();
platform.onOpenPath((p) => openPath(p));
const pending = await platform.pendingOpen();
if (pending) openPath(pending);
globalThis.__midad = { editor, designer, comments, exportXfdf, readRouting, state, pdfViewer, organizer, openBytes, insertImage, setTool, redactor, currentBytes, plainBytes, security, tools, showToolSet, loadPdf }; // debugging/test handle
