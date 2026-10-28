import path from 'node:path';

/**
 * Removes comments from a JavaScript / TypeScript source while keeping string
 * literals intact (single pass, linear time).
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const { length } = source;
  while (i < length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      out += ' ';
      i = end === -1 ? length : end + 2;
    } else if (char === '"' || char === "'" || char === '`') {
      let j = i + 1;
      while (j < length && source[j] !== char && !(char !== '`' && source[j] === '\n')) {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

const IMPORT_PATTERNS = [
  // import x from 'y'; import { a } from 'y'; import 'y'; export * from 'y'; import type { T } from 'y'
  /(?:^|[^\w$.])(?:import|export)\b(?:[^'"`;]*?\bfrom)?\s*(['"])([^'"\n]+)\1/g,
  // require('y'), import x = require('y')
  /(?:^|[^\w$.])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  // dynamic import('y')
  /(?:^|[^\w$.])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
];

/**
 * Extracts the module specifiers imported by a JavaScript / TypeScript source.
 *
 * @param {string} source
 * @returns {string[]} unique specifiers in order of appearance
 */
export function extractImports(source) {
  const code = stripComments(source);
  const found = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      found.push({ index: match.index, specifier: match[2] });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return [...new Set(found.map((f) => f.specifier))];
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

function candidates(target) {
  if (!target) return RESOLVE_EXTENSIONS.map((e) => `index${e}`);
  const list = [target];
  const ext = path.posix.extname(target);
  for (const alt of JS_TO_TS[ext] ?? []) list.push(target.slice(0, -ext.length) + alt);
  for (const e of RESOLVE_EXTENSIONS) list.push(target + e);
  for (const e of RESOLVE_EXTENSIONS) list.push(`${target}/index${e}`);
  return list;
}

function resolvePath(target, fileSet) {
  let normalized = path.posix.normalize(target).replace(/^\.\/+/, '').replace(/\/$/, '');
  if (normalized.startsWith('../') || normalized === '..') return null;
  if (normalized === '.') normalized = '';
  return candidates(normalized).find((c) => fileSet.has(c)) ?? null;
}

function splitPackageSpecifier(specifier) {
  const parts = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') };
}

/**
 * Resolves an import specifier to a file of the repository. Imports of
 * libraries that are not implemented in the repository (e.g. installed in
 * `node_modules/`, or Node.js built-ins) resolve to `null`.
 *
 * @param {string} fromFile importing file (posix, relative to repository root)
 * @param {string} specifier
 * @param {Set<string>} fileSet repository source files
 * @param {Map<string, { dir: string, entries: string[] }>} [packages] packages implemented in the repository
 * @returns {string | null}
 */
export function resolveImport(fromFile, specifier, fileSet, packages = new Map()) {
  const cut = specifier.search(/[?#]/);
  const clean = cut === -1 ? specifier : specifier.slice(0, cut);
  if (!clean) return null;
  if (clean.startsWith('.')) {
    return resolvePath(path.posix.join(path.posix.dirname(fromFile), clean), fileSet);
  }
  if (clean.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;

  const { name, subpath } = splitPackageSpecifier(clean);
  const pkg = packages.get(name);
  if (!pkg) return null;
  const base = pkg.dir ? `${pkg.dir}/` : '';
  if (subpath) {
    return resolvePath(base + subpath, fileSet) ?? resolvePath(`${base}src/${subpath}`, fileSet);
  }
  for (const entry of [...pkg.entries, 'src/index', 'index']) {
    const resolved = resolvePath(base + entry, fileSet);
    if (resolved) return resolved;
  }
  return null;
}
