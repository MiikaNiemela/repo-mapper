import path from 'node:path';

// Keywords after which a `/` starts a regular expression literal rather than a division.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await', 'export', 'import', 'extends',
]);

const isIdentifierStart = (c) => /[A-Za-z_$#\u0080-\uffff]/.test(c);
const isIdentifierPart = (c) => /[\w$\u0080-\uffff]/.test(c);

/**
 * Splits a JavaScript / TypeScript source into tokens in a single linear
 * pass. Comments, regular expression literals and template literal text are
 * skipped; string literals are kept as `string` tokens so that only import
 * forms appearing in executable code are recognised.
 *
 * @param {string} source
 * @returns {{ type: 'name' | 'punct' | 'string' | 'value', value: string }[]}
 */
function tokenize(source) {
  const tokens = [];
  const { length } = source;
  const templateDepths = [];
  let braceDepth = 0;
  let i = 0;

  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === 'punct') return prev.value !== ')' && prev.value !== ']';
    if (prev.type === 'name') return REGEX_PRECEDING_KEYWORDS.has(prev.value);
    return false;
  };

  // Skips template literal text starting at `j`; returns the index after the
  // closing backtick, or after `${` when entering an embedded expression.
  const skipTemplate = (j) => {
    while (j < length) {
      const c = source[j];
      if (c === '\\') j += 2;
      else if (c === '`') return j + 1;
      else if (c === '$' && source[j + 1] === '{') {
        templateDepths.push(braceDepth);
        braceDepth += 1;
        return j + 2;
      } else j += 1;
    }
    return length;
  };

  while (i < length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? length : end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? length : end + 2;
    } else if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      tokens.push({ type: 'string', value: source.slice(i + 1, Math.min(j, length)) });
      i = j + 1;
    } else if (c === '`') {
      i = skipTemplate(i + 1);
      tokens.push({ type: 'value', value: '`' });
    } else if (c === '{') {
      braceDepth += 1;
      tokens.push({ type: 'punct', value: c });
      i += 1;
    } else if (c === '}') {
      braceDepth -= 1;
      if (templateDepths.length && templateDepths[templateDepths.length - 1] === braceDepth) {
        templateDepths.pop();
        i = skipTemplate(i + 1);
        tokens.push({ type: 'value', value: '`' });
      } else {
        tokens.push({ type: 'punct', value: c });
        i += 1;
      }
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += 1;
      }
      if (source[j] === '/') {
        j += 1;
        while (j < length && isIdentifierPart(source[j])) j += 1;
        tokens.push({ type: 'value', value: source.slice(i, j) });
        i = j;
      } else {
        tokens.push({ type: 'punct', value: c });
        i += 1;
      }
    } else if (isIdentifierStart(c)) {
      let j = i + 1;
      while (j < length && isIdentifierPart(source[j])) j += 1;
      tokens.push({ type: 'name', value: source.slice(i, j) });
      i = j;
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(next ?? ''))) {
      let j = i + 1;
      while (j < length && /[\w.]/.test(source[j])) j += 1;
      tokens.push({ type: 'value', value: source.slice(i, j) });
      i = j;
    } else if (c === '.' && next === '.' && source[i + 2] === '.') {
      tokens.push({ type: 'punct', value: '...' });
      i += 3;
    } else {
      tokens.push({ type: 'punct', value: c });
      i += 1;
    }
  }
  return tokens;
}

const is = (token, type, value) => token !== undefined && token.type === type && (value === undefined || token.value === value);

/**
 * Extracts the module specifiers imported by a JavaScript / TypeScript source.
 *
 * Recognises `import ... from 'y'`, `import 'y'`, `export ... from 'y'`,
 * `require('y')`, `import x = require('y')` and dynamic `import('y')`.
 *
 * @param {string} source
 * @returns {string[]} unique specifiers in order of appearance
 */
export function extractImports(source) {
  const tokens = tokenize(source);
  const found = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const afterDot = is(tokens[i - 1], 'punct', '.');
    if (token.type !== 'name' || afterDot) {
      i += 1;
    } else if (
      (token.value === 'require' || token.value === 'import') &&
      is(tokens[i + 1], 'punct', '(') &&
      is(tokens[i + 2], 'string') &&
      (is(tokens[i + 3], 'punct', ')') || is(tokens[i + 3], 'punct', ','))
    ) {
      found.push(tokens[i + 2].value);
      i += 3;
    } else if (token.value === 'import' && is(tokens[i + 1], 'string')) {
      found.push(tokens[i + 1].value);
      i += 2;
    } else if (token.value === 'import' || token.value === 'export') {
      // Bounded declaration scan: the main loop resumes where the scan stops,
      // so every token is visited a constant number of times.
      let j = i + 1;
      while (j < tokens.length) {
        const t = tokens[j];
        if (is(t, 'name', 'from') && is(tokens[j + 1], 'string')) {
          found.push(tokens[j + 1].value);
          j += 2;
          break;
        }
        const continues =
          (t.type === 'name' && t.value !== 'import' && t.value !== 'export') ||
          t.type === 'string' ||
          (t.type === 'punct' && (t.value === '{' || t.value === '}' || t.value === ',' || t.value === '*'));
        if (!continues) break;
        j += 1;
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return [...new Set(found)];
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
