# repo-mapper
tool for creating structured visual maps of a git repositories

`repo-mapper` is a Node.js library (and CLI) that turns the structure of a git
repository into a [d3](https://github.com/d3/d3) **nested** or **cascaded
treemap**.

* The mapped items are the modules of the application only: directories are
  modules / sub-modules and source files are components. Imported libraries
  that are not implemented in the repository are excluded – `node_modules/`
  (and other vendored package folders) are never mapped, and files ignored by
  `.gitignore` are skipped.
* The connections between modules are found by analysing the JavaScript and
  TypeScript imports (`import`, `export … from`, `require()`, `import()`),
  including TypeScript `.js` → `.ts` imports and imports of packages that are
  implemented in the repository (monorepo workspaces).
* Closely connected modules are placed next to each other, and the module with
  the most connections (or, on a tie, the one declaring the most
  dependencies) is placed at the logical centre of its parent.

## Installation

```sh
npm install repo-mapper
```

## CLI

```sh
npx repo-mapper [directory] [options]

# nested treemap as SVG on stdout
npx repo-mapper . > map.svg

# interactive cascaded treemap (hover a component to highlight its connections)
npx repo-mapper path/to/repo --type cascaded --out map.html

# structured data used to draw the treemap
npx repo-mapper . --format json --depth 2
```

| Option | Description |
| --- | --- |
| `-t, --type` | `nested` (default) or `cascaded` |
| `-f, --format` | `svg`, `html` or `json` (default: inferred from `--out`, else `svg`) |
| `-o, --out` | write to a file instead of stdout |
| `-w, --width`, `-H, --height` | size of the treemap (default 1200 × 800) |
| `-d, --depth` | collapse modules deeper than *n* directory levels |
| `-e, --ext` | comma separated extensions to map (default: JS/TS extensions) |
| `-x, --exclude` | comma separated directory names to exclude (in addition to `node_modules` etc.) |
| `--links` | draw the connections between components (always on in `html`) |
| `--no-git` | walk the file system instead of using `git ls-files` |

## Library

```js
import { mapRepository, render } from 'repo-mapper';

const { graph, tree } = mapRepository('path/to/repo', { maxDepth: 3 });
const svg = render(tree, { format: 'svg', type: 'cascaded', width: 1600, height: 1000 });
```

The pipeline is also available step by step:

| Function | Description |
| --- | --- |
| `buildDependencyGraph(root, options)` | file level graph: `{ files: [{ path, lines, imports, externalImports }], links: [{ source, target }] }` |
| `buildModuleTree(graph, { maxDepth })` | hierarchy of modules and components ordered by connectivity; every node has `id`, `name`, `type` (`module` / `component`), `value` (lines of code), `dependencies`, `dependents`, `connections`; `tree.links` holds the weighted links between the leaves |
| `computeTreemap(tree, { type, width, height })` | d3 treemap layout (`d3.hierarchy` + `d3.treemap` with the order preserving `d3.treemapBinary` tiling) |
| `renderSvg(tree, options)` / `renderHtml(tree, options)` | SVG document / standalone interactive HTML page |
| `orderByConnectivity(nodes, accessors)` | the ordering used to centre the most connected node and keep connected nodes adjacent |
| `extractImports(source)`, `resolveImport(from, specifier, fileSet, packages)` | import analysis helpers |
| `listRepositoryFiles(root, options)`, `scanRepository(root, options)` | repository scanning helpers |

Options shared by `mapRepository` / `buildDependencyGraph`: `extensions`,
`exclude`, `useGit` (default `true`).

## Development

```sh
npm install
npm test
```
