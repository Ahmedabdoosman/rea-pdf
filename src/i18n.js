// Interface language: Arabic (RTL) or English (LTR). Strings live in
// locales/ar.json and locales/en.json, shared with the main process.
const load = async (l) => (await fetch(new URL(`./locales/${l}.json`, import.meta.url))).json();
const dicts = { ar: await load("ar"), en: await load("en") };

const KEY = "rea.lang";
let lang = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
if (!dicts[lang]) lang = "ar";
const listeners = new Set();

export const getLang = () => lang;
export const isRtl = () => lang === "ar";
/** Locale for dates/numbers: Gregorian calendar and Latin digits in both languages. */
export const locale = () => (lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB");

/** Translate `key`, filling {placeholders} from `vars`. Falls back to Arabic, then the key. */
export function t(key, vars) {
  let s = dicts[lang][key] ?? dicts.ar[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

/** Translate elements marked with data-i18n / -title / -placeholder / -aria. */
export function applyDom(root = document) {
  if (root === document) {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  }
  root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
}

export function setLang(next) {
  if (!dicts[next] || next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, lang); } catch {}
  applyDom();
  globalThis.midad?.setLang?.(lang); // main-process dialogs and messages
  listeners.forEach((fn) => fn(lang));
}

/** Re-render dynamic UI when the language changes. */
export const onLangChange = (fn) => listeners.add(fn);

globalThis.midad?.setLang?.(lang);
