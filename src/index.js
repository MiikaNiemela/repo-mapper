// Used locally by `mapRepository` and `render` below.
import { buildDependencyGraph } from './graph.js';
import { renderHtml, renderSvg } from './render.js';
import { buildModuleTree } from './tree.js';

// Public API of the package: re-exported for library users so that each step of
// the pipeline (scan -> imports -> graph -> tree -> layout -> render) and its
// defaults can be used and customised on their own. They are not used in this file.
export { buildDependencyGraph } from './graph.js';
export { FILE_CATEGORIES, fileCategory } from './filtering.js';
export { extractImports, resolveImport } from './imports.js';
export { computeTreemap, TREEMAP_TYPES } from './layout.js';
export { renderHtml, renderSvg } from './render.js';
export {
  // Directories that are never mapped (e.g. node_modules, dist).
  DEFAULT_EXCLUDED_DIRS,
  // Extensions mapped by default (alias of SCRIPT_EXTENSIONS).
  DEFAULT_EXTENSIONS,
  // Extensions whose imports are analysed for connections.
  SCRIPT_EXTENSIONS,
  countLines,
  findLocalPackages,
  listRepositoryFiles,
  scanRepository,
} from './scan.js';
export { buildModuleTree, orderByConnectivity } from './tree.js';

export const OUTPUT_FORMATS = Object.freeze(['svg', 'html', 'json']);

/**
 * Maps a repository: scans its own source files (never `node_modules/`),
 * resolves the connections between them and builds the module hierarchy.
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
 *   maxDepth?: number,
 *   aliases?: { find: string, replacement: string }[],
 * }} [options]
 * @returns {{ graph: ReturnType<typeof buildDependencyGraph>, tree: object }}
 */
export function mapRepository(root, options = {}) {
  const graph = buildDependencyGraph(root, options);
  const tree = buildModuleTree(graph, options);
  return { graph, tree };
}

/**
 * Renders a module tree in the requested output format.
 *
 * @param {object} tree output of `buildModuleTree` / `mapRepository`
 * @param {{ format?: 'svg' | 'html' | 'json', type?: 'nested' | 'cascaded', width?: number, height?: number, showLinks?: boolean, title?: string }} [options]
 * @returns {string}
 */
export function render(tree, options = {}) {
  const { format = 'svg' } = options;
  switch (format) {
    case 'svg':
      return renderSvg(tree, options);
    case 'html':
      return renderHtml(tree, options);
    case 'json':
      return `${JSON.stringify(tree, null, 2)}\n`;
    default:
      throw new Error(`Unknown output format "${format}", expected one of: ${OUTPUT_FORMATS.join(', ')}`);
  }
}
