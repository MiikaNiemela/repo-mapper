import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createFileFilter,
  isDirectoryExcluded,
  resolveFilterOptions,
  splitDirectoryExclusions,
} from './filtering.js';

/** Directories that never contain code implemented in the repository itself. */
export const DEFAULT_EXCLUDED_DIRS = Object.freeze([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'web_modules',
  'dist',
  '.git',
  '.hg',
  '.svn',
]);

/** JavaScript and TypeScript source extensions whose imports are analysed. */
export const SCRIPT_EXTENSIONS = Object.freeze([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
]);

export const DEFAULT_EXTENSIONS = SCRIPT_EXTENSIONS;

const toPosix = (p) => p.split(path.sep).join('/');

function listWithGit(root) {
  const out = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
  );
  return out.split('\0').filter(Boolean);
}

function listWithWalk(root, exclusions) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (!isDirectoryExcluded(relative, exclusions)) walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Lists every file of the repository that is implemented in the repository.
 * Uses `git ls-files` (honouring .gitignore) when possible and falls back to
 * a file system walk. Third-party code folders such as `node_modules/` are
 * always excluded.
 *
 * @param {string} root
 * @param {{ useGit?: boolean, exclude?: string[] }} [options]
 * @returns {string[]} posix paths relative to root, sorted
 */
export function listRepositoryFiles(root, options = {}) {
  const { useGit = true, exclude = [] } = options;
  const exclusions = splitDirectoryExclusions([...DEFAULT_EXCLUDED_DIRS, ...exclude]);
  let files;
  if (useGit) {
    try {
      files = listWithGit(root);
    } catch {
      files = undefined;
    }
  }
  if (!files) files = listWithWalk(root, exclusions);
  return [...new Set(files.map(toPosix))]
    .filter((f) => !isDirectoryExcluded(f, exclusions))
    .filter((f) => {
      try {
        return lstatSync(path.join(root, f)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Counts the non-blank lines of a source text. */
export function countLines(source) {
  let count = 0;
  for (const line of source.split('\n')) if (line.trim()) count += 1;
  return count;
}

/**
 * Scans a repository and returns its source files (with their size) and the
 * packages implemented inside it.
 *
 * @param {string} root
 * @param {{
 *   extensions?: string[],
 *   useGit?: boolean,
 *   exclude?: string[],
 *   include?: string[],
 *   ignore?: string[],
 *   only?: string[],
 *   skip?: string[],
 * }} [options]
 * @returns {{
 *   files: { path: string, lines: number, source: string }[],
 *   packages: Map<string, { dir: string, entries: string[], imports?: object, jest?: object, aliases?: object[] }>,
 *   packageScopes: { dir: string, imports?: object, jest?: object, aliases?: object[] }[],
 *   repositoryFiles: string[],
 *   resolutionFiles: string[],
 *   warnings: { code: string, message: string, path?: string }[],
 * }}
 */
export function scanRepository(root, options = {}) {
  const resolved = resolveFilterOptions(root, options);
  const extensions = new Set((resolved.options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()));
  const all = listRepositoryFiles(root, resolved.options);
  const selected = createFileFilter(resolved.options, resolved.warnings);
  const resolutionFiles = all.filter((f) => extensions.has(path.posix.extname(f).toLowerCase()));
  const files = resolutionFiles
    .filter(selected)
    .map((f) => {
      const source = readFileSync(path.join(root, f), 'utf8');
      return { path: f, lines: countLines(source), source };
    });
  return {
    files,
    packages: findLocalPackages(root, all),
    packageScopes: findPackageScopes(root, all),
    repositoryFiles: all,
    resolutionFiles,
    warnings: resolved.warnings,
  };
}

/** Returns the root (`.`) entry of a package.json `exports` field. */
function rootExport(exports) {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return exports;
  const keys = Object.keys(exports);
  // An object without subpath keys is the shorthand condition object of the root.
  return keys.some((k) => k.startsWith('.')) ? exports['.'] : exports;
}

/** Collects the file targets of an export (string, fallback array or conditions), in priority order. */
function exportTargets(target) {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) return target.flatMap(exportTargets);
  if (!target || typeof target !== 'object') return [];
  return Object.entries(target)
    .filter(([condition]) => condition !== 'types' && condition !== 'typings')
    .flatMap(([, value]) => exportTargets(value));
}

/**
 * Finds the packages implemented inside the repository (e.g. workspaces of a
 * monorepo) so that imports between them are mapped as internal connections.
 *
 * @param {string} root
 * @param {string[]} files repository files (posix, relative)
 * @returns {Map<string, { dir: string, entries: string[], imports?: object, jest?: object }>} package name -> info
 */
export function findLocalPackages(root, files) {
  const packages = new Map();
  for (const file of files) {
    if (path.posix.basename(file) !== 'package.json') continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    } catch {
      continue;
    }
    if (!pkg || typeof pkg.name !== 'string') continue;
    const dir = path.posix.dirname(file);
    const entries = [pkg.source, pkg.module, pkg.main]
      .concat(exportTargets(rootExport(pkg.exports)))
      .filter((e) => typeof e === 'string');
    packages.set(pkg.name, {
      dir: dir === '.' ? '' : dir,
      entries,
      imports: pkg.imports,
      jest: pkg.jest,
    });
  }
  return packages;
}

/** Finds every package scope, including package.json files without a name. */
export function findPackageScopes(root, files) {
  const scopes = [];
  for (const file of files) {
    if (path.posix.basename(file) !== 'package.json') continue;
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      if (!pkg || typeof pkg !== 'object') continue;
      const dir = path.posix.dirname(file);
      scopes.push({
        dir: dir === '.' ? '' : dir,
        imports: pkg.imports,
        jest: pkg.jest,
      });
    } catch {
      // Invalid package manifests are already ignored by package discovery.
    }
  }
  return scopes;
}
