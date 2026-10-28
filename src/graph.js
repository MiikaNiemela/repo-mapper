import path from 'node:path';
import { extractImports, resolveImport } from './imports.js';
import { scanRepository, SCRIPT_EXTENSIONS } from './scan.js';

/**
 * Builds the file level dependency graph of a repository. Only connections
 * between files implemented in the repository are kept; imports of external
 * libraries are counted in `externalImports` but not mapped.
 *
 * @param {string} root repository directory
 * @param {{ extensions?: string[], useGit?: boolean, exclude?: string[] }} [options]
 * @returns {{
 *   root: string,
 *   name: string,
 *   files: { path: string, lines: number, imports: string[], externalImports: string[] }[],
 *   links: { source: string, target: string }[],
 * }}
 */
export function buildDependencyGraph(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const { files: scanned, packages } = scanRepository(absoluteRoot, options);
  const fileSet = new Set(scanned.map((f) => f.path));
  const scriptExtensions = new Set(SCRIPT_EXTENSIONS);
  const links = [];
  const files = scanned.map(({ path: file, lines, source }) => {
    const imports = new Set();
    const externalImports = new Set();
    if (scriptExtensions.has(path.posix.extname(file).toLowerCase())) {
      for (const specifier of extractImports(source)) {
        const target = resolveImport(file, specifier, fileSet, packages);
        if (target === null) externalImports.add(specifier);
        else if (target !== file) imports.add(target);
      }
    }
    for (const target of imports) links.push({ source: file, target });
    return { path: file, lines, imports: [...imports], externalImports: [...externalImports] };
  });
  return { root: absoluteRoot, name: path.basename(absoluteRoot), files, links };
}
