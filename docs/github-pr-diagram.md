# Pull request repository map in GitHub Actions

This example adds a cascaded repository map to the end of every pull request
description and refreshes it whenever new commits are pushed. Modules are
colored as follows:

| Color | Meaning |
| --- | --- |
| Green, `rgb(28, 129, 57)` | Modules or components edited by the pull request |
| Blue, `rgb(9, 105, 218)` | Modules or components affected by the edits because they import an edited file directly or transitively |

Edited takes precedence when a node is both edited and affected. Unchanged
nodes use a neutral background.

## How it works

1. The workflow checks out the pull request head with the full history.
2. A Node.js script maps the repository with `mapRepository`, compares the
   pull request head with its base, and walks the import graph backwards to
   find affected files.
3. `renderSvg` draws a cascaded treemap with styles for the edited and affected
   nodes.
4. The SVG is committed to a separate `repo-mapper-diagrams` branch so the pull
   request description can display it as an image.
5. The workflow replaces the previous repository map section and moves it to the
   end of the pull request description.

## Setup

Add the script below to `.github/scripts/repo-map-pr.mjs` in the repository
that will be mapped. The workflow installs `@miikaniemela/repo-mapper` into a
temporary directory so the mapped project's dependencies are left unchanged.

```js
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EDITED_FILL = 'rgb(28, 129, 57)';
const AFFECTED_FILL = 'rgb(9, 105, 218)';

const { BASE_SHA, HEAD_SHA, OUTPUT, REPO_MAPPER_PREFIX, REPO_MAPPER_DEPTH } = process.env;
for (const [name, value] of Object.entries({ BASE_SHA, HEAD_SHA, OUTPUT, REPO_MAPPER_PREFIX })) {
  if (!value) throw new Error(`${name} is required`);
}

const requireFromPrefix = createRequire(path.join(REPO_MAPPER_PREFIX, 'package.json'));
const entry = requireFromPrefix.resolve('@miikaniemela/repo-mapper');
const { mapRepository, renderSvg } = await import(pathToFileURL(entry).href);

const maxDepth = REPO_MAPPER_DEPTH ? Number(REPO_MAPPER_DEPTH) : undefined;
const { graph, tree } = mapRepository('.', { maxDepth });

const mappedFiles = new Set(graph.files.map((file) => file.path));
const editedFiles = new Set(
  execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMRT', `${BASE_SHA}...${HEAD_SHA}`],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => mappedFiles.has(file)),
);

const importers = new Map();
for (const { source, target } of graph.links) {
  if (!importers.has(target)) importers.set(target, []);
  importers.get(target).push(source);
}

const affectedFiles = new Set();
const queue = [...editedFiles];
while (queue.length) {
  for (const importer of importers.get(queue.shift()) ?? []) {
    if (affectedFiles.has(importer) || editedFiles.has(importer)) continue;
    affectedFiles.add(importer);
    queue.push(importer);
  }
}

// With REPO_MAPPER_DEPTH, deep files are represented by their collapsed module.
const nodeIds = new Set();
const collectIds = (node) => {
  nodeIds.add(node.id);
  node.children?.forEach(collectIds);
};
collectIds(tree);
const nodeIdForFile = (file) => {
  const segments = file.split('/');
  for (let length = segments.length; length > 0; length -= 1) {
    const id = segments.slice(0, length).join('/');
    if (nodeIds.has(id)) return id;
  }
  throw new Error(`No diagram node found for ${file}`);
};

const editedIds = new Set([...editedFiles].map(nodeIdForFile));
const affectedIds = new Set(
  [...affectedFiles].map(nodeIdForFile).filter((id) => !editedIds.has(id)),
);

const svg = renderSvg(tree, {
  type: 'cascaded',
  width: 1200,
  height: 800,
  styles: {
    module: { fill: '#ffffff', stroke: '#d0d7de' },
    component: { fill: '#f6f8fa', stroke: '#d0d7de' },
    nodes: [
      ...[...editedIds].map((id) => ({ id, fill: EDITED_FILL })),
      ...[...affectedIds].map((id) => ({ id, fill: AFFECTED_FILL })),
    ],
  },
});

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, svg);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `edited=${editedIds.size}\naffected=${affectedIds.size}\n`);
}
console.log(`Rendered ${editedIds.size} edited and ${affectedIds.size} affected diagram nodes.`);
```

Then add `.github/workflows/repo-map.yml`:

