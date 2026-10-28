import { readFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

export const FILE_CATEGORIES = Object.freeze([
  'code',
  'test',
  'config',
  'types',
  'story',
  'generated',
]);

const OPTION_KEYS = ['extensions', 'exclude', 'include', 'ignore', 'only', 'skip'];
const CATEGORY_PATTERNS = Object.freeze({
  generated: [
    '**/*.generated.*',
    '**/*.gen.*',
    '**/generated/**',
  ],
  test: [
    '**/*.{test,spec}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/{test,tests,e2e,cypress}/**',
  ],
  story: [
    '**/*.stories.*',
    '**/.storybook/**',
  ],
  types: [
    '**/*.d.{ts,mts,cts}',
  ],
  config: [
    '**/{jest,vitest,playwright,cypress}.config.*',
    '**/{eslint,prettier}.config.*',
    '**/.{eslint,prettier}rc',
    '**/.{eslint,prettier}rc.*',
    '**/{tsconfig,jsconfig}*.json',
    '**/{vite,webpack,rollup,babel,next}.config.*',
  ],
});

const CATEGORY_MATCHERS = Object.entries(CATEGORY_PATTERNS).map(([category, patterns]) => [
  category,
  picomatch(patterns, { dot: true }),
]);

function addWarning(warnings, code, message, configPath) {
  warnings.push({ code, message, path: configPath });
}

function readJson(root, file, warnings, required = false) {
  try {
    return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    if (!required && error.code === 'ENOENT') return undefined;
    addWarning(warnings, 'invalid-filter-config', `Cannot parse ${file}: ${error.message}`, file);
    return undefined;
  }
}

function normalizeDirectory(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) return null;
  return normalized;
}

function validateOptions(value, source, warnings) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addWarning(warnings, 'invalid-filter-config', `${source} must contain an object`, source);
    return {};
  }
  const result = {};
  for (const key of OPTION_KEYS) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string')) {
      addWarning(warnings, 'invalid-filter-option', `${source} "${key}" must be an array of strings`, source);
      continue;
    }
    if (key === 'only' || key === 'skip') {
      result[key] = value[key].filter((category) => {
        if (FILE_CATEGORIES.includes(category)) return true;
        addWarning(warnings, 'unknown-file-category', `Unknown file category "${category}" in ${source}`, source);
        return false;
      });
    } else if (key === 'exclude') {
      result[key] = value[key].filter((directory) => {
        if (normalizeDirectory(directory)) return true;
        addWarning(warnings, 'invalid-exclude', `Invalid excluded directory "${directory}" in ${source}`, source);
        return false;
      });
    } else {
      result[key] = [...value[key]];
    }
  }
  return result;
}

/**
 * Loads and merges repository filtering options. Explicit options replace the
 * matching committed configuration key.
 */
export function resolveFilterOptions(root, explicitOptions = {}) {
  const warnings = [];
  const packageJson = readJson(root, 'package.json', warnings);
  const packageOptions = validateOptions(packageJson?.repoMapper, 'package.json#repoMapper', warnings);
  const configJson = readJson(root, 'repo-mapper.config.json', warnings);
  const configOptions = validateOptions(configJson, 'repo-mapper.config.json', warnings);
  const explicit = validateOptions(explicitOptions, 'options', warnings);
  const passthrough = Object.fromEntries(
    Object.entries(explicitOptions).filter(([key]) => !OPTION_KEYS.includes(key)),
  );
  return {
    options: { ...passthrough, ...packageOptions, ...configOptions, ...explicit },
    warnings,
  };
}

function compilePatterns(patterns, option, warnings) {
  const matchers = [];
  for (const pattern of patterns ?? []) {
    try {
      matchers.push(picomatch(pattern, { dot: true }));
    } catch (error) {
      addWarning(warnings, 'invalid-filter-pattern', `Invalid ${option} pattern "${pattern}": ${error.message}`);
    }
  }
  return matchers;
}

/** Returns the built-in category for a repository-relative POSIX path. */
export function fileCategory(file) {
  for (const [category, matches] of CATEGORY_MATCHERS) {
    if (matches(file)) return category;
  }
  return 'code';
}

/** Compiles include, ignore and category options into one source-file predicate. */
export function createFileFilter(options, warnings = []) {
  const includes = compilePatterns(options.include, 'include', warnings);
  const ignores = compilePatterns(options.ignore, 'ignore', warnings);
  const only = new Set(options.only ?? []);
  const skip = new Set(options.skip ?? []);
  return (file) => {
    if (includes.length && !includes.some((matches) => matches(file))) return false;
    if (ignores.some((matches) => matches(file))) return false;
    const category = fileCategory(file);
    if (only.size && !only.has(category)) return false;
    return !skip.has(category);
  };
}

/** Splits backwards-compatible segment exclusions from exact relative paths. */
export function splitDirectoryExclusions(exclude = []) {
  const names = new Set();
  const paths = new Set();
  for (const value of exclude) {
    const normalized = normalizeDirectory(value);
    if (!normalized) continue;
    if (normalized.includes('/')) paths.add(normalized);
    else names.add(normalized);
  }
  return { names, paths };
}

export function isDirectoryExcluded(relPath, exclusions) {
  const normalized = normalizeDirectory(relPath);
  if (!normalized) return false;
  if (normalized.split('/').some((segment) => exclusions.names.has(segment))) return true;
  for (const directory of exclusions.paths) {
    if (normalized === directory || normalized.startsWith(`${directory}/`)) return true;
  }
  return false;
}
