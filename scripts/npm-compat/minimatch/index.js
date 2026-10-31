// See ../README.md. @electron/asar 3 and dir-compare 4 call the default export,
// which minimatch 11 dropped.
const minimatch = require('minimatch-11');

const compat = (path, pattern, options) => minimatch.minimatch(path, pattern, options);
module.exports = Object.assign(compat, minimatch, { default: compat });
