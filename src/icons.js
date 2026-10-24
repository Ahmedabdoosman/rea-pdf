// REA PDF's own line icons (24x24, stroke-based).
const P = {
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  saveas: '<path d="M5 3h11l3 3v6M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/><path d="M7 3v5h8V3"/><path d="M17 15v6M14 18h6"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><path d="M6 14h12v7H6z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  pages: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/>',
  merge: '<path d="M6 3v6a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><path d="M12 15v6M9 18l3 3 3-3"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 16a1.5 1.5 0 0 1 2.5-1.7L8 17"/>',
  highlight: '<path d="M9 15l-3 3H3l3-3M9 15l6-12 6 6-12 6zM9 15l-3-3"/><path d="M3 21h18"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  stamp: '<path d="M9 13V9a3 3 0 1 1 6 0v4"/><path d="M4 17a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4H4zM5 21h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  rotl: '<path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  extract: '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5"/><path d="M3 3l9 9M3 10V3h7"/>',
  insert: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M12 11v7M8.5 14.5h7"/>',
  blank: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  ocr: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h6M8 15h7"/>',
  compress: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
  export: '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5"/><path d="M3 10V3h7M3 3l9 9"/><path d="M14 13h4M14 16h4"/>',
  sign: '<path d="M3 17c3 0 4-9 6-9s1 7 3 7 2-4 4-4 2 3 5 3"/><path d="M3 21h18"/>',
  cert: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 9h6M7 12h4"/><circle cx="17" cy="14" r="3"/><path d="M15.5 16.5L15 21l2-1 2 1-.5-4.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  ftext: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 10v4M6 10h2M6 14h2"/>',
  fcheck: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  fradio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  fdrop: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M14 11l2 2 2-2"/>',
  fsign: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M6 15c2 0 2.5-4 4-4s.5 3 2 3 1.5-1.5 2.5-1.5M15 15h4"/>',
  fedit: '<rect x="3" y="7" width="12" height="8" rx="1" stroke-dasharray="2 2"/><path d="M14 20l1-4 5-5 3 3-5 5z"/>',
  fhl: '<rect x="3" y="7" width="18" height="10" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M7 12h6"/>',
  review: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5M13.5 17.5c.5-2 2-3.5 3.5-3.5 2.2 0 4 1.8 4 4.5"/>',
  route: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h4a4 4 0 0 1 4 4v0M7 18h4a4 4 0 0 0 4-4v0M15 12h2"/>',
  edittext: '<path d="M4 7V5h12v2M10 5v13M7 18h6"/><path d="M14 20l1-4 5-5 3 3-5 5z"/>',
  redact: '<rect x="3" y="5" width="18" height="4" rx="1" fill="currentColor"/><path d="M3 13h10M3 17h7"/><rect x="14" y="12" width="7" height="7" rx="1" fill="currentColor"/>',
};

export function icon(name) {
  const body = P[name] || "";
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
  });
}
