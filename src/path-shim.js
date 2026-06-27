// path-shim.js: Empty path module shim for browser environment using CommonJS
const resolve = (...args) => args.join('/');
const join = (...args) => args.join('/');
const basename = (p) => p.substring(p.lastIndexOf('/') + 1);
const dirname = (p) => p.substring(0, p.lastIndexOf('/'));

module.exports = {
  resolve,
  join,
  basename,
  dirname
};
