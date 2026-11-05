// See ../README.md. @electron/asar 3 and dir-compare 4 call the default export,
// which minimatch 11 dropped. Those callers were written for minimatch 3, which
// read backslashes in patterns as path separators on Windows, so the default
// export does too; the named exports keep minimatch 11's behaviour.
const minimatch = require('minimatch-11');

const isWindows = process.platform === 'win32';
const compat = (path, pattern, options) => minimatch.minimatch(path, pattern, { windowsPathsNoEscape: isWindows, ...options });
module.exports = Object.assign(compat, minimatch, { default: compat });
