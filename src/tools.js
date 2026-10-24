// Document tools: OCR (searchable text layer), compression, conversion to
// Word/text/images, images to PDF, and Arabic text-box appearances.
import { tools } from "./platform.js";
import { modal, baseName } from "./ui.js";
import { t } from "./i18n.js";

const AR = /[؀-ۿ]/;
const canvasBytes = async (canvas, type = "image/png", quality) =>
  new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, type, quality))).arrayBuffer());

async function renderPage(page, dpi, { background = "#fff" } = {}) {
  const vp = page.getViewport({ scale: dpi / 72 });
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
  const g = canvas.getContext("2d");
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
  return canvas;
}

/** A copy of `canvas` turned clockwise by 90, 180 or 270 degrees. */
function rotated(canvas, deg) {
  const side = deg === 90 || deg === 270;
  const c = Object.assign(document.createElement("canvas"), { width: side ? canvas.height : canvas.width, height: side ? canvas.width : canvas.height });
  const g = c.getContext("2d");
  g.translate(c.width / 2, c.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

const pageChars = async (page) => (await page.getTextContent()).items.reduce((n, i) => n + (i.str || "").trim().length, 0);

// ---------- OCR ----------

/**
 * Recognize text on scanned pages and lay it invisibly over each page, so the
 * document becomes searchable and copyable. Returns the new bytes (or null).
 */
export async function ocrDocument(ctx, { all = false, dpi = 300 } = {}) {
  const bytes = await ctx.plainBytes();
  if (!bytes) return null;
  const { PDFDocument, degrees } = globalThis.PDFLib;
  const src = await ctx.loadPdf(bytes.slice());
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  const targets = [];
  for (let n = 1; n <= src.numPages; n++) {
    if (all || (await pageChars(await src.getPage(n))) < 25) targets.push(n);
  }
  if (!targets.length) {
    await src.destroy();
    ctx.toast(t("ocr.allHaveText"));
    return null;
  }
  let recognized = 0, confidence = 0;
  for (const [i, n] of targets.entries()) {
    ctx.progress(t("ocr.progress", { i: i + 1, n: targets.length }));
    const canvas = await renderPage(await src.getPage(n), dpi);
    // Sideways or upside-down scans read poorly; retry other orientations and keep the best.
    let best = null;
    for (const turn of [0, 90, 270, 180]) {
      if (turn) ctx.progress(t("ocr.progressTurn", { i: i + 1, n: targets.length }));
      const r = await tools.ocrPage({ png: await canvasBytes(turn ? rotated(canvas, turn) : canvas), dpi });
      if (r.text.trim() && (!best || r.confidence > best.confidence)) best = { ...r, turn };
      if (best && best.confidence >= 70) break;
    }
    if (!best) continue;
    const r = best;
    const [layer] = await out.embedPdf(r.pdf, [0]);
    const page = out.getPage(n - 1);
    const c = page.getCropBox();
    // The layer is upright in the image we OCR'd: page /Rotate plus our extra turn.
    const rot = ((page.getRotation().angle + r.turn) % 360 + 360) % 360;
    // The OCR layer is in the page's visual orientation; undo /Rotate when placing it.
    const sideways = rot === 90 || rot === 270;
    const w = sideways ? c.height : c.width, h = sideways ? c.width : c.height;
    const at = { 0: [c.x, c.y], 90: [c.x + c.width, c.y], 180: [c.x + c.width, c.y + c.height], 270: [c.x, c.y + c.height] }[rot] || [c.x, c.y];
    page.drawPage(layer, { x: at[0], y: at[1], width: w, height: h, rotate: degrees(rot) });
    recognized++;
    confidence += r.confidence;
  }
  await src.destroy();
  if (!recognized) { ctx.toast(t("ocr.noneFound"), true); return null; }
  ctx.lastOcr = { pages: recognized, confidence: Math.round(confidence / recognized) };
  return out.save();
}

// ---------- compression ----------

export const COMPRESSION = {
  low: { maxDim: 3000, quality: 0.85 },
  medium: { maxDim: 2000, quality: 0.72 },
  high: { maxDim: 1300, quality: 0.55 },
};

/** Re-encode large images (JPEG and 8-bit RGB/Gray Flate) and pack objects. */
export async function compressDocument(ctx, level = "medium") {
  const preset = COMPRESSION[level];
  const bytes = await ctx.plainBytes();
  if (!bytes) return null;
  const L = globalThis.PDFLib;
  const out = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const name = (d, k) => d.get(L.PDFName.of(k))?.toString();
  const num = (d, k) => d.lookupMaybe(L.PDFName.of(k), L.PDFNumber)?.asNumber();
  let images = 0;
  const all = out.context.enumerateIndirectObjects();
  for (const [i, [ref, obj]] of all.entries()) {
    if (!(obj instanceof L.PDFRawStream) || name(obj.dict, "Subtype") !== "/Image") continue;
    if (i % 20 === 0) ctx.progress(t("compress.progress", { pct: Math.round((i / all.length) * 100) }));
    const d = obj.dict;
    if (name(d, "ImageMask") === "true" || d.has(L.PDFName.of("Mask")) || d.has(L.PDFName.of("Decode"))) continue;
    if (num(d, "BitsPerComponent") !== 8) continue;
    const w = num(d, "Width"), h = num(d, "Height");
    if (!w || !h || Math.max(w, h) < 500) continue;
    let comps = 0;
    const cs = d.lookup(L.PDFName.of("ColorSpace"));
    if (cs instanceof L.PDFName) comps = { "/DeviceRGB": 3, "/DeviceGray": 1 }[cs.toString()] || 0;
    else if (cs instanceof L.PDFArray && cs.lookup(0).toString() === "/ICCBased") {
      const n = cs.lookup(1)?.dict?.lookupMaybe(L.PDFName.of("N"), L.PDFNumber)?.asNumber();
      comps = n === 1 || n === 3 ? n : 0;
    }
    if (!comps) continue;
    const filter = d.lookup(L.PDFName.of("Filter"));
    const f = filter instanceof L.PDFArray ? (filter.size() === 1 ? filter.lookup(0).toString() : "") : filter?.toString();

    let bitmap;
    try {
      if (f === "/DCTDecode") {
        bitmap = await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" }));
      } else if (f === "/FlateDecode") {
        const raw = L.decodePDFRawStream(obj).decode();
        if (raw.length < w * h * comps) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let p = 0, q = 0; p < w * h; p++, q += comps) {
          rgba[p * 4] = raw[q]; rgba[p * 4 + 1] = raw[q + (comps === 3 ? 1 : 0)]; rgba[p * 4 + 2] = raw[q + (comps === 3 ? 2 : 0)]; rgba[p * 4 + 3] = 255;
        }
        bitmap = await createImageBitmap(new ImageData(rgba, w, h));
      } else continue;
    } catch { continue; }

    const s = Math.min(1, preset.maxDim / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    const canvas = new OffscreenCanvas(nw, nh);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, nw, nh);
    g.drawImage(bitmap, 0, 0, nw, nh);
    bitmap.close();
    const jpg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: preset.quality })).arrayBuffer());
    if (jpg.length >= obj.contents.length * 0.9) continue;
    const smask = d.get(L.PDFName.of("SMask"));
    out.context.assign(ref, out.context.stream(jpg, {
      Type: "XObject", Subtype: "Image", Width: nw, Height: nh,
      ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode",
      ...(smask ? { SMask: smask } : {}),
    }));
    images++;
  }
  for (const page of out.getPages()) page.node.delete(L.PDFName.of("Thumb")); // embedded thumbnails
  const result = await out.save({ useObjectStreams: true });
  return { bytes: result, images, before: bytes.length, after: result.length };
}

