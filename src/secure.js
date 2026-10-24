// Password protection, certificate signing and signature verification UI.
import { modal, esc, baseName, formatDate } from "./ui.js";
import { security } from "./platform.js";
import { savedSignatures } from "./signature-pad.js";
import { rectPicker } from "./redact.js";
import { t, isRtl } from "./i18n.js";

const ID_KEY = "midad.lastIdentity";
const TSA_KEY = "midad.tsa";
const TSA_LABELS = { digicert: "DigiCert", sectigo: "Sectigo", globalsign: "GlobalSign", freetsa: "FreeTSA" };
const tsaPref = () => { try { return { on: true, server: "digicert", custom: "", ...JSON.parse(localStorage.getItem(TSA_KEY) || "{}") }; } catch { return { on: true, server: "digicert", custom: "" }; } };
const saveTsaPref = (p) => { try { localStorage.setItem(TSA_KEY, JSON.stringify(p)); } catch {} };
const lastIdentity = () => { try { return JSON.parse(localStorage.getItem(ID_KEY) || "null"); } catch { return null; } };
const rememberIdentity = (id) => { try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch {} };

export const hasSignatures = (bytes) => bytes && latin1(bytes).includes("/ByteRange");
export const isEncryptedBytes = (bytes) => bytes && /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(latin1(bytes));
function latin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}
const cancelAction = () => ({ label: t("common.cancel"), value: "cancel" });

/** Operations that rewrite the file break existing signatures; ask first. Resolves true to proceed. */
export async function confirmBreaksSignatures(bytes, action) {
  if (!hasSignatures(bytes)) return true;
  const res = await modal({
    title: t("sec.signedTitle"),
    body: `<p>${t("sec.signedBody", { action })}</p>
      <p class="note">${t("sec.signedNote")}</p>`,
    actions: [{ label: t("sec.continueAnyway"), value: "ok", danger: true }, cancelAction()],
  });
  return !!res;
}

// ---------- password protection ----------

const PRESETS = ["full", "readOnly", "noCopy", "noPrint"];

export async function protectDocument(ctx) {
  if (!(await confirmBreaksSignatures(await ctx.currentBytes(), t("action.encrypt")))) return;
  const res = await modal({
    title: t("protect.title"),
    body: `
      <label class="field">${t("protect.openPw")}<input name="pw" type="password" autocomplete="new-password"></label>
      <label class="field">${t("protect.confirmPw")}<input name="pw2" type="password" autocomplete="new-password"></label>
      <label class="field">${t("protect.permissions")}
        <select name="preset">${PRESETS.map((v) => `<option value="${v}">${t(`protect.preset.${v}`)}</option>`).join("")}</select></label>
      <label class="field" data-owner hidden>${t("protect.ownerPw")}<input name="owner" type="password" autocomplete="new-password"></label>
      <p class="note">${t("protect.note")}</p>`,
    actions: [{ label: t("protect.submit"), value: "ok", primary: true }, cancelAction()],
    onOpen(d) {
      d.querySelector("[name=preset]").onchange = (e) => (d.querySelector("[data-owner]").hidden = e.target.value === "full");
    },
    validate(v) {
      if (v.pw.length < 4) return t("protect.tooShort");
      if (v.pw !== v.pw2) return t("pw.mismatch");
      if (v.preset !== "full" && v.owner && v.owner === v.pw) return t("protect.ownerSame");
      return null;
    },
  });
  if (!res) return;
  const { pw, preset, owner } = res.data;
  await ctx.busy(t("busy.encrypting"), async () => {
    const plain = await ctx.plainBytes();
    if (!plain) return;
    const enc = await security.encrypt({ pdf: plain, userPassword: pw, ownerPassword: preset === "full" ? pw : owner || undefined, preset });
    const saved = await ctx.platform.saveAs(`${baseName(ctx.state.name)} - ${t("suffix.protected")}.pdf`, enc);
    if (!saved) return;
    await ctx.openBytes(enc, { name: saved.name, path: saved.path, password: pw });
    ctx.toast(t("protect.done"));
  });
}

export async function unprotectDocument(ctx) {
  if (!ctx.state.encrypted) return ctx.toast(t("protect.notProtected"));
  await ctx.busy(t("busy.unprotecting"), async () => {
    const plain = await ctx.plainBytes();
    if (!plain) return;
    await ctx.openBytes(plain, { name: ctx.state.name, path: ctx.state.path, dirty: true });
    ctx.toast(t("protect.removed"));
  });
}

// ---------- digital signature ----------