```yaml
name: Repository map

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

permissions:
  contents: write
  packages: read
  pull-requests: write

concurrency:
  group: repo-map-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  repo-map:
    # Pull requests from forks receive a read-only token and cannot update the PR.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://npm.pkg.github.com
          scope: '@miikaniemela'

      - name: Install repo-mapper
        run: npm install --prefix "$RUNNER_TEMP/repo-mapper" @miikaniemela/repo-mapper
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Render repository map
        id: render
        run: node .github/scripts/repo-map-pr.mjs
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          OUTPUT: ${{ runner.temp }}/repo-map/pr.svg
          REPO_MAPPER_PREFIX: ${{ runner.temp }}/repo-mapper
          # Optional: collapse deeper directories in large repositories.
          # REPO_MAPPER_DEPTH: '3'

      - name: Publish diagram
        id: publish
        env:
          BRANCH: repo-mapper-diagrams
          FILE: pr-${{ github.event.pull_request.number }}.svg
          SOURCE: ${{ runner.temp }}/repo-map/pr.svg
          WORKTREE: ${{ runner.temp }}/repo-mapper-diagrams
        run: |
          set -euo pipefail
          git config --global user.name 'github-actions[bot]'
          git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'

          if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null; then
            git fetch --depth=1 origin "$BRANCH"
            git worktree add --detach "$WORKTREE" FETCH_HEAD
          else
            git worktree add --detach "$WORKTREE"
            git -C "$WORKTREE" checkout --orphan "$BRANCH"
            git -C "$WORKTREE" rm -rf --quiet .
          fi

          cp "$SOURCE" "$WORKTREE/$FILE"
          git -C "$WORKTREE" add "$FILE"
          if git -C "$WORKTREE" rev-parse --verify HEAD >/dev/null 2>&1 &&
            git -C "$WORKTREE" diff --cached --quiet; then
            echo "sha=$(git -C "$WORKTREE" rev-parse HEAD)" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          git -C "$WORKTREE" commit --quiet -m "Update repository map for $FILE"
          for attempt in 1 2 3; do
            if git -C "$WORKTREE" push origin "HEAD:refs/heads/$BRANCH"; then
              echo "sha=$(git -C "$WORKTREE" rev-parse HEAD)" >> "$GITHUB_OUTPUT"
              exit 0
            fi
            # Another pull request may have published its own diagram first.
            git -C "$WORKTREE" fetch origin "$BRANCH"
            git -C "$WORKTREE" rebase FETCH_HEAD
          done
          echo 'Could not publish the repository map' >&2
          exit 1

      - name: Update pull request description
        uses: actions/github-script@v7
        env:
          AFFECTED: ${{ steps.render.outputs.affected }}
          DIAGRAM_SHA: ${{ steps.publish.outputs.sha }}
          EDITED: ${{ steps.render.outputs.edited }}
        with:
          script: |
            const start = '<!-- repo-mapper:start -->';
            const end = '<!-- repo-mapper:end -->';
            const { owner, repo } = context.repo;
            const pull_number = context.payload.pull_request.number;
            const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number });

            const image = `https://github.com/${owner}/${repo}/blob/${process.env.DIAGRAM_SHA}/pr-${pull_number}.svg?raw=true`;
            const section = [
              start,
              '## Repository map',
              '',
              `![Cascaded repository map showing edited and affected modules](${image})`,
              '',
              `🟩 Edited: ${process.env.EDITED} · 🟦 Affected: ${process.env.AFFECTED}`,
              end,
            ].join('\n');

            const body = pr.body ?? '';
            const existing = new RegExp(`\\s*${start}[\\s\\S]*?${end}\\s*`, 'g');
            const withoutMap = body.replace(existing, '\n\n').trim();
            const nextBody = withoutMap ? `${withoutMap}\n\n${section}` : section;

            if (nextBody !== body) {
              await github.rest.pulls.update({ owner, repo, pull_number, body: nextBody });
            }
```

## Notes

* The workflow fetches the current pull request description immediately before
  updating it, so edits made while the diagram was rendering are preserved.
  Only the section between the `repo-mapper` markers is replaced.
* The diagram reflects mapped source files. Files excluded by `.gitignore`,
  committed `repo-mapper` configuration, extensions, or file categories are not
  colored. Deleted files are not colored because they no longer exist in the
  pull request head.
* The image URL points to the diagrams branch commit, so a refreshed diagram
  does not reuse an older cached image.
* `repo-mapper-diagrams` stores one SVG per pull request. Add a cleanup job if
  diagrams for closed pull requests should be removed.
* If the package is consumed from another repository or organization, grant
  that workflow read access to the GitHub Packages package.
