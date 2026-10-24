// Arabic and English strings for the pdf.js viewer/editor UI, implementing the
// viewer's IL10n interface without Fluent; follows the interface language.
import { getLang, isRtl, onLangChange } from "./i18n.js";

// Entries: string = text, or { text, title, aria }.
const AR = {
  "pdfjs-editor-alt-text-button": { aria: "نص بديل" },
  "pdfjs-editor-alt-text-button-label": "نص بديل",
  "pdfjs-editor-alt-text-edit-button": { aria: "تعديل وصف النص البديل" },
  "pdfjs-editor-alt-text-edit-button-label": "تعديل وصف النص البديل",
  "pdfjs-editor-alt-text-dialog-label": "اختر خياراً",
  "pdfjs-editor-alt-text-dialog-description": "يساعد النص البديل من لا يستطيعون رؤية الصورة.",
  "pdfjs-editor-alt-text-add-description-label": "أضف وصفاً",
  "pdfjs-editor-alt-text-add-description-description": "اكتب جملة أو جملتين تصفان الموضوع أو المحتوى.",
  "pdfjs-editor-alt-text-mark-decorative-label": "تعليم كصورة زخرفية",
  "pdfjs-editor-alt-text-mark-decorative-description": "تُستخدم للصور الزخرفية مثل الحدود والعلامات المائية.",
  "pdfjs-editor-alt-text-cancel-button": "إلغاء",
  "pdfjs-editor-alt-text-save-button": "حفظ",
  "pdfjs-editor-alt-text-decorative-tooltip": "معلَّمة كزخرفية",
  "pdfjs-editor-alt-text-textarea": { aria: "النص البديل" },
  "pdfjs-editor-new-alt-text-missing-button-label": "نص بديل مفقود",
  "pdfjs-editor-new-alt-text-added-button-label": "تمت إضافة نص بديل",
  "pdfjs-editor-new-alt-text-to-review-button-label": "راجع النص البديل",
  "pdfjs-editor-remove-ink-button": { title: "حذف الرسم" },
  "pdfjs-editor-remove-freetext-button": { title: "حذف النص" },
  "pdfjs-editor-remove-stamp-button": { title: "حذف الصورة" },
  "pdfjs-editor-remove-highlight-button": { title: "حذف التظليل" },
  "pdfjs-editor-colorpicker-button": { title: "تغيير اللون" },
  "pdfjs-editor-colorpicker-dropdown": { aria: "خيارات الألوان" },
  "pdfjs-editor-colorpicker-yellow": { title: "أصفر" },
  "pdfjs-editor-colorpicker-green": { title: "أخضر" },
  "pdfjs-editor-colorpicker-blue": { title: "أزرق" },
  "pdfjs-editor-colorpicker-pink": { title: "وردي" },
  "pdfjs-editor-colorpicker-red": { title: "أحمر" },
  "pdfjs-editor-highlight-colorpicker-label": "لون التظليل",
  "pdfjs-editor-resizer-top-left": { aria: "الزاوية العلوية اليسرى — تغيير الحجم" },
  "pdfjs-editor-resizer-top-middle": { aria: "المنتصف العلوي — تغيير الحجم" },
  "pdfjs-editor-resizer-top-right": { aria: "الزاوية العلوية اليمنى — تغيير الحجم" },
  "pdfjs-editor-resizer-middle-right": { aria: "المنتصف الأيمن — تغيير الحجم" },
  "pdfjs-editor-resizer-bottom-right": { aria: "الزاوية السفلية اليمنى — تغيير الحجم" },
  "pdfjs-editor-resizer-bottom-middle": { aria: "المنتصف السفلي — تغيير الحجم" },
  "pdfjs-editor-resizer-bottom-left": { aria: "الزاوية السفلية اليسرى — تغيير الحجم" },
  "pdfjs-editor-resizer-middle-left": { aria: "المنتصف الأيسر — تغيير الحجم" },
  "pdfjs-free-text2": { aria: "محرر النص" },
  "pdfjs-free-text-default-content": "اكتب هنا…",
  "pdfjs-ink": { aria: "محرر الرسم" },
  "pdfjs-ink-canvas": { aria: "صورة أنشأها المستخدم" },
  "pdfjs-highlight-floating-button1": { title: "تظليل", aria: "تظليل" },
  "pdfjs-highlight-floating-button-label": "تظليل",
};

