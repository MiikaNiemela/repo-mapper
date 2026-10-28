import { hierarchy, treemap, treemapBinary } from 'd3';

export const TREEMAP_TYPES = Object.freeze(['nested', 'cascaded']);

/** Height reserved at the top of every module for its label. */
export const LABEL_HEIGHT = 19;
/** Offset of each cascade level in cascaded treemaps. */
export const CASCADE_OFFSET = 6;

/**
 * Lays out a module tree with d3's treemap.
 *
 * The sibling order produced by `buildModuleTree` is kept (no sorting) and
 * tiled with `d3.treemapBinary`, which preserves order and splits it in two
 * balanced halves recursively. Because the most connected module is in the
 * middle of the order it ends up next to the central split line, i.e. at the
 * logical centre of its parent, surrounded by the modules it is most
 * connected with.
 *
 * @param {object} tree output of `buildModuleTree`
 * @param {{ type?: 'nested' | 'cascaded', width?: number, height?: number }} [options]
 * @returns {import('d3').HierarchyRectangularNode<object>}
 */
export function computeTreemap(tree, options = {}) {
  const { type = 'nested', width = 1200, height = 800 } = options;
  if (!TREEMAP_TYPES.includes(type)) {
    throw new Error(`Unknown treemap type "${type}", expected one of: ${TREEMAP_TYPES.join(', ')}`);
  }
  const root = hierarchy(tree, (d) => d.children).sum((d) => (d.children ? 0 : d.value));
  const layout = treemap().tile(treemapBinary).size([width, height]).round(true);
  if (type === 'nested') {
    layout.paddingOuter(3).paddingTop(LABEL_HEIGHT).paddingInner(1);
  } else {
    layout
      .paddingTop(LABEL_HEIGHT)
      .paddingLeft(CASCADE_OFFSET)
      .paddingRight(3)
      .paddingBottom(3)
      .paddingInner(3);
  }
  return layout(root);
}
