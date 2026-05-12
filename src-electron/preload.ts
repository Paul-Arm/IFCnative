import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld(
  'ifcNativeDesktop',
  Object.freeze({
    isElectron: true,
    platform: process.platform,
    versions: Object.freeze({
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    }),
  }),
);