// File access: Electron bridge when available, plain browser APIs otherwise
// (the browser path lets the UI run in a normal page for development/testing).
const bridge = globalThis.midad;
export const isDesktop = !!bridge;

function pickFiles(multiple) {
  return new Promise((resolve) => {
    const input = document.getElementById("fallbackFile");
    input.multiple = !!multiple;
    input.value = "";
    input.onchange = async () => {
      const files = [...input.files];
      resolve(await Promise.all(files.map(fileToDoc)));
    };
    input.click();
  });
}

export async function fileToDoc(file) {
  return { path: null, name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { path: null, name };
}

// Security and tool operations run in the main process; unwrap { value | error }.
const unwrap = (group) => Object.fromEntries(Object.entries(group).map(([k, fn]) => [k, async (args) => {
  const res = await fn(args);
  if (res?.error) throw Object.assign(new Error(res.error), { code: res.code });
  return res?.value;
}]));
export const security = bridge ? unwrap(bridge.security) : null;
export const tools = bridge ? unwrap(bridge.tools) : null;

export const platform = {
  open: (multiple = false) => (bridge ? bridge.openDialog({ multiple }) : pickFiles(multiple)),
  readPath: (p) => bridge?.readPath(p),
  save: (path, data) => bridge.saveFile(path, data),
  saveAs: (name, data) => (bridge ? bridge.saveDialog(name, data) : Promise.resolve(download(name, data))),
  setTitle: (t) => (bridge ? bridge.setTitle(t) : (document.title = t)),
  setDirty: (d) => bridge?.setDirty(d),
  pendingOpen: () => (bridge ? bridge.getPendingOpen() : Promise.resolve(null)),
  onOpenPath: (cb) => bridge?.onOpenPath(cb),
  async confirm(message, detail, buttons) {
    if (bridge) return bridge.confirm(message, detail, buttons);
    return window.confirm(`${message}\n${detail || ""}`) ? 0 : buttons.length - 1;
  },
};