const REASONS = () => [t("sign.reason1"), t("sign.reason2"), t("sign.reason3"), t("sign.reason4")];

export async function signDocument(ctx, { field = null } = {}) {
  // New signatures are appended incrementally, so earlier ones survive —
  // unless the file is encrypted and has to be rewritten first.
  if (ctx.state.encrypted && !(await confirmBreaksSignatures(await ctx.currentBytes(), t("action.signEncrypted")))) return;
  let identity = lastIdentity();
  const sigs = savedSignatures();
  const tsaServers = await security.tsaServers().catch(() => ({}));
  const pref = tsaPref();
  const reasons = REASONS();
  const idLabel = (id) => (id ? esc(id.name) : t("sign.noIdentity"));
  const res = await modal({
    title: t("sign.title"),
    wide: true,
    body: `
      <div class="field">${t("sign.identity")}
        <div class="id-row"><span class="id-name" data-id>${idLabel(identity)}</span>
          <button type="button" class="ghost small" data-pick>${t("sign.pickFile")}</button>
          <button type="button" class="ghost small" data-create>${t("sign.createId")}</button></div></div>
      <label class="field">${t("sign.idPassword")}<input name="pw" type="password" autocomplete="off"></label>
      <div class="grid2">
        <label class="field">${t("sign.reason")}<input name="reason" list="reasons" value="${esc(reasons[0])}"><datalist id="reasons">${reasons.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>
        <label class="field">${t("sign.location")}<input name="location" placeholder="${t("sign.locationPlaceholder")}"></label>
      </div>
      ${field ? `<p class="note">${t("sign.intoField", { name: esc(field.name) })}</p>` : `<label class="check"><input type="checkbox" name="visible" checked> ${t("sign.visible")}</label>`}
      <label class="check"><input type="checkbox" name="useTsa"${pref.on ? " checked" : ""}> ${t("sign.useTsa")}</label>
      <label class="check"><input type="checkbox" name="useLtv"${pref.ltv === false ? "" : " checked"}> ${t("sign.useLtv")}</label>
      <div class="grid2" data-tsa${pref.on ? "" : " hidden"}>
        <label class="field">${t("sign.tsaServer")}
          <select name="tsa">${Object.keys(tsaServers).map((k) => `<option value="${k}"${pref.server === k ? " selected" : ""}>${TSA_LABELS[k] || k}</option>`).join("")}
            <option value="custom"${pref.server === "custom" ? " selected" : ""}>${t("sign.tsaOther")}</option></select></label>
        <label class="field" data-tsa-custom${pref.server === "custom" ? "" : " hidden"}>${t("sign.tsaUrl")}<input name="tsaCustom" dir="ltr" value="${esc(pref.custom)}" placeholder="https://tsa.example.org"></label>
      </div>
      ${sigs.length ? `<div class="field">${t("sign.attachHand")}
        <div class="sig-choices"><label><input type="radio" name="hand" value="" checked><span>${t("sign.none")}</span></label>${sigs.map((s) => `<label><input type="radio" name="hand" value="${s.id}"><img src="${s.url}" alt=""></label>`).join("")}</div></div>` : ""}
      <p class="note" data-certinfo></p>`,
    actions: [{ label: t("common.continue"), value: "ok", primary: true }, cancelAction()],
    onOpen(d) {
      const show = () => (d.querySelector("[data-id]").textContent = identity ? identity.name : t("sign.noIdentity"));
      d.querySelector("[data-pick]").onclick = async () => {
        const id = await security.pickIdentity();
        if (id) { identity = id; show(); }
      };
      d.querySelector("[name=useTsa]").onchange = (e) => (d.querySelector("[data-tsa]").hidden = !e.target.checked);
      d.querySelector("[name=tsa]").onchange = (e) => (d.querySelector("[data-tsa-custom]").hidden = e.target.value !== "custom");
      d.querySelector("[data-create]").onclick = async () => {
        const id = await createIdentityDialog(ctx);
        if (id) { identity = id; show(); d.querySelector("[name=pw]").focus(); }
      };
    },
    async validate(v, _a, d) {
      if (!identity) return t("sign.needIdentity");
      if (!v.pw) return t("sign.needPassword");
      if (v.useTsa && v.tsa === "custom" && !/^https?:\/\/\S+$/.test(v.tsaCustom.trim())) return t("sign.badTsaUrl");
      try {
        const info = await security.certInfo({ idPath: identity.path, password: v.pw });
        if (info.expired) return t("sign.certExpired", { date: formatDate(info.validTo) });
        d.cert = info;
      } catch (err) { return err.message; }
      return null;
    },
  });
  if (!res) return;
  rememberIdentity(identity);
  const cert = res.el.cert;
  const { pw, reason, location, hand, useTsa, tsa, tsaCustom, useLtv } = res.data;
  const visible = field ? true : res.data.visible;
  saveTsaPref({ on: useTsa, server: tsa, custom: tsaCustom.trim(), ltv: useLtv });
  let tsaUrl = useTsa ? (tsa === "custom" ? tsaCustom.trim() : tsaServers[tsa]) : null;

  let pageIndex = ctx.pdfViewer.currentPageNumber - 1;
  let rect = null;
  if (field) {
    pageIndex = field.pageIndex;
    rect = field.rect;
  } else if (visible) {
    const picked = await pickPlacement(ctx);
    if (!picked) return;
    pageIndex = picked.page - 1;
    rect = picked.rect;
  }

  let savedTo = null;
  await ctx.busy(t("busy.signing"), async () => {
    const plain = await ctx.plainBytes();
    if (!plain) return;
    const handUrl = hand ? sigs.find((s) => s.id === hand)?.url : null;
    const appearancePng = rect ? await buildAppearance({ rect, cert, reason, handUrl }) : null;
    const args = { pdf: plain, idPath: identity.path, password: pw, pageIndex, rect, appearancePng, reason, location, contactInfo: cert.email || "", field: field?.name };
    let signed;
    try {
      signed = await security.sign({ ...args, tsaUrl });
    } catch (err) {
      if (!tsaUrl || !String(err.code).startsWith("tsa_")) throw err;
      // TSA unreachable: offer to sign without a trusted time rather than failing outright.
      const go = await modal({
        title: t("sign.tsaFailedTitle"),
        body: `<p>${esc(err.message)}</p><p class="note">${t("sign.tsaFailedNote")}</p>`,
        actions: [{ label: t("sign.signWithoutTsa"), value: "ok", primary: true }, cancelAction()],
      });
      if (!go) return;
      tsaUrl = null;
      signed = await security.sign(args);
    }
    if (useLtv) {
      // Best effort: self-signed IDs have no revocation data, the TSA chain usually does.
      ctx.progress?.(t("busy.ltvEmbed"));
      try { signed = (await security.addLtv({ pdf: signed })).bytes; } catch { /* nothing to embed */ }
    }
    const saved = await ctx.platform.saveAs(`${baseName(ctx.state.name)} - ${t("suffix.signed")}.pdf`, signed);
    if (!saved) return;
    await ctx.openBytes(signed, { name: saved.name, path: saved.path, page: pageIndex + 1 });
    ctx.toast(t("sign.done"));
    savedTo = saved;
  });
  if (savedTo) await ctx.afterSign?.(savedTo);
}

