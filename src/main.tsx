import React from 'react';
import { createRoot } from 'react-dom/client';
import 'react-mosaic-component/react-mosaic-component.css';

import IfcWorkspace from './components/ifc-workspace';
import './global.css';

const root = globalThis.document.getElementById('root');

if (!root) {
  throw new Error('Missing root element.');
}

createRoot(root).render(
  <React.StrictMode>
    <IfcWorkspace />
  </React.StrictMode>,
);
