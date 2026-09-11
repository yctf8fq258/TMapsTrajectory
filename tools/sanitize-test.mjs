/**
 * 底图清洗自测：把"老版本可能存下来的脏底图"喂给 sanitizeNodes，检查
 *   · 方位词节点（东南部/东南方…）被剔除且子节点上提
 *   · 仙界子树被整棵剔除
 *   · 上提之后产生的同名同路径重复点被合并
 * 用法：node tools/sanitize-test.mjs
 */
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileDir } from './transpile.mjs';

const root = process.cwd();
transpileDir(nodePath.join(root, 'src'), nodePath.join(root, 'dist'));

const dist = nodePath.join(root, 'dist', 'worldmap');
const { MapGraph, sanitizeNodes } = await import(pathToFileURL(nodePath.join(dist, 'graph.js')).href);

const mk = (p, x, y, kind, locked) => {
  const segments = p.split('·');
  return {
    id: 'x' + p,
    name: segments[segments.length - 1],
    path: p,
    parentId: null,
    depth: segments.length - 1,
    xy: [x, y],
    kind,
    locked: Boolean(locked),
    source: 'seed',
    status: 'ok',
  };
};

const rows = [
  mk('中央神州', 500, 500, 'region', true),
  mk('中央神州·东南部', 525, 530, 'region', false),
  mk('中央神州·东南部·百花坊', 525, 530, 'city', false),
  mk('中央神州·百花坊', 525, 530, 'city', true),
  mk('中央神州·东南方', 558, 557, 'region', false),
  mk('中央神州·东南方·万法宗', 558.4, 556.5, 'power', false),
  mk('中央神州·万法宗', 557, 557, 'power', true),
  mk('钧天仙域', 400, 160, 'realm', false),
  mk('钧天仙域·凌霄仙阙', 400, 160, 'city', false),
];

const byPath = new Map(rows.map(row => [row.path, row]));
for (const row of rows) {
  const segments = row.path.split('·');
  if (segments.length > 1) {
    const parent = byPath.get(segments.slice(0, -1).join('·'));
    row.parentId = parent ? parent.id : null;
  }
}

const { nodes, report } = sanitizeNodes(rows);
console.log('清洗报告：', JSON.stringify(report));
console.log('剩余节点：');
for (const node of [...nodes].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))) {
  console.log(`  ${'  '.repeat(node.depth)}${node.name}  [${node.xy}]  path=${node.path}  locked=${node.locked}`);
}

const graph = new MapGraph(nodes);
const checks = [
  ['方位节点「东南部」已剔除', !nodes.some(node => node.name === '东南部')],
  ['方位节点「东南方」已剔除', !nodes.some(node => node.name === '东南方')],
  ['仙界整棵子树已剔除', !nodes.some(node => node.path.includes('仙域'))],
  ['百花坊上提到了中央神州下', Boolean(graph.byPath.get('中央神州·百花坊'))],
  ['万法宗上提到了中央神州下', Boolean(graph.byPath.get('中央神州·万法宗'))],
  ['同名同路径没有重复', nodes.filter(node => node.path === '中央神州·百花坊').length === 1],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exitCode = failed ? 1 : 0;