// ---------- conversion ----------

/** Text paragraphs per page, reflowed from pdf.js text items. */
export async function extractParagraphs(pdf, progress) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progress?.(t("export.progress", { i: n, n: pdf.numPages }));
    const { items } = await (await pdf.getPage(n)).getTextContent();
    const words = items
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        // Mirrored text (OCR layers write RTL words with a negative x scale) starts at its right edge.
        const w = Math.abs(it.width);
        const left = it.transform[0] < 0 ? it.transform[4] - w : it.transform[4];
        return { str: it.str, left, right: left + w, y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10 };
      });
    // Lines: same baseline within half a font size.
    words.sort((a, b) => b.y - a.y);
    const lines = [];
    for (const wd of words) {
      const line = lines.find((l) => Math.abs(l.y - wd.y) < Math.max(l.size, wd.size) * 0.5);
      if (line) { line.items.push(wd); line.size = Math.max(line.size, wd.size); } else lines.push({ y: wd.y, size: wd.size, items: [wd] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      const text = l.items.map((i) => i.str).join("");
      const arabic = (text.match(/[؀-ۿ]/g) || []).length;
      const latin = (text.match(/[A-Za-z]/g) || []).length;
      l.rtl = arabic >= latin && arabic > 0;
      l.items.sort((a, b) => (l.rtl ? b.right - a.right : a.left - b.left));
      let s = "";
      l.items.forEach((it, k) => {
        const str = it.str.trim();
        if (k) {
          const prev = l.items[k - 1];
          const gap = l.rtl ? prev.left - it.right : it.left - prev.right;
          // Separate words unless glyph runs touch (pdf.js may split one word into pieces).
          if (gap > l.size * 0.12 || /\s$/.test(prev.str) || /^\s/.test(it.str)) s += " ";
        }
        s += str;
      });
      l.text = s.replace(/\s+/g, " ").trim();
    }
    // Paragraphs: consecutive lines with similar size, direction and spacing.
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 10;
    const paras = [];
    let cur = null;
    for (const l of lines) {
      const cont = cur && cur.rtl === l.rtl && Math.abs(cur.size - l.size) < cur.size * 0.15 && cur.lastY - l.y < l.size * 1.8;
      if (cont) { cur.text += ` ${l.text}`; cur.lastY = l.y; } else {
        cur = { text: l.text, size: l.size, rtl: l.rtl, lastY: l.y };
        paras.push(cur);
      }
    }
    pages.push(paras.map(({ text, size, rtl }) => ({ text, size, rtl, heading: size >= median * 1.5 ? 1 : size >= median * 1.2 ? 2 : undefined })));
  }
  return pages;
}

