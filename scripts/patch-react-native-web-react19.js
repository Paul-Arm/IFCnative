const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targets = [
  {
    file: path.join(projectRoot, 'node_modules', 'react-native-web', 'dist', 'exports', 'TouchableWithoutFeedback', 'index.js'),
    from: 'supportedProps.ref = useMergeRefs(forwardedRef, hostRef, element.ref);',
    to: `const elementRef = element.props?.ref;
  supportedProps.ref = useMergeRefs(forwardedRef, hostRef, elementRef);`,
    legacy: 'const elementRef = Number.parseInt(React.version, 10) >= 19 ? element.props?.ref : element.ref;',
    legacyTo: 'const elementRef = element.props?.ref;',
  },
  {
    file: path.join(projectRoot, 'node_modules', 'react-native-web', 'dist', 'cjs', 'exports', 'TouchableWithoutFeedback', 'index.js'),
    from: 'supportedProps.ref = (0, _useMergeRefs.default)(forwardedRef, hostRef, element.ref);',
    to: `var elementRef = element.props?.ref;
  supportedProps.ref = (0, _useMergeRefs.default)(forwardedRef, hostRef, elementRef);`,
    legacy: 'var elementRef = Number.parseInt(_react.version, 10) >= 19 ? element.props?.ref : element.ref;',
    legacyTo: 'var elementRef = element.props?.ref;',
  },
  {
    file: path.join(projectRoot, 'node_modules', 'react-native-web', 'src', 'exports', 'TouchableWithoutFeedback', 'index.js'),
    from: 'supportedProps.ref = useMergeRefs(forwardedRef, hostRef, element.ref);',
    to: `const elementRef = element.props?.ref;
  supportedProps.ref = useMergeRefs(forwardedRef, hostRef, elementRef);`,
    legacy: 'const elementRef = Number.parseInt(React.version, 10) >= 19 ? element.props?.ref : element.ref;',
    legacyTo: 'const elementRef = element.props?.ref;',
  },
];

let changed = false;

for (const target of targets) {
  if (!fs.existsSync(target.file)) {
    console.warn(`[patch-react-native-web-react19] ${path.relative(projectRoot, target.file)} not found.`);
    continue;
  }

  let source = fs.readFileSync(target.file, 'utf8');
  if (source.includes(target.from)) {
    source = source.replace(target.from, target.to);
    fs.writeFileSync(target.file, source);
    changed = true;
  } else if (source.includes(target.legacy)) {
    source = source.replace(target.legacy, target.legacyTo);
    fs.writeFileSync(target.file, source);
    changed = true;
  }
}

if (changed) {
  console.log('[patch-react-native-web-react19] Patched TouchableWithoutFeedback refs for React 19.');
} else {
  console.log('[patch-react-native-web-react19] Already patched TouchableWithoutFeedback refs for React 19.');
}
