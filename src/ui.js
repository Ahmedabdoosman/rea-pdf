// Shared dialog helper built on <dialog>. Resolves to { action, data, el },
// or null when dismissed. `validate(data, action)` may return an error string.
import { t, locale } from "./i18n.js";

export function modal({ title, body, actions, validate, onOpen, wide = false }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = `m-dialog${wide ? " wide" : ""}`;
    d.innerHTML = `<form method="dialog" novalidate>
      <h3>${title}</h3>
      <div class="m-body">${body}</div>
      <p class="m-error" hidden></p>
      <div class="m-actions">${actions
        .map((a) => `<button value="${a.value}" class="${a.primary ? "primary" : a.danger ? "danger-btn" : "ghost"}"${a.formnovalidate ? " formnovalidate" : ""}>${a.label}</button>`)
        .join("")}</div>
    </form>`;
    document.body.append(d);
    const form = d.querySelector("form");
    const err = d.querySelector(".m-error");
    const collect = () => {
      const data = {};
      form.querySelectorAll("[name]").forEach((el) => {
        data[el.name] = el.type === "checkbox" ? el.checked : el.type === "radio" ? (el.checked ? el.value : data[el.name]) : el.value;
      });
      return data;
    };
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; d.close(); d.remove(); resolve(v); };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const action = e.submitter?.value;
      if (!action || action === "cancel") return finish(null);
      const data = collect();
      const msg = validate ? await validate(data, action, d) : null;
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      finish({ action, data, el: d });
    });
    d.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    d.showModal();
    onOpen?.(d);
    d.querySelector("input:not([type=hidden]):not([type=checkbox]), textarea")?.focus();
  });
}

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function baseName(name) {
  return (name || t("doc.untitled")).replace(/\.pdf$/i, "");
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