async function createIdentityDialog(ctx) {
  const res = await modal({
    title: t("id.title"),
    body: `
      <label class="field">${t("id.name")}<input name="name" autocomplete="name"></label>
      <div class="grid2">
        <label class="field">${t("id.org")}<input name="org" autocomplete="organization"></label>
        <label class="field">${t("id.email")}<input name="email" type="email" autocomplete="email"></label>
      </div>
      <label class="field">${t("id.password")}<input name="pw" type="password" autocomplete="new-password"></label>
      <label class="field">${t("protect.confirmPw")}<input name="pw2" type="password" autocomplete="new-password"></label>
      <p class="note">${t("id.note")}</p>`,
    actions: [{ label: t("id.submit"), value: "ok", primary: true }, cancelAction()],
    validate(v) {
      if (!v.name.trim()) return t("id.needName");
      if (v.pw.length < 6) return t("id.pwTooShort");
      if (v.pw !== v.pw2) return t("pw.mismatch");
      return null;
    },
  });
  if (!res) return null;
  try {
    const id = await security.createIdentity({ name: res.data.name.trim(), org: res.data.org.trim(), email: res.data.email.trim(), password: res.data.pw });
    if (id) ctx.toast(t("id.created"));
    return id;
  } catch (err) { ctx.toast(err.message, true); return null; }
}

function pickPlacement(ctx) {
  return new Promise((resolve) => {
    ctx.toast(t("sign.placeHint"));
    const stop = rectPicker(ctx.container, ctx.pdfViewer, (page, rect) => { cleanup(); resolve({ page, rect }); }, { className: "pick-box sign" });
    const onKey = (e) => { if (e.key === "Escape") { cleanup(); resolve(null); } };
    const cleanup = () => { stop(); window.removeEventListener("keydown", onKey, true); };
    window.addEventListener("keydown", onKey, true);
  });
}

