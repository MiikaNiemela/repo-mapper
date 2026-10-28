import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const toPosix = (value) => value.split(path.sep).join('/');

function warning(warnings, code, message, configPath) {
  warnings.push({ code, message, path: configPath ? toPosix(configPath) : undefined });
}

/** Parses JSON with JavaScript-style comments and trailing commas. */
export function parseJsonc(source) {
  let output = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'") {
      const quote = c;
      output += c;
      i += 1;
      while (i < source.length) {
        const current = source[i];
        output += current;
        i += 1;
        if (current === '\\' && i < source.length) {
          output += source[i];
          i += 1;
        } else if (current === quote) {
          break;
        }
      }
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i = Math.min(source.length, i + 2);
    } else if (c === ',') {
      let j = i + 1;
      while (j < source.length) {
        while (j < source.length && /\s/.test(source[j])) j += 1;
        if (source[j] === '/' && source[j + 1] === '/') {
          while (j < source.length && source[j] !== '\n') j += 1;
        } else if (source[j] === '/' && source[j + 1] === '*') {
          j += 2;
          while (j < source.length && !(source[j] === '*' && source[j + 1] === '/')) j += 1;
          j = Math.min(source.length, j + 2);
        } else break;
      }
      if (source[j] === '}' || source[j] === ']') i += 1;
      else {
        output += c;
        i += 1;
      }
    } else {
      output += c;
      i += 1;
    }
  }
  return JSON.parse(output);
}

function packageExtendsPath(value, fromConfig) {
  const require = createRequire(fromConfig);
  const attempts = value.endsWith('.json') ? [value] : [`${value}/tsconfig.json`, value];
  for (const attempt of attempts) {
    try {
      return require.resolve(attempt);
    } catch {
      // Try the next package convention.
    }
  }
  try {
    const packageJson = require.resolve(`${value}/package.json`);
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8'));
    if (typeof pkg.tsconfig === 'string') return path.resolve(path.dirname(packageJson), pkg.tsconfig);
  } catch {
    // Reported by the caller as one missing extends target.
  }
  return null;
}

function extendsPath(value, fromConfig) {
  if (value.startsWith('.') || path.isAbsolute(value)) {
    const target = path.resolve(path.dirname(fromConfig), value);
    return path.extname(target) ? target : `${target}.json`;
  }
  return packageExtendsPath(value, fromConfig);
}

function configPath(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative.startsWith('..') ? absolute : relative || path.basename(absolute);
}

