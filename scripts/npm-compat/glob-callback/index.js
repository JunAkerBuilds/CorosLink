// See ../README.md. Callers: @electron/asar 3 (promisify(glob.glob)) and rimraf 2
// (glob(pattern, options, cb), glob.sync, glob.hasMagic). Matches glob 7's output:
// sorted unless nosort, and / separators on Windows, where glob 7 also read
// backslashes in patterns as separators (windowsPathsNoEscape in glob 14).
const { glob: globAsync, sync, hasMagic } = require('glob-14');

const isWindows = process.platform === 'win32';
const withDefaults = (options = {}) => ({ windowsPathsNoEscape: isWindows, ...options });

function asGlob7(files, options = {}) {
  const paths = isWindows ? files.map((file) => file.replace(/\\/g, '/')) : files;
  return options.nosort ? paths : paths.sort((a, b) => a.localeCompare(b, 'en'));
}

function glob(pattern, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  // Call back outside the promise so a throwing callback crashes like glob 7's would,
  // instead of becoming an unhandled rejection.
  globAsync(pattern, withDefaults(options)).then(
    (files) => process.nextTick(callback, null, asGlob7(files, options)),
    (error) => process.nextTick(callback, error),
  );
}

glob.sync = (pattern, options) => asGlob7(sync(pattern, withDefaults(options)), options);
glob.hasMagic = (pattern, options) => hasMagic(pattern, withDefaults(options));
glob.glob = glob;
module.exports = glob;