export async function exportWord(ctx) {
  const pdf = await ctx.loadPdf((await ctx.currentBytes()).slice());
  const pages = await extractParagraphs(pdf, ctx.progress);
  await pdf.destroy();
  if (!pages.some((p) => p.length)) { ctx.toast(t("export.noText"), true); return null; }
  const data = await tools.docxBuild({ title: baseName(ctx.state.name), pages });
  return tools.saveBinary({ suggestedName: `${baseName(ctx.state.name)}.docx`, data, filter: { name: t("export.wordFilter"), extensions: ["docx"] } });
}

export async function exportText(ctx) {
  const pdf = await ctx.loadPdf((await ctx.currentBytes()).slice());
  const pages = await extractParagraphs(pdf, ctx.progress);
  await pdf.destroy();
  if (!pages.some((p) => p.length)) { ctx.toast(t("export.noText"), true); return null; }
  const text = pages.map((p, i) => `— ${t("export.pageN", { n: i + 1 })} —\n\n${p.map((x) => x.text).join("\n\n")}`).join("\n\n");
  const data = new TextEncoder().encode(`﻿${text.replace(/\n/g, "\r\n")}`); // BOM so Notepad reads Arabic
  return tools.saveBinary({ suggestedName: `${baseName(ctx.state.name)}.txt`, data, filter: { name: t("export.textFilter"), extensions: ["txt"] } });
}

