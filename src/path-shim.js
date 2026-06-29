// path-shim.js: Empty path module shim for browser environment using CommonJS
const resolve = (...args) => args.join('/');
const join = (...args) => args.join('/');
const basename = (p) => p.substring(p.lastIndexOf('/') + 1);
const dirname = (p) => p.substring(0, p.lastIndexOf('/'));

const _exports = {
  resolve,
  join,
  basename,
  dirname
};

export {
  resolve,
  join,
  basename,
  dirname
};

export default _exports;

if (typeof module !== 'undefined') {
  module.exports = _exports;
}
