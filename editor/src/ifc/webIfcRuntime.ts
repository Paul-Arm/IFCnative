import * as WebIFC from 'web-ifc';

let apiPromise: Promise<WebIFC.IfcAPI> | undefined;

export function getWebIfcAPI() {
  if (!apiPromise) {
    apiPromise = initWebIfcAPI();
  }
  return apiPromise;
}

async function initWebIfcAPI() {
  const api = new WebIFC.IfcAPI();
  await api.Init((path) => {
    if (typeof window === 'undefined') {
      return path;
    }
    const wasmName = path.endsWith('.wasm') ? path : 'web-ifc.wasm';
    if (window.location.protocol === 'file:') {
      return new URL(`wasm/${wasmName}`, window.location.href).toString();
    }
    return `/wasm/${wasmName}`;
  }, true);
  return api;
}
