import { tierOf } from './graph.js';
import { distance } from './trail.js';
/** 射线法：点是否在多边形内（shape 顶点是世界坐标，首尾不必闭合） */
export function pointInPolygon(point, shape) {
    if (!Array.isArray(shape) || shape.length < 3)
        return false;
    let inside = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
        const [xi, yi] = shape[i];
        const [xj, yj] = shape[j];
        const crosses = yi > point[1] !== yj > point[1];
        if (!crosses)
            continue;
        const xAtY = ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
        if (point[0] < xAtY)
            inside = !inside;
    }
    return inside;
}
/** 鞋带公式取绝对面积；用于「点在多个大区内时取最小（最具体）的那个」 */
function polygonArea(shape) {
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
export function findTerritory(graph, node, xy) {
    let best = null;
    let bestArea = Infinity;
    for (const candidate of graph.toArray()) {
        if (candidate.kind !== 'region' && candidate.kind !== 'realm')
            continue;
        if (!Array.isArray(candidate.shape) || candidate.shape.length < 3)
            continue;
        if (!pointInPolygon(xy, candidate.shape))
            continue;
        const area = polygonArea(candidate.shape);
        if (area < bestArea) {
            bestArea = area;
            best = candidate;
        }
    }
    if (best && best.id !== node.id)
        return best;
    const chain = graph.ancestors(node.id);
    for (let index = chain.length - 1; index >= 0; index--) {
        const ancestor = chain[index];
        if (ancestor.kind === 'region' || ancestor.kind === 'realm')
            return ancestor;
    }
    return chain.length > 1 ? chain[chain.length - 2] : null;
}
function fmtCoord(value) {
    return String(Math.round(value * 10) / 10);
}
function fmtDist(value) {
    return value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}
/** 汇总「当前位置 + 地界 + 周边 + 规则」；没有可用数据时返回 null（调用方跳过注入） */
export function buildGeoContext(input) {
    const { graph, points } = input;
    if (!graph || graph.size === 0 || !points.length)
        return null;
    const ordered = [...points]
        .filter(point => !point.orphan)
        .sort((a, b) => (a.seq ?? a.messageId) - (b.seq ?? b.messageId));
    const last = ordered[ordered.length - 1];
    if (!last)
        return null;
    const node = graph.get(last.nodeId) ?? graph.resolve(last.path, { create: false })?.node ?? null;
    if (!node)
        return null;
    const hidden = new Set(input.hiddenIds ?? []);
    const exclude = new Set([node.id, ...graph.ancestors(node.id).map(item => item.id)]);
    // ── 周边：按直线距离取最近 N 个（排除自己、祖先链、隐藏、待定位）──
    const nearby = [];
    for (const candidate of graph.toArray()) {
        if (exclude.has(candidate.id) || hidden.has(candidate.id))
            continue;
        if (candidate.status !== 'ok')
            continue;
        nearby.push({ node: candidate, dist: distance(last.xy, candidate.xy) });
    }
    nearby.sort((a, b) => a.dist - b.dist);
    const picked = nearby.slice(0, Math.max(1, input.nearbyCount));
    // 保证视野里至少有一个大域/地域级的参照物（不然城内视角全是街道，模型没有方位感）
    if (!picked.some(item => tierOf(item.node) <= 2)) {
        const fallback = nearby.find(item => tierOf(item.node) <= 2 && !picked.includes(item));
        if (fallback)
            picked.push(fallback);
    }
    picked.sort((a, b) => a.dist - b.dist);
    // ── 位移异常：只看最近的两个活点；超限且不是已认定的 travel 才提示 ──
    let jump = null;
    const jumpLimit = input.jumpLimit ?? 150;
    if (input.jumpNotice && ordered.length >= 2) {
        const previous = ordered[ordered.length - 2];
        const gap = distance(previous.xy, last.xy);
        if (gap > jumpLimit && last.kind !== 'travel' && previous.kind !== 'travel')
            jump = gap;
    }
    const territory = findTerritory(graph, node, last.xy);
    const altitude = typeof node.altitude === 'number' && node.altitude !== 0 ? `，高度 ${node.altitude} 里` : '';
    const lines = [];
    lines.push('[地理态势]（世界舆图 · 本回合生效）');
    lines.push(`当前位置：${node.path} (${fmtCoord(last.xy[0])},${fmtCoord(last.xy[1])})${altitude}`);
    if (territory && territory.id !== node.id) {
        const gap = distance(last.xy, territory.xy);
        lines.push(`所在地界：${territory.path}${gap > 0.05 ? `（核心距此 ${fmtDist(gap)} 格）` : ''}`);
    }
    else {
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
    return { content, path: node.path, xy: [...last.xy], territory, nearby: picked, jump };
}
//# sourceMappingURL=geo-context.js.map