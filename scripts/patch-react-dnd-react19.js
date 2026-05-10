const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const target = path.join(projectRoot, 'node_modules', 'react-dnd', 'dist', 'internals', 'wrapConnectorHooks.js');

if (!fs.existsSync(target)) {
  console.warn('[patch-react-dnd-react19] react-dnd wrapConnectorHooks.js not found. Run npm install first.');
  process.exit(0);
}

let source = fs.readFileSync(target, 'utf8');
let changed = false;

const importFrom = "import { cloneElement, isValidElement } from 'react';";
const importTo = "import { cloneElement, isValidElement, version as reactVersion } from 'react';";

if (source.includes(importFrom)) {
  source = source.replace(importFrom, importTo);
  changed = true;
}

const refFrom = 'function cloneWithRef(element, newRef) {\n    const previousRef = element.ref;';
const refTo = `function getElementRef(element) {
    return element.props?.ref;
}
function cloneWithRef(element, newRef) {
    const previousRef = getElementRef(element);`;

const conditionalRefFrom = `function getElementRef(element) {
    const majorVersion = Number.parseInt(reactVersion, 10);
    return majorVersion >= 19 ? element.props?.ref : element.ref;
}`;
const propsRefOnly = `function getElementRef(element) {
    return element.props?.ref;
}`;

if (source.includes(refFrom)) {
  source = source.replace(refFrom, refTo);
  changed = true;
} else if (source.includes(conditionalRefFrom)) {
  source = source.replace(conditionalRefFrom, propsRefOnly);
  changed = true;
}

if (changed) {
  fs.writeFileSync(target, source);
  console.log('[patch-react-dnd-react19] Patched react-dnd connector refs for React 19.');
} else if (source.includes('function getElementRef(element)')) {
  console.log('[patch-react-dnd-react19] Already patched react-dnd connector refs for React 19.');
} else {
  console.warn('[patch-react-dnd-react19] Expected react-dnd source pattern was not found.');
}