function repositoryAbsolute(root, target) {
  try {
    const canonicalRoot = realpathSync(root);
    const relative = path.relative(canonicalRoot, target);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`)) return path.resolve(root, relative);
  } catch {
    // Keep the original target; normal resolution will reject paths outside the repository.
  }
  return target;
}

function compilePaths(paths, baseDir, root, warnings, configFile) {
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    warning(warnings, 'invalid-config-paths', `compilerOptions.paths must be an object in ${configFile}`, configFile);
    return [];
  }
  return Object.entries(paths).flatMap(([find, replacements]) => {
    if (typeof find !== 'string' || (find.match(/\*/g) ?? []).length > 1 || !Array.isArray(replacements)) {
      warning(warnings, 'invalid-config-path', `Unsupported path mapping "${find}" in ${configFile}`, configFile);
      return [];
    }
    const targets = replacements
      .filter((target) => typeof target === 'string' && (target.match(/\*/g) ?? []).length <= 1)
      .map((target) => toPosix(repositoryAbsolute(root, path.resolve(baseDir, target))));
    if (targets.length !== replacements.length) {
      warning(warnings, 'invalid-config-path', `Unsupported target in path mapping "${find}" in ${configFile}`, configFile);
    }
    return targets.length ? [{ find, targets }] : [];
  });
}

/**
 * Loads repository tsconfig/jsconfig files and returns the nearest effective
 * config for each source file. Configuration is parsed once and cached.
 */
export function loadProjectConfigs(root, repositoryFiles) {
  const warnings = [];
  const configByDir = new Map();
  for (const file of repositoryFiles) {
    const name = path.posix.basename(file);
    if (name !== 'tsconfig.json' && name !== 'jsconfig.json') continue;
    const dir = path.posix.dirname(file);
    const existing = configByDir.get(dir);
    if (!existing || name === 'tsconfig.json') configByDir.set(dir, file);
  }

  const cache = new Map();
  const loading = new Set();
  const load = (absolute) => {
    if (cache.has(absolute)) return cache.get(absolute);
    if (loading.has(absolute)) {
      warning(warnings, 'config-extends-cycle', `Cyclic config extends chain at ${configPath(root, absolute)}`, configPath(root, absolute));
      return {};
    }
    loading.add(absolute);
    let raw;
    try {
      raw = parseJsonc(readFileSync(absolute, 'utf8'));
    } catch (error) {
      warning(warnings, 'invalid-config', `Cannot parse ${configPath(root, absolute)}: ${error.message}`, configPath(root, absolute));
      loading.delete(absolute);
      cache.set(absolute, {});
      return {};
    }

    let parent = {};
    if (typeof raw.extends === 'string') {
      const parentPath = extendsPath(raw.extends, absolute);
      if (parentPath) parent = load(parentPath);
      else warning(
        warnings,
        'missing-config-extends',
        `Cannot resolve "${raw.extends}" extended by ${configPath(root, absolute)}`,
        configPath(root, absolute),
      );
    } else if (raw.extends !== undefined) {
      warning(warnings, 'invalid-config-extends', `Unsupported extends value in ${configPath(root, absolute)}`, configPath(root, absolute));
    }

    const options = raw.compilerOptions && typeof raw.compilerOptions === 'object' ? raw.compilerOptions : {};
    const ownBase = typeof options.baseUrl === 'string'
      ? path.resolve(path.dirname(absolute), options.baseUrl)
      : parent.baseUrl;
    const pathBase = ownBase ?? path.dirname(absolute);
    const file = configPath(root, absolute);
    const paths = options.paths === undefined
      ? parent.paths ?? []
      : compilePaths(options.paths, pathBase, root, warnings, file);
    const result = {
      baseUrl: ownBase ? toPosix(repositoryAbsolute(root, ownBase)) : undefined,
      paths,
    };
    loading.delete(absolute);
    cache.set(absolute, result);
    return result;
  };

  for (const file of configByDir.values()) load(path.join(root, file));

  const nearest = (file) => {
    let dir = path.posix.dirname(file);
    while (true) {
      const config = configByDir.get(dir);
      if (config) return load(path.join(root, config));
      if (dir === '.') return {};
      dir = path.posix.dirname(dir);
    }
  };
  return { nearest, warnings };
}

function mapperRule(pattern, replacement, rootDir, warnings, configFile) {
  if (Array.isArray(replacement)) [replacement] = replacement;
  if (typeof replacement !== 'string') {
    warning(warnings, 'unsupported-jest-alias', `Unsupported Jest replacement for "${pattern}"`, configFile);
    return null;
  }
  let find;
  let capture = false;
  if (/^\^[^()[\]{}+?|\\*]+\$$/.test(pattern)) find = pattern.slice(1, -1);
  else {
    const match = pattern.match(/^\^([^()[\]{}+?|\\*]*)\(\.\*\)\$$/);
    if (!match) {
      warning(warnings, 'unsupported-jest-alias', `Unsupported Jest pattern "${pattern}"`, configFile);
      return null;
    }
    find = `${match[1]}*`;
    capture = true;
  }
  let target = replacement.replaceAll('<rootDir>', rootDir);
  if (capture) {
    if (!target.includes('$1')) {
      warning(warnings, 'unsupported-jest-alias', `Jest replacement for "${pattern}" must contain $1`, configFile);
      return null;
    }
    target = target.replaceAll('$1', '*');
  }
  return { find, replacement: toPosix(target) };
}

function compileMapper(mapper, rootDir, warnings, configFile) {
  if (!mapper || typeof mapper !== 'object' || Array.isArray(mapper)) return [];
  return Object.entries(mapper)
    .map(([pattern, replacement]) => mapperRule(pattern, replacement, rootDir, warnings, configFile))
    .filter(Boolean);
}

/** Loads declarative Jest aliases for each repository package. */
export function loadJestAliases(root, repositoryFiles, packageScopes) {
  const warnings = [];
  const jsonConfigs = new Set(repositoryFiles.filter((file) => path.posix.basename(file) === 'jest.config.json'));
  for (const pkg of packageScopes) {
    const rootDir = path.join(root, pkg.dir);
    const configFile = path.posix.join(pkg.dir || '.', 'jest.config.json');
    let mapper = pkg.jest?.moduleNameMapper;
    if (jsonConfigs.has(configFile) || (pkg.dir === '' && jsonConfigs.has('jest.config.json'))) {
      try {
        const parsed = parseJsonc(readFileSync(path.join(root, configFile), 'utf8'));
        mapper = parsed.moduleNameMapper;
      } catch (error) {
        warning(warnings, 'invalid-jest-config', `Cannot parse ${configFile}: ${error.message}`, configFile);
      }
    }
    pkg.aliases = compileMapper(mapper, rootDir, warnings, configFile);
  }
  return warnings;
}
