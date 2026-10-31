// See ../README.md. Callers: @electron/asar 3 (promisify(glob.glob)) and rimraf 2
// (glob(pattern, options, cb), glob.sync, glob.hasMagic). glob 7 treated
// backslashes on Windows as separators; glob 14 needs windowsPathsNoEscape for that.
const { glob: globAsync, sync, hasMagic } = require('glob-14');

function glob(pattern, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = { windowsPathsNoEscape: process.platform === 'win32', ...options };
  globAsync(pattern, opts).then((files) => callback(null, files), callback);
}

glob.sync = (pattern, options = {}) => sync(pattern, { windowsPathsNoEscape: process.platform === 'win32', ...options });
glob.hasMagic = (pattern, options = {}) => hasMagic(pattern, { windowsPathsNoEscape: process.platform === 'win32', ...options });
glob.glob = glob;
module.exports = glob;