export async function exportImages(ctx, { format = "png", dpi = 150 } = {}) {
  const base = baseName(ctx.state.name);
  const dir = await tools.pickFolder({ suggestedName: `${base} - ${t("suffix.images")}` });
  if (!dir) return null;
  const pdf = await ctx.loadPdf((await ctx.currentBytes()).slice());
  const pad = String(pdf.numPages).length;
  for (let n = 1; n <= pdf.numPages; n++) {
    ctx.progress(t("export.imagesProgress", { i: n, n: pdf.numPages }));
    const canvas = await renderPage(await pdf.getPage(n), dpi);
    const data = await canvasBytes(canvas, format === "jpg" ? "image/jpeg" : "image/png", 0.9);
    await tools.writeFileIn({ dir, name: `${base}-${String(n).padStart(pad, "0")}.${format}`, data });
  }
  const count = pdf.numPages;
  await pdf.destroy();
  return { dir, count };
}

/** Build a PDF from images; one image per page. */
export async function imagesToPdf(ctx) {
  const files = await tools.pickImages();
  if (!files.length) return null;
  const res = await modal({
    title: t("images.title"),
    body: `<p>${t("images.count", { n: files.length })}</p>
      <label class="field">${t("images.pageSize")}<select name="size">
        <option value="a4">${t("images.a4")}</option>
        <option value="image">${t("images.fit")}</option></select></label>`,
    actions: [{ label: t("images.create"), value: "ok", primary: true }, { label: t("common.cancel"), value: "cancel" }],
  });
  if (!res) return null;
  const { PDFDocument } = globalThis.PDFLib;
  const out = await PDFDocument.create();
  for (const [i, f] of files.entries()) {
    ctx.progress(t("images.progress", { i: i + 1, n: files.length }));
    let img;
    if (/\.png$/i.test(f.name)) img = await out.embedPng(f.data);
    else {
      // JPEG/WebP/BMP/GIF: decode with EXIF orientation applied, re-encode as JPEG.
      const bmp = await createImageBitmap(new Blob([f.data]), { imageOrientation: "from-image" });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, bmp.width, bmp.height);
      g.drawImage(bmp, 0, 0);
      bmp.close();
      img = await out.embedJpg(new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer()));
    }
    if (res.data.size === "image") {
      const w = img.width * 0.75, h = img.height * 0.75; // 96 dpi pixels -> points
      out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const landscape = img.width > img.height;
      const [pw, ph] = landscape ? [841.89, 595.28] : [595.28, 841.89];
      const m = 28;
      const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
      const w = img.width * s, h = img.height * s;
      out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return out.save();
}

// ---------- Arabic appearances (text boxes and form fields) ----------

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

async function renderTextBox(text, w, h, size, rgb) {
  const k = 4;
  await document.fonts.load(`${size * k}px ${FONT}`, text).catch(() => {});
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
  const g = c.getContext("2d");
  g.font = `${size * k}px ${FONT}`;
  g.fillStyle = rgbCss(rgb);
  g.direction = AR.test(text) ? "rtl" : "ltr";
  g.textAlign = g.direction === "rtl" ? "right" : "left";
  g.textBaseline = "alphabetic";
  const x = g.direction === "rtl" ? c.width - size * k * 0.2 : size * k * 0.2;
  text.split(/\r?\n/).forEach((line, i) => g.fillText(line, x, size * k * (1.0 + i * 1.3)));
  return canvasBytes(c);
}

/** Wrap text to lines no wider than maxW (canvas units), honouring explicit newlines. */
function wrap(g, text, maxW) {
  const lines = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && g.measureText(next.trim()).width > maxW) { lines.push(line.trim()); line = word.trimStart(); } else line = next;
    }
    lines.push(line.trim());
  }
  return lines;
}

