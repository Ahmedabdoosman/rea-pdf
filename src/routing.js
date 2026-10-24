// Sequential signing: the initiator lists signers in order and places one
// signature field for each; the routing slip is stored in the document
// before anyone signs. After each signature REA PDF prepares an Outlook
// draft to the next signer (or back to the initiator) — never sent automatically.
import { t } from "./i18n.js";
import { modal, esc, baseName } from "./ui.js";
import { rectPicker } from "./redact.js";
import { addField } from "./forms.js";
import { mailHtml } from "./review.js";

const KEY = "REARouting";

/** Routing slip with each signer's progress, or null. */
export async function readRouting(bytes) {
  const L = globalThis.PDFLib;
  try {
    const doc = await L.PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
    const raw = doc.catalog.lookupMaybe(L.PDFName.of(KEY), L.PDFString, L.PDFHexString)?.decodeText();
    if (!raw) return null;
    const slip = JSON.parse(raw);
    const fields = new Map(doc.getForm().getFields().map((f) => [f.getName(), f]));
    slip.signers = slip.signers.map((s) => ({ ...s, signed: !!fields.get(s.field)?.acroField.dict.get(L.PDFName.of("V")) }));
    slip.done = slip.signers.filter((s) => s.signed).length;
    slip.next = slip.signers.find((s) => !s.signed) || null;
    return slip;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

function parseSigners(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const email = /[^\s<>,;]+@[^\s<>,;]+/.exec(line)?.[0] || "";
    const name = line.replace(email, "").replace(/[<>,;]/g, " ").trim() || email;
    return { name, email };
  });
}

function pickRect(ctx, hint) {
  return new Promise((resolve) => {
    ctx.toast(hint);
    const stop = rectPicker(ctx.container, ctx.pdfViewer, (page, rect) => { cleanup(); resolve({ page, rect }); }, { className: "pick-box sign" });
    const onKey = (e) => { if (e.key === "Escape") { cleanup(); resolve(null); } };
    const cleanup = () => { stop(); window.removeEventListener("keydown", onKey, true); };
    window.addEventListener("keydown", onKey, true);
  });
}

