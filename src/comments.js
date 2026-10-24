// Comments panel: every markup annotation as a thread with replies and a
// review status, plus the sticky-note tool. Changes go through the main
// process as incremental updates, so signatures stay valid.
import { t } from "./i18n.js";
import { modal, esc, formatDate } from "./ui.js";
import { tools } from "./platform.js";

const MARKUP = new Set(["Text", "FreeText", "Highlight", "Underline", "StrikeOut", "Squiggly", "Ink", "Stamp",
  "Square", "Circle", "Line", "Polygon", "PolyLine", "Caret", "FileAttachment"]);
export const STATES = ["None", "Accepted", "Rejected", "Cancelled", "Completed"];
const NOTE_COLOR = [1, 0.85, 0.25];

const pdfDate = (s) => {
  if (!s) return null;
  const d = globalThis.pdfjsLib.PDFDateString.toDateObject(s);
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const typeLabel = (sub) => t(`cm.type.${sub}`) === `cm.type.${sub}` ? sub : t(`cm.type.${sub}`);

export class Comments {
  /** ctx: { container, pdfViewer, state, plainBytes, openBytes, busy, toast, pane, onCount } */
  constructor(ctx) {
    this.ctx = ctx;
    this.threads = [];
    this.filter = "all";
    this.author = "";
    this.stopNote = null;
  }

  // ---------- data ----------
  async refresh() {
    const pdf = this.ctx.state.pdf;
    if (!pdf) return;
    const all = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const annots = await (await pdf.getPage(n)).getAnnotations({ intent: "any" }).catch(() => []);
      for (const a of annots) if (MARKUP.has(a.subtype)) all.push({ ...a, pageNumber: n });
    }
    if (pdf !== this.ctx.state.pdf) return;
    const byId = new Map(all.map((a) => [a.id, a]));
    const top = all.filter((a) => !a.inReplyTo || !byId.has(a.inReplyTo) || a.replyType === "Group");
    const date = (a) => pdfDate(a.modificationDate) || pdfDate(a.creationDate);
    this.threads = top.map((a) => {
      const children = all.filter((c) => c.inReplyTo === a.id && c.replyType !== "Group");
      const statuses = children.filter((c) => c.state && (c.stateModel || "Review") === "Review").sort((x, y) => (date(x) || 0) - (date(y) || 0));
      return {
        a,
        replies: children.filter((c) => !c.state).sort((x, y) => (date(x) || 0) - (date(y) || 0)),
        status: statuses.at(-1)?.state || "None",
        statusBy: statuses.at(-1)?.titleObj?.str || "",
        date: date(a),
      };
    });
    this.ctx.onCount?.(this.threads.length);
    this.render();
  }

  // ---------- operations ----------
  async apply(ops, { reopen = true } = {}) {
    const { ctx } = this;
    return ctx.busy(t("busy.comments"), async () => {
      const bytes = await ctx.plainBytes();
      if (!bytes) return null;
      const res = await tools.comments({ pdf: bytes, ops });
      if (reopen) {
        const top = ctx.container.scrollTop;
        await ctx.openBytes(res.pdf, { name: ctx.state.name, path: ctx.state.path, dirty: true, page: ctx.pdfViewer.currentPageNumber });
        ctx.container.scrollTop = top;
      }
      return res;
    });
  }

  startNote() {
    this.cancelNote();
    const { container, pdfViewer, toast } = this.ctx;
    toast(t("cm.noteHint"));
    container.classList.add("picking");
    const click = (e) => {
      const pageDiv = e.target.closest?.(".page");
      if (!pageDiv) return;
      e.preventDefault();
      e.stopPropagation();
      this.cancelNote();
      const n = Number(pageDiv.dataset.pageNumber);
      const r = pageDiv.getBoundingClientRect();
      const [x, y] = pdfViewer.getPageView(n - 1).viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
      this.#newNote(n, [x, y - 22, x + 22, y]);
    };
    const key = (e) => { if (e.key === "Escape") this.cancelNote(); };
    container.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    this.stopNote = () => { container.removeEventListener("click", click, true); window.removeEventListener("keydown", key, true); container.classList.remove("picking"); };
  }

  cancelNote() {
    this.stopNote?.();
    this.stopNote = null;
  }

  async #newNote(pageNumber, rect) {
    const text = await this.#ask(t("cm.newNote"), "");
    if (text == null) return;
    await this.apply([{ op: "add", spec: { subtype: "Text", page: pageNumber - 1, rect, contents: text, author: this.author, color: NOTE_COLOR, icon: "Comment" } }]);
    this.ctx.onShow?.();
  }

  #ask(title, value) {
    return modal({
      title,
      body: `<textarea name="text" rows="5" dir="auto">${esc(value)}</textarea>`,
      actions: [{ label: t("common.save"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
      validate: (v) => (v.text.trim() ? null : t("cm.needText")),
    }).then((r) => (r ? r.data.text.trim() : null));
  }

  reply(id, text) {
    return this.apply([{ op: "add", spec: { subtype: "Text", irt: id, contents: text, author: this.author } }]);
  }

  setStatus(id, state) {
    const label = t(`cm.state.${state}`);
    return this.apply([{ op: "add", spec: { subtype: "Text", irt: id, state, stateModel: "Review", author: this.author, contents: t("cm.statusSetBy", { state: label, name: this.author }) } }]);
  }

  async edit(id) {
    const th = this.threads.find((x) => x.a.id === id) || this.threads.flatMap((x) => x.replies).map((a) => ({ a })).find((x) => x.a.id === id);
    const text = await this.#ask(t("cm.edit"), th?.a.contentsObj?.str || "");
    if (text == null) return;
    await this.apply([{ op: "update", id, contents: text }]);
  }

  async remove(id) {
    const ok = await modal({
      title: t("cm.deleteTitle"),
      body: `<p>${t("cm.deleteBody")}</p>`,
      actions: [{ label: t("common.delete"), value: "ok", danger: true }, { label: t("common.cancel"), value: "cancel" }],
    });
    if (ok) await this.apply([{ op: "delete", id }]);
  }

  goTo(th) {
    const { pdfViewer } = this.ctx;
    const r = th.a.rect;
    pdfViewer.scrollPageIntoView({ pageNumber: th.a.pageNumber, destArray: [null, { name: "XYZ" }, r[0] - 40, r[3] + 60, null] });
  }

  // ---------- panel ----------
  render() {
    const pane = this.ctx.pane;
    if (!pane) return;
    const mine = (a) => (a.titleObj?.str || "") === this.author;
    const list = this.threads.filter((th) => this.filter === "all" || (this.filter === "open" ? th.status === "None" : th.status === this.filter));
    const byPage = new Map();
    for (const th of list) byPage.set(th.a.pageNumber, [...(byPage.get(th.a.pageNumber) || []), th]);
    const when = (a) => { const d = pdfDate(a.modificationDate) || pdfDate(a.creationDate); return d ? formatDate(d.toISOString()) : ""; };
    const actions = (a) => (mine(a) ? `<button type="button" data-act="edit" data-id="${a.id}" title="${t("cm.edit")}">✎</button><button type="button" data-act="del" data-id="${a.id}" title="${t("common.delete")}">🗑</button>` : "");
    pane.innerHTML = `
      <div class="cm-top">
        <button type="button" class="cm-me" data-act="me" title="${t("cm.changeName")}">👤 ${esc(this.author)}</button>
        <select data-act="filter">
          ${["all", "open", ...STATES.slice(1)].map((f) => `<option value="${f}"${this.filter === f ? " selected" : ""}>${t(`cm.filter.${f}`)}</option>`).join("")}
        </select>
      </div>
      ${list.length ? "" : `<p class="cm-empty">${t(this.threads.length ? "cm.noneFiltered" : "cm.none")}</p>`}
      ${[...byPage].map(([n, ths]) => `
        <div class="cm-page">${t("cm.page", { n })}</div>
        ${ths.map((th) => `
          <div class="cm-card" data-id="${th.a.id}">
            <div class="cm-head">
              <span class="cm-type">${esc(typeLabel(th.a.subtype))}</span>
              <b dir="auto">${esc(th.a.titleObj?.str || t("cm.anonymous"))}</b>
              <span class="cm-tools">${actions(th.a)}</span>
            </div>
            <div class="cm-meta"><time>${when(th.a)}</time>
              ${th.status !== "None" ? `<span class="cm-status s-${th.status.toLowerCase()}" title="${esc(th.statusBy)}">${t(`cm.state.${th.status}`)}</span>` : ""}</div>
            ${th.a.contentsObj?.str ? `<div class="cm-body" dir="auto">${esc(th.a.contentsObj.str)}</div>` : ""}
            ${th.replies.map((r) => `
              <div class="cm-reply-item">
                <div class="cm-head"><b dir="auto">${esc(r.titleObj?.str || t("cm.anonymous"))}</b><time>${when(r)}</time><span class="cm-tools">${actions(r)}</span></div>
                <div class="cm-body" dir="auto">${esc(r.contentsObj?.str || "")}</div>
              </div>`).join("")}
            <div class="cm-foot">
              <textarea rows="1" dir="auto" placeholder="${t("cm.replyPlaceholder")}"></textarea>
              <button type="button" class="primary small" data-act="reply" data-id="${th.a.id}">${t("cm.reply")}</button>
              <select data-act="status" data-id="${th.a.id}" title="${t("cm.setStatus")}">
                <option value="" selected disabled>${t("cm.setStatus")}</option>
                ${STATES.map((s) => `<option value="${s}">${t(`cm.state.${s}`)}</option>`).join("")}
              </select>
            </div>
          </div>`).join("")}`).join("")}`;
    this.#wire(pane);
  }

  #wire(pane) {
    pane.querySelector("[data-act=filter]").onchange = (e) => { this.filter = e.target.value; this.render(); };
    pane.querySelector("[data-act=me]").onclick = () => this.ctx.changeName?.();
    pane.querySelectorAll(".cm-card").forEach((card) => {
      const th = this.threads.find((x) => x.a.id === card.dataset.id);
      card.addEventListener("click", (e) => { if (!e.target.closest("button, textarea, select")) this.goTo(th); });
    });
    pane.querySelectorAll("[data-act=reply]").forEach((b) => (b.onclick = () => {
      const text = b.parentElement.querySelector("textarea").value.trim();
      if (text) this.reply(b.dataset.id, text);
    }));
    pane.querySelectorAll("[data-act=status]").forEach((s) => (s.onchange = () => this.setStatus(s.dataset.id, s.value)));
    pane.querySelectorAll("[data-act=edit]").forEach((b) => (b.onclick = () => this.edit(b.dataset.id)));
    pane.querySelectorAll("[data-act=del]").forEach((b) => (b.onclick = () => this.remove(b.dataset.id)));
  }
}