/** Appearance of a text or choice field: background, border and the value, like a viewer draws it. */
async function renderField({ text, w, h, size, rgb, align, multiline, border, background, borderWidth }) {
  const k = 4;
  await document.fonts.load(`${12 * k}px ${FONT}`, text).catch(() => {});
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
  const g = c.getContext("2d");
  if (background) { g.fillStyle = rgbCss(background); g.fillRect(0, 0, c.width, c.height); }
  const bw = (border ? borderWidth || 1 : 0) * k;
  if (border && bw) { g.strokeStyle = rgbCss(border); g.lineWidth = bw; g.strokeRect(bw / 2, bw / 2, c.width - bw, c.height - bw); }
  const pad = bw + 2 * k;
  const innerW = c.width - 2 * pad;
  // Size 0 means "auto": fit the height (single line) or a readable default (multi-line).
  let px = (size || (multiline ? 10 : Math.min(h * 0.62, 14))) * k;
  g.font = `${px}px ${FONT}`;
  if (!size && !multiline) while (px > 4 * k && g.measureText(text).width > innerW) { px -= k * 0.5; g.font = `${px}px ${FONT}`; }
  const rtl = AR.test(text);
  g.direction = rtl ? "rtl" : "ltr";
  g.fillStyle = rgbCss(rgb);
  g.textBaseline = "alphabetic";
  // /Q: 0 left, 1 centre, 2 right (absolute, as in the PDF specification).
  g.textAlign = align === 1 ? "center" : align === 2 ? "right" : "left";
  const x = align === 1 ? c.width / 2 : align === 2 ? c.width - pad : pad;
  if (multiline) {
    wrap(g, text, innerW).forEach((line, i) => g.fillText(line, x, pad + px * (0.95 + i * 1.25)));
  } else {
    g.fillText(text, x, c.height / 2 + px * 0.35);
  }
  return canvasBytes(c);
}

/**
 * Give Arabic FreeText annotations and Arabic text/choice field values an
 * image appearance, so every PDF reader shows them shaped correctly (pdf.js
 * writes them with a font that has no Arabic glyphs). Returns the (possibly
 * unchanged) bytes; values stay in the file as text for search and editing.
 */
export async function fixArabicAppearances(bytes, loadPdf) {
  if (!tools) return bytes;
  const doc = await loadPdf(bytes.slice());
  const items = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      for (const a of await (await doc.getPage(n)).getAnnotations()) {
        const m = /^(\d+)R(\d*)$/.exec(a.id || "");
        if (!m) continue;
        const [x1, y1, x2, y2] = a.rect;
        const w = x2 - x1, h = y2 - y1;
        const size = a.defaultAppearanceData?.fontSize || 0;
        const rgb = Array.from(a.defaultAppearanceData?.fontColor || [0, 0, 0]);
        const ref = { objNum: Number(m[1]), gen: Number(m[2] || 0) };
        if (a.annotationType === 3) { // FreeText
          const text = a.contentsObj?.str || "";
          if (!AR.test(text)) continue;
          items.push({ ...ref, png: await renderTextBox(text, w, h, size || 12, rgb), hash: hash(`${text}|${w.toFixed(1)}|${h.toFixed(1)}|${size}|${rgb}`) });
        } else if (a.annotationType === 20 && (a.fieldType === "Tx" || (a.fieldType === "Ch" && a.combo))) { // text fields, drop-downs
          let text = Array.isArray(a.fieldValue) ? a.fieldValue[0] || "" : a.fieldValue || "";
          if (a.fieldType === "Ch") text = (a.options || []).find((o) => o.exportValue === text)?.displayValue ?? text;
          if (!AR.test(text)) continue;
          const props = {
            text, w, h, size, rgb, align: a.textAlignment ?? 0, multiline: !!a.multiLine,
            border: a.borderColor ? Array.from(a.borderColor) : null, background: a.backgroundColor ? Array.from(a.backgroundColor) : null,
            borderWidth: a.borderStyle?.width ?? 1,
          };
          items.push({ ...ref, png: await renderField(props), hash: hash(JSON.stringify({ ...props, w: w.toFixed(1), h: h.toFixed(1) })) });
        }
      }
    }
  } finally {
    await doc.destroy();
  }
  if (!items.length) return bytes;
  return new Uint8Array(await tools.setAppearances({ pdf: bytes, items }));
}