/** Set up a signing order on the open document. */
export async function startRouting(ctx) {
  if (!(await ctx.confirmBreaksSignatures(await ctx.currentBytes(), t("action.routing")))) return;
  const res = await modal({
    title: t("route.title"),
    wide: true,
    body: `
      <p class="note">${t("route.note")}</p>
      <label class="field">${t("route.subject")}<input name="title" dir="auto" value="${esc(baseName(ctx.state.name))}"></label>
      <label class="field">${t("route.signers")}<textarea name="signers" rows="4" dir="auto" placeholder="${t("route.signersPlaceholder")}"></textarea></label>
      <div class="grid2">
        <label class="field">${t("route.initiator")}<input name="me" dir="auto" value="${esc(ctx.author())}"></label>
        <label class="field">${t("route.initiatorEmail")}<input name="meEmail" dir="ltr" type="email"></label>
      </div>
      <label class="field">${t("route.message")}<textarea name="message" rows="2" dir="auto"></textarea></label>`,
    actions: [{ label: t("route.placeFields"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
    validate(v) {
      const list = parseSigners(v.signers);
      if (!list.length) return t("route.needSigners");
      const bad = list.find((s) => !s.email);
      if (bad) return t("route.needEmail", { name: bad.name });
      if (!v.title.trim()) return t("route.needSubject");
      return null;
    },
  });
  if (!res) return;
  const v = res.data;
  const signers = parseSigners(v.signers);
  const places = [];
  for (const [i, s] of signers.entries()) {
    const p = await pickRect(ctx, t("route.placeHint", { name: s.name, i: i + 1, n: signers.length }));
    if (!p) return ctx.toast(t("route.cancelled"));
    places.push(p);
  }
  let ready = null;
  await ctx.busy(t("busy.routing"), async () => {
    const L = globalThis.PDFLib;
    const bytes = await ctx.plainBytes();
    if (!bytes) return;
    const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
    const taken = new Set(doc.getForm().getFields().map((f) => f.getName()));
    const slip = { title: v.title.trim(), message: v.message.trim(), initiator: { name: v.me.trim(), email: v.meEmail.trim() }, created: new Date().toISOString(), signers: [] };
    signers.forEach((s, i) => {
      let field = `Signer${i + 1}`;
      for (let k = 2; taken.has(field); k++) field = `Signer${i + 1}_${k}`;
      taken.add(field);
      addField(doc, places[i].page - 1, places[i].rect, "signature", { name: field, tooltip: s.name, required: true });
      slip.signers.push({ ...s, field });
    });
    doc.catalog.set(L.PDFName.of(KEY), L.PDFHexString.fromText(JSON.stringify(slip)));
    const out = await doc.save({ updateFieldAppearances: false, useObjectStreams: false });
    const saved = await ctx.platform.saveAs(`${baseName(ctx.state.name)} - ${t("suffix.forSignature")}.pdf`, out);
    if (!saved) return;
    await ctx.openBytes(out, { name: saved.name, path: saved.path });
    ctx.toast(t("route.ready"));
    const list = slip.signers.map((s) => ({ ...s, signed: false }));
    ready = { slip: { ...slip, signers: list, done: 0, next: list[0] }, path: saved.path };
  });
  if (ready) await offerDraft(ctx, ready.slip, ready.path);
}

/** Ask, then prepare an Outlook draft to whoever is next (or the initiator when complete). */
export async function offerDraft(ctx, slip, filePath) {
  if (!filePath) return ctx.toast(t("route.saveFirst"), true);
  const complete = !slip.next;
  const to = complete ? slip.initiator : slip.next;
  if (!to?.email) return complete ? ctx.toast(t("route.completeNoEmail")) : null;
  const ok = await modal({
    title: t(complete ? "route.draftDoneTitle" : "route.draftTitle"),
    body: `<p>${t(complete ? "route.draftDoneBody" : "route.draftBody", { name: esc(to.name), email: esc(to.email) })}</p><p class="note">${t("route.draftNote")}</p>`,
    actions: [{ label: t("route.createDraft"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
  });
  if (!ok) return;
  const step = slip.signers.indexOf(slip.next) + 1;
  const html = complete
    ? mailHtml([t("route.mailHello", { name: esc(to.name) }), t("route.mailDone", { title: esc(slip.title), n: slip.signers.length }),
      slip.signers.map((s) => `✔ ${esc(s.name)}`).join("<br>")])
    : mailHtml([t("route.mailHello", { name: esc(to.name) }), t("route.mailBody", { title: esc(slip.title), step, n: slip.signers.length }),
      slip.message ? `<i>${esc(slip.message)}</i>` : "", t("route.mailHow"),
      slip.signers.map((s) => `${s.signed ? "✔" : s === slip.next ? "➜" : "○"} ${esc(s.name)}`).join("<br>")]);
  await ctx.draft({
    to: [to.email],
    cc: complete ? [] : [slip.initiator?.email].filter(Boolean),
    subject: t(complete ? "route.doneSubject" : "route.mailSubject", { title: slip.title }),
    html,
    attachments: [filePath],
  });
}

export function showRouting(slip) {
  return modal({
    title: t("route.detailsTitle", { title: esc(slip.title) }),
    body: `<ol class="route-list">${slip.signers.map((s) => `<li class="${s.signed ? "done" : s === slip.next ? "next" : ""}">
      <b dir="auto">${esc(s.name)}</b> <span dir="ltr">${esc(s.email)}</span>
      <span class="route-state">${t(s.signed ? "route.signed" : s === slip.next ? "route.turn" : "route.waiting")}</span></li>`).join("")}</ol>
      <p class="note">${t("route.initiatorLine", { name: esc(slip.initiator?.name || ""), email: esc(slip.initiator?.email || "") })}</p>`,
    actions: [{ label: t("common.close"), value: "cancel" }],
  });
}
