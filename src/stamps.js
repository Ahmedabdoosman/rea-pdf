// Stamps rendered to PNG so they look identical in every PDF reader
// (no dependency on the reader's Arabic font shaping). The stamp text is
// fixed per stamp, independent of the interface language.
export const STAMPS = [
  { lang: "ar", text: "معتمد", color: "#2E7D32" },
  { lang: "ar", text: "تمت المراجعة", color: "#0071B9" },
  { lang: "ar", text: "مسودة", color: "#5B6B79" },
  { lang: "ar", text: "للاطلاع", color: "#003462" },
  { lang: "ar", text: "عاجل", color: "#E65100" },
  { lang: "ar", text: "سري", color: "#C62828" },
  { lang: "ar", text: "مرفوض", color: "#C62828" },
  { lang: "en", text: "APPROVED", color: "#2E7D32" },
  { lang: "en", text: "REVIEWED", color: "#0071B9" },
  { lang: "en", text: "DRAFT", color: "#5B6B79" },
  { lang: "en", text: "FOR INFORMATION", color: "#003462" },
  { lang: "en", text: "URGENT", color: "#E65100" },
  { lang: "en", text: "CONFIDENTIAL", color: "#C62828" },
  { lang: "en", text: "REJECTED", color: "#C62828" },
];

export async function makeStampFile({ text, color, lang = "ar" }) {
  const font = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
  await document.fonts.load(`600 72px ${font}`, text).catch(() => {});
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const scale = 3;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `600 34px ${font}`;
  const w = Math.max(probe.measureText(text).width, 120) + 56;
  const h = 86;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.direction = lang === "ar" ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3.5;
  roundRect(ctx, 3, 3, w - 6, h - 6, 12);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  roundRect(ctx, 9, 9, w - 18, h - 18, 8);
  ctx.stroke();
  ctx.font = `600 34px ${font}`;
  ctx.fillText(text, w / 2, 48);
  ctx.font = `500 14px ${font}`;
  ctx.fillText(date, w / 2, 70);

  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return new File([blob], `stamp-${Date.now()}.png`, { type: "image/png" });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