const EN = {
  "pdfjs-editor-alt-text-button": { aria: "Alt text" },
  "pdfjs-editor-alt-text-button-label": "Alt text",
  "pdfjs-editor-alt-text-edit-button": { aria: "Edit alt text description" },
  "pdfjs-editor-alt-text-edit-button-label": "Edit alt text description",
  "pdfjs-editor-alt-text-dialog-label": "Choose an option",
  "pdfjs-editor-alt-text-dialog-description": "Alt text helps when people can’t see the image.",
  "pdfjs-editor-alt-text-add-description-label": "Add a description",
  "pdfjs-editor-alt-text-add-description-description": "Aim for 1-2 sentences that describe the subject, setting, or actions.",
  "pdfjs-editor-alt-text-mark-decorative-label": "Mark as decorative",
  "pdfjs-editor-alt-text-mark-decorative-description": "This is used for ornamental images, like borders or watermarks.",
  "pdfjs-editor-alt-text-cancel-button": "Cancel",
  "pdfjs-editor-alt-text-save-button": "Save",
  "pdfjs-editor-alt-text-decorative-tooltip": "Marked as decorative",
  "pdfjs-editor-alt-text-textarea": { aria: "Alt text" },
  "pdfjs-editor-new-alt-text-missing-button-label": "Missing alt text",
  "pdfjs-editor-new-alt-text-added-button-label": "Alt text added",
  "pdfjs-editor-new-alt-text-to-review-button-label": "Review alt text",
  "pdfjs-editor-remove-ink-button": { title: "Remove drawing" },
  "pdfjs-editor-remove-freetext-button": { title: "Remove text" },
  "pdfjs-editor-remove-stamp-button": { title: "Remove image" },
  "pdfjs-editor-remove-highlight-button": { title: "Remove highlight" },
  "pdfjs-editor-colorpicker-button": { title: "Change color" },
  "pdfjs-editor-colorpicker-dropdown": { aria: "Color choices" },
  "pdfjs-editor-colorpicker-yellow": { title: "Yellow" },
  "pdfjs-editor-colorpicker-green": { title: "Green" },
  "pdfjs-editor-colorpicker-blue": { title: "Blue" },
  "pdfjs-editor-colorpicker-pink": { title: "Pink" },
  "pdfjs-editor-colorpicker-red": { title: "Red" },
  "pdfjs-editor-highlight-colorpicker-label": "Highlight color",
  "pdfjs-editor-resizer-top-left": { aria: "Top left corner — resize" },
  "pdfjs-editor-resizer-top-middle": { aria: "Top middle — resize" },
  "pdfjs-editor-resizer-top-right": { aria: "Top right corner — resize" },
  "pdfjs-editor-resizer-middle-right": { aria: "Middle right — resize" },
  "pdfjs-editor-resizer-bottom-right": { aria: "Bottom right corner — resize" },
  "pdfjs-editor-resizer-bottom-middle": { aria: "Bottom middle — resize" },
  "pdfjs-editor-resizer-bottom-left": { aria: "Bottom left corner — resize" },
  "pdfjs-editor-resizer-middle-left": { aria: "Middle left — resize" },
  "pdfjs-free-text2": { aria: "Text editor" },
  "pdfjs-free-text-default-content": "Start typing…",
  "pdfjs-ink": { aria: "Draw editor" },
  "pdfjs-ink-canvas": { aria: "User-created image" },
  "pdfjs-highlight-floating-button1": { title: "Highlight", aria: "Highlight" },
  "pdfjs-highlight-floating-button-label": "Highlight",
};
const dict = () => (getLang() === "en" ? EN : AR);
const text = (e) => (typeof e === "string" ? e : e?.text);

function apply(el) {
  const entry = dict()[el.getAttribute("data-l10n-id")];
  if (!entry) return;
  if (typeof entry === "string") { el.textContent = entry; return; }
  if (entry.text) el.textContent = entry.text;
  if (entry.title) el.title = entry.title;
  if (entry.aria) el.setAttribute("aria-label", entry.aria);
}

function applyTree(root) {
  if (root.nodeType !== 1) return;
  if (root.hasAttribute("data-l10n-id")) apply(root);
  root.querySelectorAll("[data-l10n-id]").forEach(apply);
}

export class ViewerL10n {
  #observers = [];
  #roots = new Set();
  constructor() {
    onLangChange(() => this.#roots.forEach(applyTree));
  }
  getLanguage() { return getLang(); }
  getDirection() { return isRtl() ? "rtl" : "ltr"; }
  async get(ids, args = null, fallback) {
    if (Array.isArray(ids)) return ids.map((id) => text(dict()[id]) ?? "");
    return text(dict()[ids]) ?? fallback ?? "";
  }
  async translate(element) {
    this.#roots.add(element);
    applyTree(element);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") apply(r.target);
        else r.addedNodes.forEach(applyTree);
      }
    });
    mo.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-l10n-id"] });
    this.#observers.push(mo);
  }
  async translateOnce(element) { applyTree(element); }
  async destroy() { this.#observers.forEach((o) => o.disconnect()); this.#observers = []; }
  pause() {}
  resume() {}
}
