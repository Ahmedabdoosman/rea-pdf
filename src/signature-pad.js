// Handwritten signatures: draw, type (calligraphy fonts) or upload; saved locally for reuse.
import { modal } from "./ui.js";
import { t } from "./i18n.js";

const KEY = "midad.signatures";
const INK = ["#0B2A6F", "#13212E", "#0071B9"];
const FONTS = [
  { id: "ruqaa", label: "font.ruqaa", css: '"Aref Ruqaa", serif', weight: 700 },
  { id: "kufi", label: "font.kufi", css: '"Reem Kufi", sans-serif', weight: 600 },
  { id: "script", label: "font.script", css: '"Dancing Script", cursive', weight: 700 },
];

export function savedSignatures() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function storeSignatures(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))); } catch {}
}
export function deleteSignature(id) {
  storeSignatures(savedSignatures().filter((s) => s.id !== id));
}

export async function dataUrlToFile(url, name = "signature.png") {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

// Crop to the inked area and return a transparent PNG data URL.
function trimmed(canvas, pad = 12) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

function wireDrawPad(canvas, getColor) {
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / canvas.clientWidth;
  let last = null;
  let lastW = 3;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale, t: performance.now() }; };
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); last = pos(e); canvas.dataset.dirty = "1"; });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    const p = pos(e);
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    const v = dist / Math.max(p.t - last.t, 1);
    const width = Math.max(1.6, Math.min(5.5, 6 - v * 1.6)) * scale * 0.6; // faster strokes are thinner
    lastW = lastW * 0.6 + width * 0.4;
    ctx.strokeStyle = getColor();
    ctx.lineWidth = lastW;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  const end = () => { last = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

async function renderTyped(text, font, color) {
  await document.fonts.load(`${font.weight} 80px ${font.css}`, text).catch(() => {});
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 300;
  const ctx = c.getContext("2d");
  ctx.font = `${font.weight} 120px ${font.css}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
  let size = 120;
  while (ctx.measureText(text).width > 1120 && size > 30) { size -= 6; ctx.font = `${font.weight} ${size}px ${font.css}`; }
  ctx.fillText(text, 600, 155);
  return c;
}

/** Opens the signature dialog. Resolves to a PNG File, or null if cancelled. */
export async function createSignature() {
  let color = INK[0];
  let tab = "draw";
  let uploaded = null;
  const res = await modal({
    title: t("hand.title"),
    wide: true,
    body: `
      <div class="seg" role="tablist">
        <button type="button" data-tab="draw" class="on">${t("hand.draw")}</button>
        <button type="button" data-tab="type">${t("hand.type")}</button>
        <button type="button" data-tab="image">${t("hand.image")}</button>
      </div>
      <div class="sig-pane" data-pane="draw">
        <canvas class="sig-canvas" width="1200" height="360"></canvas>
        <div class="sig-row"><span class="muted">${t("hand.drawHint")}</span><button type="button" class="ghost small" data-clear>${t("hand.clear")}</button></div>
      </div>
      <div class="sig-pane" data-pane="type" hidden>
        <input name="typed" type="text" placeholder="${t("hand.typePlaceholder")}" autocomplete="off">
        <div class="font-pick">${FONTS.map((f, i) => `<label><input type="radio" name="font" value="${f.id}"${i ? "" : " checked"}><span style="font-family:${f.css};font-weight:${f.weight}" data-sample>${t(f.label)}</span></label>`).join("")}</div>
      </div>
      <div class="sig-pane" data-pane="image" hidden>
        <label class="file-drop"><input type="file" accept="image/png,image/jpeg" hidden data-upload><span>${t("hand.pickImage")}</span></label>
        <img class="sig-preview" alt="" hidden>
      </div>
      <div class="sig-row">
        <span class="ink">${INK.map((c, i) => `<button type="button" class="swatch${i ? "" : " on"}" style="background:${c}" data-ink="${c}"></button>`).join("")}</span>
        <label class="check"><input type="checkbox" name="save" checked> ${t("hand.save")}</label>
      </div>`,
    actions: [{ label: t("hand.insert"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
    onOpen(d) {
      const canvas = d.querySelector(".sig-canvas");
      wireDrawPad(canvas, () => color);
      d.querySelector("[data-clear]").onclick = () => { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); delete canvas.dataset.dirty; };
      d.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
        tab = b.dataset.tab;
        d.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
        d.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
        if (tab === "type") d.querySelector("[name=typed]").focus();
      }));
      d.querySelectorAll("[data-ink]").forEach((b) => (b.onclick = () => {
        color = b.dataset.ink;
        d.querySelectorAll("[data-ink]").forEach((x) => x.classList.toggle("on", x === b));
        d.querySelectorAll("[data-sample]").forEach((s) => (s.style.color = color));
      }));
      d.querySelector("[name=typed]").addEventListener("input", (e) => {
        d.querySelectorAll("[data-sample]").forEach((s, i) => (s.textContent = e.target.value || t(FONTS[i].label)));
      });
      d.querySelector("[data-upload]").addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        uploaded = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
        const img = d.querySelector(".sig-preview");
        img.src = uploaded; img.hidden = false;
      });
    },
    async validate(data, _a, d) {
      if (tab === "draw" && !d.querySelector(".sig-canvas").dataset.dirty) return t("hand.needDraw");
      if (tab === "type" && !data.typed.trim()) return t("hand.needType");
      if (tab === "image" && !uploaded) return t("hand.needImage");
      return null;
    },
  });
  if (!res) return null;

  let url;
  if (tab === "draw") url = trimmed(res.el.querySelector(".sig-canvas"));
  if (tab === "type") url = trimmed(await renderTyped(res.data.typed.trim(), FONTS.find((f) => f.id === res.data.font) || FONTS[0], color));
  if (tab === "image") url = uploaded;
  if (!url) return null;
  if (res.data.save) storeSignatures([{ id: `sig${Date.now()}`, url }, ...savedSignatures()]);
  return dataUrlToFile(url);
}