async function buildAppearance({ rect, cert, reason, handUrl }) {
  const font = '"IBM Plex Sans Arabic", "Segoe UI", sans-serif';
  const rtl = isRtl();
  await document.fonts.load(`600 20px ${font}`, t("appearance.signedBy")).catch(() => {});
  const k = 4;
  const W = Math.round((rect[2] - rect[0]) * k), H = Math.round((rect[3] - rect[1]) * k);
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = c.getContext("2d");
  // Light panel so the block stays legible over page content.
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.strokeStyle = "#0071B9";
  g.lineWidth = 1.5 * k;
  g.beginPath();
  g.roundRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth, 4 * k);
  g.fill();
  g.stroke();
  const textW = handUrl ? W * 0.56 : W;
  // Handwritten signature opposite the text (left in Arabic, right in English).
  if (handUrl) {
    const img = new Image();
    img.src = handUrl;
    await img.decode();
    const s = Math.min((W - textW - 8 * k) / img.width, (H - 8 * k) / img.height);
    const x = rtl ? 4 * k : W - 4 * k - img.width * s;
    g.drawImage(img, x, (H - img.height * s) / 2, img.width * s, img.height * s);
  }
  const lines = [
    { text: t("appearance.signedBy"), w: 400, s: 0.75 },
    { text: cert.cn, w: 600, s: 1.15 },
    { text: t("appearance.date", { date: formatDate(new Date().toISOString()) }), w: 400, s: 0.75 },
    reason ? { text: t("appearance.reason", { reason }), w: 400, s: 0.75 } : null,
  ].filter(Boolean);
  const units = lines.reduce((a, l) => a + l.s * 1.35, 0);
  let size = Math.min(H / units, 22 * k);
  const fits = () => lines.every((l) => { g.font = `${l.w} ${size * l.s}px ${font}`; return g.measureText(l.text).width <= textW - 8 * k; });
  while (!fits() && size > 5 * k) size -= k * 0.5;
  g.direction = rtl ? "rtl" : "ltr";
  g.textAlign = rtl ? "right" : "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#0B2A6F";
  let y = (H - units * size) / 2;
  for (const l of lines) {
    y += l.s * size * 1.35;
    g.font = `${l.w} ${size * l.s}px ${font}`;
    g.fillText(l.text, rtl ? W - 4 * k : 4 * k, y - l.s * size * 0.3);
  }
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- verification ----------

export async function verifySignatures(bytes) {
  return security.verify({ pdf: bytes });
}

const revokedBeforeOrUnproven = (s) => s.revocation?.status === "revoked" && !s.revocation.afterSigning;
// A CA-issued chain we trust but couldn't check for revocation: validity unknown.
const revocationUnknown = (s) => s.trust?.status === "trusted" && (s.trust.chain?.length || 0) > 1 && ["unavailable", "offline"].includes(s.revocation?.status);

/** One verdict per signature: bad (broken/revoked), warn (changed / untrusted / unknown), ok. */
function judge(s) {
  if (!s.intact || revokedBeforeOrUnproven(s)) return "bad";
  if (s.changesAfter?.kind === "modified") return "warn";
  if (s.trust && s.trust.status !== "trusted") return "warn";
  if (revocationUnknown(s) || (s.timestamp && !(s.timestamp.valid && s.timestamp.trusted))) return "warn";
  return "ok";
}

function revocationText(s) {
  const r = s.revocation;
  if (!r) return "—";
  const via = (x) => s.ltv
    ? t("rev.viaEmbedded", { method: x.method === "crl" ? "CRL" : "OCSP" })
    : `${x.method === "crl" ? t("rev.crl") : "OCSP"}${x.source ? ` (${esc(x.source)})` : ""}`;
  switch (r.status) {
    case "good": return t("rev.good", { via: via(r) });
    case "revoked": {
      const why = r.reason && t(`rev.reason.${r.reason}`) !== `rev.reason.${r.reason}` ? t("rev.because", { reason: t(`rev.reason.${r.reason}`) }) : "";
      return r.afterSigning
        ? t("rev.revokedAfter", { cn: esc(r.cn), date: formatDate(r.revokedAt), why })
        : `<span class="tag bad">${t("rev.revokedTag")}</span> ${t("rev.revoked", { cn: esc(r.cn), date: formatDate(r.revokedAt), why })}`;
    }
    case "offline": return t("rev.offline");
    case "not-applicable": return t("rev.na");
    default: {
      const err = (r.details || []).map((d) => d.error).filter(Boolean).join("; ");
      return `${t("rev.unavailable")}${err ? `<br><small class="muted" dir="ltr">${esc(err)}</small>` : ""}`;
    }
  }
}

