const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * The app reads a few modules that live in the web client (see src/shared).
 *
 * Metro refuses to serve a file outside the project root unless it is watched,
 * so the directory is named here.
 *
 * One rule governs what may cross: a shared module must be dependency-free.
 * A file outside this project resolves its own bare imports against its own
 * node_modules, not this app's — so sharing the web auth store pulled in that
 * tree's zustand 4.5 alongside this app's 5.0, two copies with two separate
 * registries. It was caught by the bundler rather than at runtime only because
 * the resolution failed outright; the version skew would not have announced
 * itself. Pure modules have nothing to resolve and nothing to skew.
 */
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../frontend/src')];

module.exports = config;
