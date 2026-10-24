// Shared review: the document lives in a shared folder (network share or a
// OneDrive/SharePoint-synced folder) next to one XFDF file per reviewer.
// Opening the document merges every reviewer's comments; saving publishes
// only your own.
import { t } from "./i18n.js";
import { modal, esc, baseName } from "./ui.js";
import { tools } from "./platform.js";

// XFDF element name <-> PDF annotation subtype
const ELEMENTS = {
  Text: "text", FreeText: "freetext", Highlight: "highlight", Underline: "underline", StrikeOut: "strikeout",
  Squiggly: "squiggly", Ink: "ink", Square: "square", Circle: "circle", Line: "line",
};
const SUBTYPES = Object.fromEntries(Object.entries(ELEMENTS).map(([k, v]) => [v, k]));
const FLAGS = [[1, "invisible"], [2, "hidden"], [4, "print"], [8, "nozoom"], [16, "norotate"], [32, "noview"], [64, "readonly"], [128, "locked"]];
const XFDF_NS = "http://ns.adobe.com/xfdf/";

const hex = (c) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const unhex = (s) => (/^#[0-9a-f]{6}$/i.test(s || "") ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) : null);
const nums = (s) => (s || "").split(/[\s,;]+/).filter(Boolean).map(Number);

/** XFDF for the comments in `bytes`, optionally only those written by `author`. */
export async function exportXfdf(bytes, { author = null, fileName = "document.pdf" } = {}) {
  const L = globalThis.PDFLib;
  const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const N = (k) => L.PDFName.of(k);
  const txt = (d, k) => d.lookupMaybe(N(k), L.PDFString, L.PDFHexString)?.decodeText() ?? null;
  const arr = (d, k) => d.lookupMaybe(N(k), L.PDFArray)?.asArray().map((x) => (x instanceof L.PDFNumber ? x.asNumber() : x));
  const xml = document.implementation.createDocument(XFDF_NS, "xfdf", null);
  const root = xml.documentElement;
  root.setAttribute("xml:space", "preserve");
  const annotsEl = xml.createElementNS(XFDF_NS, "annots");
  root.append(annotsEl);
  // NM of every annotation, so replies can point at their parent.
  const nmOf = new Map();
  const entries = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(N("Annots"), L.PDFArray);
    for (let i = 0; i < (annots?.size() || 0); i++) {
      const ref = annots.get(i);
      const d = annots.lookupMaybe(i, L.PDFDict);
      if (!d) continue;
      nmOf.set(String(ref), txt(d, "NM"));
      entries.push({ d, pageIndex });
    }
  });
  for (const { d, pageIndex } of entries) {
    const sub = d.get(N("Subtype"))?.decodeText?.() ?? String(d.get(N("Subtype")) || "").slice(1);
    const el = ELEMENTS[sub];
    if (!el) continue;
    const title = txt(d, "T");
    if (author && title !== author) continue;
    const nm = txt(d, "NM");
    if (!nm) continue;
    const e = xml.createElementNS(XFDF_NS, el);
    const set = (k, v) => { if (v != null && v !== "") e.setAttribute(k, v); };
    set("page", pageIndex);
    set("rect", arr(d, "Rect")?.join(","));
    set("name", nm);
    set("title", title);
    set("date", txt(d, "M"));
    set("creationdate", txt(d, "CreationDate"));
    const c = arr(d, "C");
    if (c?.length === 3) set("color", hex(c));
    const ca = d.lookupMaybe(N("CA"), L.PDFNumber)?.asNumber();
    if (ca != null) set("opacity", ca);
    const f = d.lookupMaybe(N("F"), L.PDFNumber)?.asNumber() || 0;
    set("flags", FLAGS.filter(([bit]) => f & bit).map(([, n]) => n).join(","));
    set("subject", txt(d, "Subj"));
    const irt = d.get(N("IRT"));
    if (irt) {
      set("inreplyto", nmOf.get(String(irt)));
      set("replyType", String(d.get(N("RT")) || "") === "/Group" ? "group" : "reply");
    }
    set("state", txt(d, "State"));
    set("statemodel", txt(d, "StateModel"));
    if (sub === "Text") set("icon", String(d.get(N("Name")) || "").slice(1));
    set("coords", arr(d, "QuadPoints")?.join(","));
    const w = d.lookupMaybe(N("BS"), L.PDFDict)?.lookupMaybe(N("W"), L.PDFNumber)?.asNumber();
    set("width", w);
    const line = arr(d, "L");
    if (line?.length === 4) { set("start", `${line[0]},${line[1]}`); set("end", `${line[2]},${line[3]}`); }
    const q = d.lookupMaybe(N("Q"), L.PDFNumber)?.asNumber();
    if (q) set("justification", ["left", "centered", "right"][q]);
    const contents = txt(d, "Contents");
    if (contents) { const ce = xml.createElementNS(XFDF_NS, "contents"); ce.textContent = contents; e.append(ce); }
    const ink = d.lookupMaybe(N("InkList"), L.PDFArray);
    if (ink) {
      const il = xml.createElementNS(XFDF_NS, "inklist");
      for (let i = 0; i < ink.size(); i++) {
        const pts = ink.lookup(i, L.PDFArray).asArray().map((x) => x.asNumber());
        const g = xml.createElementNS(XFDF_NS, "gesture");
        g.textContent = pts.reduce((s, v, j) => s + (j % 2 ? `,${v}` : `${j ? ";" : ""}${v}`), "");
        il.append(g);
      }
      e.append(il);
    }
    const da = d.lookupMaybe(N("DA"), L.PDFString, L.PDFHexString)?.decodeText();
    if (da && sub === "FreeText") { const de = xml.createElementNS(XFDF_NS, "defaultappearance"); de.textContent = da; e.append(de); }
    annotsEl.append(e);
  }
  const fe = xml.createElementNS(XFDF_NS, "f");
  fe.setAttribute("href", fileName);
  root.append(fe);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(xml)}`;
}

/** Annotation specs (see engine/comments.js) from an XFDF document. */
export function parseXfdf(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) return [];
  const annots = [...xml.getElementsByTagName("annots")][0];
  const specs = [];
  for (const e of annots ? [...annots.children] : []) {
    const subtype = SUBTYPES[e.localName];
    if (!subtype) continue;
    const a = (k) => e.getAttribute(k);
    const child = (k) => [...e.children].find((c) => c.localName === k);
    const flags = (a("flags") || "").split(",").reduce((f, n) => f | (FLAGS.find(([, x]) => x === n.trim())?.[0] || 0), 0);
    const spec = {
      subtype, page: Number(a("page") || 0), rect: nums(a("rect")), nm: a("name"), author: a("title"),
      date: a("date"), creation: a("creationdate"), color: unhex(a("color")), opacity: a("opacity") != null ? Number(a("opacity")) : null,
      flags: a("flags") != null ? flags : undefined, subject: a("subject"), state: a("state"), stateModel: a("statemodel"),
      icon: a("icon"), contents: child("contents")?.textContent ?? null,
    };
    if (a("inreplyto")) Object.assign(spec, { irt: { nm: a("inreplyto") }, replyType: a("replyType") === "group" ? "Group" : "R" });
    if (a("coords")) spec.quadPoints = nums(a("coords"));
    if (a("width") != null) spec.width = Number(a("width"));
    if (a("start") && a("end")) spec.vertices = [...nums(a("start")), ...nums(a("end"))];
    if (a("justification")) spec.align = ["left", "centered", "right"].indexOf(a("justification"));
    const ink = child("inklist");
    if (ink) spec.inkList = [...ink.children].map((g) => nums(g.textContent));
    const da = child("defaultappearance");
    if (da) spec.da = da.textContent;
    if (!spec.nm || spec.rect.length !== 4 && !spec.irt) continue;
    specs.push(spec);
  }
  return specs;
}

/** Merge every reviewer's XFDF into the shared document. */
export async function mergeReview(bytes, info) {
  const specs = info.files.flatMap((f) => parseXfdf(f.text));
  if (!specs.length) return bytes;
  // Parents first, so replies can find them.
  specs.sort((a, b) => (a.irt ? 1 : 0) - (b.irt ? 1 : 0));
  const res = await tools.comments({ pdf: bytes, ops: specs.map((spec) => ({ op: "add", spec })) });
  return res.pdf;
}

export const reviewers = (info) => info.files.map((f) => f.name.replace(/\.xfdf$/i, ""));

/** Dialog + folder choice; returns { path, name } of the shared copy, or null. */
export async function startReview(ctx) {
  const res = await modal({
    title: t("review.startTitle"),
    body: `
      <p class="note">${t("review.startNote")}</p>
      <label class="field">${t("review.name")}<input name="title" dir="auto" value="${esc(baseName(ctx.state.name))}"></label>
      <label class="field">${t("review.deadline")}<input name="deadline" type="date"></label>
      <label class="field">${t("review.emails")}<textarea name="emails" rows="2" dir="ltr" placeholder="name@example.com; ..."></textarea></label>
      <p class="note">${t("review.emailsNote")}</p>`,
    actions: [{ label: t("review.pickFolder"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
    validate: (v) => (v.title.trim() ? null : t("review.needName")),
  });
  if (!res) return null;
  const { title, deadline } = res.data;
  const emails = res.data.emails.split(/[\s,;]+/).filter((x) => /@/.test(x));
  const bytes = await ctx.plainBytes();
  if (!bytes) return null;
  const created = await tools.reviewCreate({ title: title.trim(), pdf: bytes, meta: { title: title.trim(), deadline: deadline || null, initiator: ctx.author(), reviewers: emails } });
  if (!created) return null;
  if (emails.length) {
    await ctx.draft({
      to: emails,
      subject: t("review.mailSubject", { title: title.trim() }),
      html: mailHtml([
        t("review.mailHello"),
        t("review.mailBody", { title: esc(title.trim()), name: esc(ctx.author()) }),
        `<b dir="ltr">${esc(created.path)}</b>`,
        deadline ? t("review.mailDeadline", { date: esc(deadline) }) : "",
        t("review.mailHow"),
      ]),
    });
  }
  return created;
}

export const mailHtml = (paras) => `<div dir="${document.documentElement.dir}" style="font-family:Segoe UI,Tahoma,sans-serif;font-size:11pt">${paras.filter(Boolean).map((p) => `<p>${p}</p>`).join("")}<p style="color:#0071B9">— REA PDF</p></div>`;