/** Translated message for a result's errorCode, else its raw (technical) error. */
const errorText = (r) => (r.errorCode ? t(`err.${r.errorCode}`) + (r.error ? ` (${r.error})` : "") : r.error || "");

function timestampText(s) {
  const ts = s.timestamp;
  if (!ts) return t("ts.none");
  if (!ts.valid) return `<span class="tag bad">${t("ts.invalid")}</span> ${esc(errorText(ts))}`;
  const rev = ts.revocation?.status === "revoked" ? ` <span class="tag bad">${t("ts.revoked")}</span>` : "";
  return ts.trusted ? `${t("ts.trusted", { tsa: esc(ts.tsa) })}${rev}` : t("ts.untrusted", { tsa: esc(ts.tsa || "") });
}

export function signatureStatus(list) {
  if (!list.length) return null;
  const n = list.length;
  const who = (s) => s?.signer?.cn || t("status.theSigner");
  if (list.some((s) => !s.intact)) return { level: "bad", text: t("status.broken") };
  const revoked = list.find(revokedBeforeOrUnproven);
  if (revoked) return { level: "bad", text: t("status.revoked", { cn: who(revoked) }) };
  if (list.some((s) => s.changesAfter?.kind === "modified")) return { level: "warn", text: t("status.modified") };
  if (list.some(revocationUnknown)) return { level: "warn", text: t("status.revocationUnknown") };
  const untrusted = list.filter((s) => s.trust && s.trust.status !== "trusted").length;
  if (untrusted) {
    return { level: "warn", text: n === 1 ? t("status.untrustedOne", { cn: who(list[0]) }) : t("status.untrustedMany", { n, untrusted }) };
  }
  const notes = list.some((s) => s.changesAfter?.kind === "annotations") ? t("status.commentsNote") : "";
  return { level: "ok", text: (n === 1 ? t("status.okOne", { cn: list[0].signer?.cn || "—" }) : t("status.okMany", { n })) + notes };
}

function chainHtml(tr) {
  if (!tr?.chain?.length) return "—";
  return `<ol class="chain">${tr.chain.map((c, i) => `<li><b>${esc(c.cn)}</b>
    ${i === tr.chain.length - 1 && tr.anchorSource ? `<span class="tag ok">${t(`source.${tr.anchorSource}`)}</span>` : ""}
    ${c.ca || i === 0 ? "" : `<span class="tag bad">${t("chain.notCa")}</span>`}
    <small>${t("chain.validTo", { date: formatDate(c.validTo) })}</small></li>`).join("")}</ol>`;
}

/**
 * Signature panel. `getList` re-verifies (after trust changes); `onChange`
 * lets the caller refresh its banner.
 */
