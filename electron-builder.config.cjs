const packageJson = require('./package.json');

const includeMosaic = process.env.DEVFORGE_PACKAGE_MOSAIC === '1';
const baseBuild = packageJson.build || {};

const files = Array.isArray(baseBuild.files) ? [...baseBuild.files] : [];
const asarUnpack = Array.isArray(baseBuild.asarUnpack) ? [...baseBuild.asarUnpack] : [];

if (includeMosaic) {
  files.push('native/mosaic-coordinator/index.node');
  asarUnpack.push('native/mosaic-coordinator/*.node');
}

module.exports = {
  ...baseBuild,
  files,
  asarUnpack,
};
