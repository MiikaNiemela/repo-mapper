import path from 'node:path';
import { analyserFor } from './analyzers.js';
import { loadJestAliases, loadProjectConfigs } from './config.js';
import { scanRepository } from './scan.js';

function nearestPackage(file, packageScopes) {
  let best = null;
  for (const scope of packageScopes) {
    if (scope.dir && file !== scope.dir && !file.startsWith(`${scope.dir}/`)) continue;
    if (!best || scope.dir.length > best.dir.length) best = scope;
  }
  return best;
}

function normalizeAliases(aliases, warnings) {
  if (aliases === undefined) return [];
  if (!Array.isArray(aliases)) {
    warnings.push({ code: 'invalid-alias', message: 'aliases must be an array of { find, replacement } rules' });
    return [];
  }
  return aliases.filter((rule, index) => {
    const valid =
      rule &&
      typeof rule.find === 'string' &&
      typeof rule.replacement === 'string' &&
      (rule.find.match(/\*/g) ?? []).length <= 1 &&
      (rule.replacement.match(/\*/g) ?? []).length <= 1;
    if (!valid) warnings.push({ code: 'invalid-alias', message: `Invalid alias rule at index ${index}` });
    return valid;
  });
}

/**
 * Builds the file level dependency graph of a repository. Only connections
 * between files implemented in the repository are kept; imports of external
 * libraries are counted in `externalImports` but not mapped.
 *
 * @param {string} root repository directory
 * @param {{
 *   extensions?: string[],
 *   useGit?: boolean,
 *   exclude?: string[],
 *   include?: string[],
 *   ignore?: string[],
 *   only?: string[],
 *   skip?: string[],
 *   aliases?: { find: string, replacement: string }[],
 * }} [options]
 * @returns {{
 *   root: string,
 *   name: string,
 *   files: { path: string, lines: number, imports: string[], externalImports: string[] }[],
 *   links: { source: string, target: string }[],
 *   warnings: { code: string, message: string, path?: string }[],
 * }}
 */
export function buildDependencyGraph(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const {
    files: scanned,
    packages,
    packageScopes,
    repositoryFiles,
    resolutionFiles,
    warnings: filterWarnings,
  } = scanRepository(absoluteRoot, options);
  const fileSet = new Set(scanned.map((f) => f.path));
  const resolutionFileSet = new Set(resolutionFiles);
  const projects = loadProjectConfigs(absoluteRoot, repositoryFiles);
  const warnings = [
    ...filterWarnings,
    ...projects.warnings,
    ...loadJestAliases(absoluteRoot, repositoryFiles, packageScopes),
  ];
  const explicitAliases = normalizeAliases(options.aliases, warnings);
  const links = [];
  const files = scanned.map(({ path: file, lines, source }) => {
    const imports = new Set();
    const externalImports = new Set();
    const analyser = analyserFor(path.posix.extname(file));
    if (analyser) {
      const packageScope = nearestPackage(file, packageScopes);
      const context = {
        root: absoluteRoot,
        aliases: [...explicitAliases, ...(packageScope?.aliases ?? [])],
        config: projects.nearest(file),
        packageScope,
      };
      for (const specifier of analyser.extractImports(source)) {
        const target = analyser.resolveImport(file, specifier, resolutionFileSet, packages, context);
        if (target === null || !fileSet.has(target)) externalImports.add(specifier);
        else if (target !== file) imports.add(target);
      }
    }
    for (const target of imports) links.push({ source: file, target });
    return { path: file, lines, imports: [...imports], externalImports: [...externalImports] };
  });
  return { root: absoluteRoot, name: path.basename(absoluteRoot), files, links, warnings };
}