export async function showSignatures(getList, onChange, { addLtv } = {}) {
  let list = await getList();
  for (;;) {
    const row = (s, i) => {
      const verdict = judge(s);
      const icon = verdict === "bad" ? "✕" : verdict === "warn" ? "!" : "✓";
      const c = s.signer || {};
      const integrity = !s.intact
        ? (s.errorCode || s.error ? t("panel.readError", { error: esc(errorText(s)) }) : t("panel.tampered"))
        : t("panel.intact");
      const canTrust = s.intact && s.trust && ["self-signed", "untrusted-root", "incomplete"].includes(s.trust.status);
      return `<div class="sig-item ${verdict}">
        <div class="sig-head"><span class="sig-icon">${icon}</span><b>${t("panel.signatureN", { n: i + 1, cn: esc(c.cn || s.name || t("panel.unknown")) })}</b></div>
        <dl>
          <dt>${t("panel.integrity")}</dt><dd>${integrity}</dd>
          <dt>${t("panel.after")}</dt><dd>${t(`changes.${s.changesAfter?.kind || "none"}`)}</dd>
          <dt>${t("panel.trust")}</dt><dd>${s.trust ? t(`trust.${s.trust.status}`) : "—"}</dd>
          <dt>${t("panel.chain")}</dt><dd>${chainHtml(s.trust)}</dd>
          <dt>${t("panel.revocation")}</dt><dd>${revocationText(s)}</dd>
          <dt>${t("panel.ltv")}</dt><dd>${s.ltv ? `<span class="tag ok">LTV</span> ${t("panel.ltvYes")}` : t("panel.ltvNo")}</dd>
          <dt>${t("panel.time")}</dt><dd>${s.timeSource === "timestamp"
            ? `${formatDate(s.timestamp.time)} <span class="tag ok">${t("panel.timeProven")}</span>`
            : `${formatDate(s.signingTime)} <span class="tag">${t("panel.timeClock")}</span>`}</dd>
          <dt>${t("panel.timestamp")}</dt><dd>${timestampText(s)}</dd>
          ${s.reason ? `<dt>${t("panel.reason")}</dt><dd>${esc(s.reason)}</dd>` : ""}
          ${s.location ? `<dt>${t("panel.location")}</dt><dd>${esc(s.location)}</dd>` : ""}
          ${c.org ? `<dt>${t("panel.org")}</dt><dd>${esc(c.org)}</dd>` : ""}
          ${s.certValidAtSigning === false ? `<dt>${t("panel.validity")}</dt><dd><span class='tag bad'>${t("panel.notValidAtSigning")}</span></dd>` : ""}
        </dl>
        ${canTrust ? `<button value="trust-${i}" class="ghost small trust-btn">${t("panel.trustThis", { cn: esc(s.trust.chain[s.trust.chain.length - 1]?.cn || "") })}</button>` : ""}
      </div>`;
    };
    const res = await modal({
      title: t("panel.title"),
      wide: true,
      body: `${list.map(row).join("")}
        <p class="note">${t("panel.note")}</p>`,
      actions: [
        { label: t("common.close"), value: "cancel", primary: true },
        { label: t("panel.manage"), value: "manage" },
        ...(addLtv && list.some((s) => s.intact && !s.ltv && s.revocation?.status === "good") ? [{ label: t("panel.addLtv"), value: "ltv" }] : []),
      ],
    });
    if (!res) return;
    if (res.action === "manage") await manageTrust();
    else if (res.action === "ltv") await addLtv();
    else if (res.action.startsWith("trust-")) {
      const s = list[Number(res.action.slice(6))];
      const top = s.trust.chain[s.trust.chain.length - 1];
      const ok = await modal({
        title: t("trustDlg.title"),
        body: `<p>${t("trustDlg.body", { cn: esc(top?.cn) })}</p>
          <p class="note">${t("trustDlg.note")}<br><code dir="ltr">${esc(top?.fingerprint)}</code></p>`,
        actions: [{ label: t("trustDlg.submit"), value: "ok", primary: true }, cancelAction()],
      });
      if (ok) await security.trustAdd({ pem: s.trust.trustCandidate });
    }
    list = await getList();
    onChange?.(list);
  }
}

async function manageTrust() {
  for (;;) {
    const certs = await security.trustList();
    const settings = await security.settingsGet();
    const res = await modal({
      title: t("manage.title"),
      wide: true,
      body: `<div class="setting-row"><div><b>${t("manage.online")}</b>
          <small class="muted">${t("manage.onlineDesc")} ${settings.onlineRevocation ? t("manage.on") : t("manage.off")}.</small></div>
          <button value="toggle-online" class="ghost small">${settings.onlineRevocation ? t("manage.disable") : t("manage.enable")}</button></div>`
        + (certs.length
        ? `<ul class="trust-list">${certs.map((c) => `<li><div><b>${esc(c.cn)}</b><small>${t("manage.issuedBy", { issuer: esc(c.issuer), date: formatDate(c.validTo) })}</small><code dir="ltr">${esc(c.fingerprint.slice(0, 47))}…</code></div>
            <button value="rm-${esc(c.fingerprint)}" class="ghost small">${t("manage.remove")}</button></li>`).join("")}</ul>`
        : `<p class="muted">${t("manage.empty")}</p>`),
      actions: [{ label: t("common.done"), value: "cancel", primary: true }, { label: t("manage.import"), value: "import" }],
    });
    if (!res) return;
    try {
      if (res.action === "toggle-online") await security.settingsSet({ onlineRevocation: !settings.onlineRevocation });
      if (res.action === "import") { const c = await security.trustImport(); if (c) continue; }
      if (res.action.startsWith("rm-")) await security.trustRemove({ fingerprint: res.action.slice(3) });
    } catch (err) {
      await modal({ title: t("manage.importFailed"), body: `<p>${esc(err.message)}</p>`, actions: [{ label: t("common.ok"), value: "cancel", primary: true }] });
    }
  }
}
