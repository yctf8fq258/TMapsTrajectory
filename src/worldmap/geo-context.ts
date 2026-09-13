/**
 * [地理态势]：每回合按当前坐标**现算**一小段上下文，经 injectPrompts 注入模型。
 *
 * 为什么不放世界书：态势块逐回合都变（跟着位置走），放世界书就得每回合 replaceWorldbook
 * 重写整本书；注入是内存态、零文件写入，刷新（uninject + inject）即生效。
 *
 * 叙事强度 L1（用户已拍板）：地理事实 + 地界规则 + 位移异常提示。
 * 只说事实模型不一定用（万法宗的弟子照样会出现在蜀山山道），所以加一条
 * 「非本地势力公开活动需有理由」的最小干预；位移提示只在异常回合出现，正常回合零成本。
 */
import type { MapNode, TrailPoint, Vec2 } from './types.js';
import { MapGraph, tierOf } from './graph.js';
import { distance } from './trail.js';

export interface GeoContextInput {
  graph: MapGraph;
  /** 全部轨迹点（内部自己按 seq 取最新的活点） */
  points: TrailPoint[];
  nearbyCount: number;
  enforceBounds: boolean;
  jumpNotice: boolean;
  /** 位移异常阈值，默认 150（与轨迹重建的 jumpLimit 一致） */
  jumpLimit?: number;
  hiddenIds?: string[];
}

export interface GeoContextResult {
  content: string;
  path: string;
  xy: Vec2;
  /** 地界归属节点（可能是「点在其中」的大区，也可能是路径祖先） */
  territory: MapNode | null;
  nearby: { node: MapNode; dist: number }[];
  /** 位移异常值（格），无异常为 null */
  jump: number | null;
}

/** 射线法：点是否在多边形内（shape 顶点是世界坐标，首尾不必闭合） */
export function pointInPolygon(point: Vec2, shape: Vec2[]): boolean {
  if (!Array.isArray(shape) || shape.length < 3) return false;
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi, yi] = shape[i];
    const [xj, yj] = shape[j];
    const crosses = yi > point[1] !== yj > point[1];
    if (!crosses) continue;
    const xAtY = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (point[0] < xAtY) inside = !inside;
  }
  return inside;
}

/** 鞋带公式取绝对面积；用于「点在多个大区内时取最小（最具体）的那个」 */
function polygonArea(shape: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    sum += shape[j][0] * shape[i][1] - shape[i][0] * shape[j][1];
  }
  return Math.abs(sum) / 2;
}

/**
 * 地界归属：优先「点在哪个带 shape 的大区里」（取面积最小的，即最具体的一层）；
 * 没有命中的 shape，就沿路径向上找最近的 region/realm 祖先；再没有就退到根祖先。
 */
export function findTerritory(graph: MapGraph, node: MapNode, xy: Vec2): MapNode | null {
  let best: MapNode | null = null;
  let bestArea = Infinity;
  for (const candidate of graph.toArray()) {
    if (candidate.kind !== 'region' && candidate.kind !== 'realm') continue;
    if (!Array.isArray(candidate.shape) || candidate.shape.length < 3) continue;
    if (!pointInPolygon(xy, candidate.shape)) continue;
    const area = polygonArea(candidate.shape);
    if (area < bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  if (best && best.id !== node.id) return best;
  const chain = graph.ancestors(node.id);
  for (let index = chain.length - 1; index >= 0; index--) {
    const ancestor = chain[index];
    if (ancestor.kind === 'region' || ancestor.kind === 'realm') return ancestor;
  }
  return chain.length > 1 ? chain[chain.length - 2] : null;
}

function fmtCoord(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function fmtDist(value: number): string {
  return value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}

/** 汇总「当前位置 + 地界 + 周边 + 规则」；没有可用数据时返回 null（调用方跳过注入） */
export function buildGeoContext(input: GeoContextInput): GeoContextResult | null {
  const { graph, points } = input;
  if (!graph || graph.size === 0 || !points.length) return null;
  const ordered = [...points]
    .filter(point => !point.orphan)
    .sort((a, b) => (a.seq ?? a.messageId) - (b.seq ?? b.messageId));
  const last = ordered[ordered.length - 1];
  if (!last) return null;
  const node = graph.get(last.nodeId) ?? graph.resolve(last.path, { create: false })?.node ?? null;
  if (!node) return null;
  const hidden = new Set(input.hiddenIds ?? []);
  const exclude = new Set<string>([node.id, ...graph.ancestors(node.id).map(item => item.id)]);

  // ── 周边：按直线距离取最近 N 个（排除自己、祖先链、隐藏、待定位）──
  const nearby: { node: MapNode; dist: number }[] = [];
  for (const candidate of graph.toArray()) {
    if (exclude.has(candidate.id) || hidden.has(candidate.id)) continue;
    if (candidate.status !== 'ok') continue;
    nearby.push({ node: candidate, dist: distance(last.xy, candidate.xy) });
  }
  nearby.sort((a, b) => a.dist - b.dist);
  const picked = nearby.slice(0, Math.max(1, input.nearbyCount));
  // 保证视野里至少有一个大域/地域级的参照物（不然城内视角全是街道，模型没有方位感）
  if (!picked.some(item => tierOf(item.node) <= 2)) {
    const fallback = nearby.find(item => tierOf(item.node) <= 2 && !picked.includes(item));
    if (fallback) picked.push(fallback);
  }
  picked.sort((a, b) => a.dist - b.dist);

  // ── 位移异常：只看最近的两个活点；超限且不是已认定的 travel 才提示 ──
  let jump: number | null = null;
  const jumpLimit = input.jumpLimit ?? 150;
  if (input.jumpNotice && ordered.length >= 2) {
    const previous = ordered[ordered.length - 2];
    const gap = distance(previous.xy, last.xy);
    if (gap > jumpLimit && last.kind !== 'travel' && previous.kind !== 'travel') jump = gap;
  }

  const territory = findTerritory(graph, node, last.xy);
  const altitude = typeof node.altitude === 'number' && node.altitude !== 0 ? `，高度 ${node.altitude} 里` : '';
  const lines: string[] = [];
  lines.push('[地理态势]（世界舆图 · 本回合生效）');
  lines.push(`当前位置：${node.path} (${fmtCoord(last.xy[0])},${fmtCoord(last.xy[1])})${altitude}`);
  if (territory && territory.id !== node.id) {
    const gap = distance(last.xy, territory.xy);
    lines.push(`所在地界：${territory.path}${gap > 0.05 ? `（核心距此 ${fmtDist(gap)} 格）` : ''}`);
  } else {
    lines.push(`所在地界：${territory ? territory.path : node.path}`);
  }
  if (picked.length) {
    lines.push(`周边：${picked.map(item => `${item.node.name}(${fmtCoord(item.node.xy[0])},${fmtCoord(item.node.xy[1])}) ${fmtDist(item.dist)}`).join('｜')}`);
    lines.push('（单位：坐标格；1 坐标格 ≈ 15 亿里）');
  }
  if (input.enforceBounds) {
    lines.push('地界规则：非本地势力成员在此公开活动需有明确理由（追捕/战事/受邀/隐匿行踪）；本地遭遇的人物优先来自本地势力与邻近聚落。');
  }
  if (jump !== null) {
    lines.push(`[位移提示] 上一回合至此位移 ${fmtDist(jump)} 格，属远行 —— 请在正文交代耗时/乘骑/传送，或修正坐标。`);
  }
  const content = lines.join('\n');
  return { content, path: node.path, xy: [...last.xy] as Vec2, territory, nearby: picked, jump };
}
