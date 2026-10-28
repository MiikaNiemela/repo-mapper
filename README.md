# repo-mapper

tool for creating structured visual maps of a git repositories

`repo-mapper` is a Node.js library (and CLI) that turns the structure of a git
repository into a [d3](https://github.com/d3/d3) **nested** or **cascaded
treemap**.

* The mapped items are the modules of the application only: directories are
  modules / sub-modules and source files are components. Imported libraries
  that are not implemented in the repository are excluded – `node_modules/`
  (and other vendored package folders) and `dist/` build output are never
  mapped, and files ignored by `.gitignore` are skipped.
* The connections between modules are found by analysing the JavaScript and
  TypeScript imports (`import`, `export … from`, `require()`, `import()`),
  including TypeScript `.js` → `.ts` imports and imports of packages that are
  implemented in the repository (monorepo workspaces). Resolution understands
  `tsconfig.json` / `jsconfig.json` `baseUrl` and `paths`, package
  `imports`, declarative Jest aliases, and explicit aliases.
* Closely connected modules are placed next to each other, and the module with
  the most connections (or, on a tie, the one declaring the most
  dependencies) is placed at the logical centre of its parent.

## Installation

```sh
npm install @miikaniemela/repo-mapper
```

## CLI

```sh
npx @miikaniemela/repo-mapper [directory] [options]

# nested treemap as SVG on stdout
npx @miikaniemela/repo-mapper . > map.svg

# interactive cascaded treemap (hover a component to highlight its connections)
npx @miikaniemela/repo-mapper path/to/repo --type cascaded --out map.html

# structured data used to draw the treemap
npx @miikaniemela/repo-mapper . --format json --depth 2
```

| Option | Description |
| --- | --- |
| `-t, --type` | `nested` (default) or `cascaded` |
| `-f, --format` | `svg`, `html` or `json` (default: inferred from `--out`, else `svg`) |
| `-o, --out` | write to a file instead of stdout |
| `-w, --width`, `-H, --height` | size of the treemap (default 1200 × 800) |
| `-d, --depth` | collapse modules deeper than *n* directory levels |
| `-e, --ext` | comma separated extensions to map (default: JS/TS extensions) |
| `--alias` | import alias in `find=replacement` form; repeat for multiple ordered rules (for example `--alias '@/*=src/*'`) |
| `--only` | include only comma separated file categories: `code`, `test`, `config`, `types`, `story`, `generated` |
| `--skip` | exclude comma separated file categories |
| `--include` | include comma separated globs matched against repo-relative paths |
| `--ignore` | exclude comma separated globs matched against repo-relative paths |
| `-x, --exclude` | comma separated directory names or repo-relative directory paths (in addition to `node_modules` etc.) |
| `--links` | draw the connections between components (always on in `html`) |
| `--no-git` | walk the file system instead of using `git ls-files` |

Filtering uses always-active built-in rules for common tools:

| Category | Built-in matches |
| --- | --- |
| `test` | Jest/Vitest `*.test.*` and `*.spec.*` files, `__tests__`, `__mocks__`, `test`, `tests`, Playwright `e2e`, and Cypress directories |
| `config` | Jest, Vitest, Playwright, Cypress, ESLint, Prettier, TypeScript/JavaScript, Vite, Webpack, Rollup, Babel, and Next.js config files |
| `types` | TypeScript declaration files (`*.d.ts`, `*.d.mts`, `*.d.cts`) |
| `story` | Storybook `*.stories.*` files and `.storybook` directories |
| `generated` | `*.generated.*`, `*.gen.*`, and files in `generated` directories |
| `code` | any selected file not matched by a more specific category |

For example:

```sh
repo-mapper . --only code
repo-mapper . --skip test,config
repo-mapper . --include 'src/**,packages/*/src/**' --ignore '**/*.generated.ts,**/fixtures/**'
repo-mapper . --exclude packages/legacy
```

The filtering order is extensions, `include`, `ignore`, then `only`/`skip`.
Exclusions win: an included file is still removed when it matches `ignore` or
`skip`. An `--exclude` value containing `/` matches that exact directory from
the repository root and its descendants; a plain name keeps the previous
behavior of matching that name in any path segment.

### Committed configuration

Filtering defaults can be committed in the root `package.json` under
`repoMapper`, in `repo-mapper.config.json`, or both:

```json
{
  "extensions": [".ts", ".tsx"],
  "skip": ["test", "config"],
  "include": ["src/**", "packages/*/src/**"],
  "ignore": ["**/*.generated.ts"],
  "exclude": ["packages/legacy"]
}
```

Precedence is defaults, `package.json#repoMapper`,
`repo-mapper.config.json`, then explicit library options or CLI flags. Arrays
replace the same lower-precedence option rather than being appended. Repository
discovery and `.gitignore` handling run before source filtering, so package,
TypeScript, and Jest configuration discovery still sees config files omitted
from the diagram.

## Library

```js
import { mapRepository, render } from '@miikaniemela/repo-mapper';

const { graph, tree } = mapRepository('path/to/repo', {
  maxDepth: 3,
  only: ['code'],
  include: ['src/**'],
  ignore: ['**/*.generated.ts'],
});
const svg = render(tree, { format: 'svg', type: 'cascaded', width: 1600, height: 1000 });
```

The pipeline is also available step by step:

| Function | Description |
| --- | --- |
| `buildDependencyGraph(root, options)` | file level graph: `{ files: [{ path, lines, imports, externalImports }], links: [{ source, target }], warnings }` |
| `buildModuleTree(graph, { maxDepth })` | hierarchy of modules and components ordered by connectivity; every node has `id`, `name`, `type` (`module` / `component`), `value` (lines of code), `dependencies`, `dependents`, `connections`; `tree.links` holds the weighted links between the leaves |
| `computeTreemap(tree, { type, width, height })` | d3 treemap layout (`d3.hierarchy` + `d3.treemap` with the order preserving `d3.treemapBinary` tiling) |
| `renderSvg(tree, options)` / `renderHtml(tree, options)` | SVG document / standalone interactive HTML page |
| `orderByConnectivity(nodes, accessors)` | the ordering used to centre the most connected node and keep connected nodes adjacent |
| `extractImports(source)`, `resolveImport(from, specifier, fileSet, packages)` | import analysis helpers |
| `listRepositoryFiles(root, options)`, `scanRepository(root, options)` | repository scanning helpers |

Filtering options shared by `mapRepository`, `buildDependencyGraph`, and
`scanRepository` are `extensions`, `exclude`, `include`, `ignore`, `only`, and
`skip`. `mapRepository` / `buildDependencyGraph` also accept `useGit` (default
`true`) and ordered
`aliases: [{ find, replacement }]`. Alias rules support exact matches or one
`*` on each side. Relative replacements are resolved from the repository root.
`FILE_CATEGORIES` and `fileCategory(path)` are exported for consumers that need
the built-in category names or classification.

`buildDependencyGraph()` also returns `warnings`, an array of structured
`{ code, message, path? }` configuration warnings. The library does not write
these warnings to the console; the CLI prints them to stderr and continues.

### Import resolution

For JavaScript and TypeScript files, repository-local imports are resolved in
this order:

1. relative imports;
2. explicit `aliases` / `--alias` rules;
3. the nearest `tsconfig.json` or `jsconfig.json` `paths` and `baseUrl`;
4. the importing package's `package.json` `imports`;
5. packages implemented in the repository.

Config files may contain JSON comments and trailing commas. Relative and npm
package `extends` chains are supported. The nearest `tsconfig.json` takes
precedence over `jsconfig.json` when both are in the same directory.

Jest `moduleNameMapper` aliases are read from each package's `package.json` or
from `jest.config.json` (which takes precedence). Anchored exact patterns and
one `(.*)` capture are supported. Dynamic configuration is deliberately never
executed: `vite.config.*`, `webpack.config.*`, and JavaScript/TypeScript Jest
configs are not loaded. Use `aliases` or `--alias` for those tools.

Only JavaScript and TypeScript syntax is currently analysed for connections.
Passing other extensions with `--ext` maps those files as boxes but does not
infer their imports. The analyser registry is internal for now, and the default
extension set remains JavaScript and TypeScript.

## Development

```sh
npm install
npm test
```
