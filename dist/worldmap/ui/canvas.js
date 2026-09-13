import { ALTITUDE_OFFSET_PX, COLLAPSE_PX, COORD_MAX, COORD_MIN, TIER_FONT_PX, TIER_HIDE_ABOVE_SCALE, TIER_LABEL_SCALE, TIER_RADIUS_PX, TIER_VISIBLE_SCALE, tierOfKind, } from '../types.js';
import { tierOf } from '../graph.js';
import { polylinePoints } from '../trail.js';
import { COMPASS, ICONS, KIND_COLORS, KIND_LABELS, escapeHtml } from './theme.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 自动推算区域轮廓时往外撑开的世界单位（1 单位 ≈ 15 亿里） */
const REGION_PAD = 14;
/** 单调链求凸包（逆时针）。点不足 3 个时原样返回。 */
function convexHull(points) {
    if (points.length < 3)
        return [...points];
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
            lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
            upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}
/** 沿「从重心往外」的方向把多边形撑开一点，免得轮廓线压在节点上 */
function padPolygon(polygon, margin) {
    if (polygon.length < 3)
        return polygon;
    const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
    const cy = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
    return polygon.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return [x + (dx / len) * margin, y + (dy / len) * margin];
    });
}
function el(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value));
    return node;
}
export class MapCanvas {
    wrap;
    hooks;
    svg;
    layer;
    linkLayer;
    regionLayer;
    trailLayer;
    nodeLayer;
    overlay;
    view;
    scale = 1;
    tx = 0;
    ty = 0;
    drag = null;
    suppressClick = false;
    offsets = new Map();
    connectors = [];
    drawn = [];
    childCount = new Map();
    /** 编辑模式下的框选集合（多选的节点 id）；Shift+拖空白框选，抓住其中一点整组移动 */
    multi = new Set();
    /** 框选模式开关：开着时空白处拖动一律是框选（不用按 Shift） */
    boxSelectMode = false;
    /** 框选橡皮筋矩形（svg 本地屏幕坐标） */
    rubber = null;
    /** 框选模式开关 */
    setBoxSelect(value) {
        this.boxSelectMode = value;
        this.updateCursor();
    }
    /** 光标三态互斥：框选模式空闲=箭头；平移/拖点=抓手；框选拖动=十字 */
    updateCursor() {
        const svg = this.svg;
        svg.classList.toggle('dym-boxselect', this.boxSelectMode && !this.drag);
        svg.classList.toggle('dym-panning', Boolean(this.drag) && this.drag?.mode !== 'rubber');
        svg.classList.toggle('dym-editing', this.drag?.mode === 'rubber');
    }
    /** 顶部中间的坐标条：显示当前选中点的名称 + 坐标（没选中就藏起来） */
    hud;
    constructor(wrap, hooks, view) {
        this.wrap = wrap;
        this.hooks = hooks;
        this.view = view;
        this.svg = el('svg', { class: 'dym-svg' });
        this.layer = el('g');
        this.regionLayer = el('g');
        this.linkLayer = el('g');
        this.trailLayer = el('g');
        this.nodeLayer = el('g');
        this.overlay = el('g');
        this.layer.append(this.regionLayer, this.linkLayer, this.trailLayer, this.nodeLayer);
        this.svg.append(this.layer, this.overlay);
        wrap.appendChild(this.svg);
        this.hud = wrap.ownerDocument.createElement('div');
        this.hud.className = 'dym-hud';
        this.hud.style.display = 'none';
        wrap.appendChild(this.hud);
        this.bind();
    }
    setView(partial) {
        this.view = { ...this.view, ...partial };
    }
    getView() {
        return this.view;
    }
    size() {
        const rect = this.wrap.getBoundingClientRect();
        return { w: Math.max(80, rect.width), h: Math.max(80, rect.height) };
    }
    // ── 相机 ────────────────────────────────────────────────────────────
    applyTransform() {
        this.layer.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
    }
    screenToWorld(clientX, clientY) {
        const rect = this.svg.getBoundingClientRect();
        return [(clientX - rect.left - this.tx) / this.scale, (clientY - rect.top - this.ty) / this.scale];
    }
    worldToScreen(xy) {
        return [xy[0] * this.scale + this.tx, xy[1] * this.scale + this.ty];
    }
    zoomBy(factor, anchorClientX, anchorClientY) {
        const { w, h } = this.size();
        const ax = anchorClientX ?? w / 2;
        const ay = anchorClientY ?? h / 2;
        const next = Math.max(0.2, Math.min(400, this.scale * factor));
        const wx = (ax - this.tx) / this.scale;
        const wy = (ay - this.ty) / this.scale;
        this.scale = next;
        this.tx = ax - wx * this.scale;
        this.ty = ay - wy * this.scale;
        this.render();
    }
    getScale() {
        return this.scale;
    }
    fit(ids) {
        const { w, h } = this.size();
        const nodes = ids?.length
            ? ids.map(id => this.view.graph.get(id)).filter(Boolean)
            : this.view.graph.toArray().filter(node => node.depth <= 2);
        const bounds = this.view.graph.bounds(nodes.map(node => node.id));
        const bw = Math.max(6, bounds.maxX - bounds.minX);
        const bh = Math.max(6, bounds.maxY - bounds.minY);
        this.scale = Math.max(0.2, Math.min(400, Math.min((w * 0.84) / bw, (h * 0.84) / bh)));
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        this.tx = w / 2 - cx * this.scale;
        this.ty = h / 2 - cy * this.scale;
        this.render();
    }
    focusOn(id) {
        if (!id) {
            this.fit();
            return;
        }
        const node = this.view.graph.get(id);
        if (!node) {
            this.fit();
            return;
        }
        const descendants = this.view.graph.descendants(id);
        if (descendants.length >= 2) {
            this.fit([id, ...descendants.map(item => item.id)]);
        }
        else {
            const { w, h } = this.size();
            this.scale = Math.max(this.scale, 26);
            this.tx = w / 2 - node.xy[0] * this.scale;
            this.ty = h / 2 - node.xy[1] * this.scale;
            this.render();
        }
    }
    /** 默认视图：优先聚焦当前剧情舞台的顶层节点，其次中央神州，再次子节点最多的根节点 */
    fitStage() {
        const currentId = this.view.currentPath ? this.view.graph.byPath.get(this.view.currentPath)?.id : null;
        const chain = currentId ? this.view.graph.ancestors(currentId) : [];
        let stage = chain[0];
        if (!stage)
            stage = this.view.graph.byPath.get('中央神州');
        if (!stage) {
            let best;
            let bestCount = -1;
            for (const node of this.view.graph.children(null)) {
                const count = this.view.graph.descendants(node.id).length;
                if (count > bestCount) {
                    best = node;
                    bestCount = count;
                }
            }
            stage = best;
        }
        if (stage)
            this.focusOn(stage.id);
        else
            this.fit();
    }
    // ── 垂直重叠：把带高度的点挪到旁边并记下虚线 ──────────────────────────
    computeOffsets() {
        this.offsets = new Map();
        this.connectors = [];
        const groups = new Map();
        for (const node of this.view.graph.toArray()) {
            if (this.view.hiddenNodeIds.has(node.id))
                continue;
            const key = `${Math.round(node.xy[0] * 2)}:${Math.round(node.xy[1] * 2)}`;
            const list = groups.get(key);
            if (list)
                list.push(node);
            else
                groups.set(key, [node]);
        }
        const pixel = ALTITUDE_OFFSET_PX / Math.max(0.28, this.scale);
        for (const [, group] of groups) {
            if (group.length < 2)
                continue;
            const base = group.find(node => !node.altitude) ?? group[0];
            const alts = group.filter(node => node !== base && node.altitude);
            alts.forEach((node, index) => {
                const rank = Math.floor(index / 2) + 1;
                const side = index % 2 === 0 ? 1 : -1;
                const pos = [node.xy[0] + side * pixel * rank, node.xy[1] + (index % 2 === 1 ? pixel * 0.42 : 0)];
                this.offsets.set(node.id, pos);
                this.connectors.push({ from: base.xy, to: pos });
            });
            for (const node of group)
                if (!this.offsets.has(node.id))
                    this.offsets.set(node.id, node.xy);
        }
    }
    /** 节点的实际绘制坐标（含高度偏移） */
    worldPos(node) {
        return this.offsets.get(node.id) ?? node.xy;
    }
    /**
     * 轨迹落点：默认把市级以内（tier 4/5，比如某某客房、水井、马厩）的点**归并到它最近的市级祖先**，
     * 否则在客栈里走两步就画出一张蜘蛛网。关掉「轨迹只到市级」开关就恢复逐点绘制。
     * 返回 null = 这个点的节点在底图里已经找不到（被清空/重建/换会话后 id 失联），
     * 画线时必须在此断开 —— 否则按陈旧坐标硬画会连出一条指向空地的幻影长线。
     */
    trailNode(point) {
        const graph = this.view.graph;
        const node = graph.get(point.nodeId);
        if (node)
            return node;
        // 自愈：底图重建后 id 会变，但 path 没变就还能认领回来
        if (!point.path)
            return null;
        return graph.byPath.get(point.path) ?? null;
    }
    trailPos(point) {
        const graph = this.view.graph;
        const node = this.trailNode(point);
        if (!node)
            return null;
        if (this.view.trailCityOnly) {
            let cursor = node;
            const guard = new Set();
            while (cursor.parentId && tierOf(cursor) > 3 && !guard.has(cursor.id)) {
                guard.add(cursor.id);
                const parent = graph.get(cursor.parentId);
                if (!parent)
                    break;
                cursor = parent;
            }
            return this.worldPos(cursor);
        }
        const pos = this.offsets.get(node.id);
        if (!pos)
            return point.xy;
        return [point.xy[0] + (pos[0] - node.xy[0]), point.xy[1] + (pos[1] - node.xy[1])];
    }
    visibleTrailPoints() {
        if (!this.view.showTrail)
            return [];
        const cut = this.view.timelineIndex === null ? this.view.trail : this.view.trail.slice(0, this.view.timelineIndex + 1);
        return polylinePoints(cut, this.view.hiddenPointIds).filter(point => this.trailNode(point));
    }
    // ── 高德式分级 + 屏幕空间去重 ────────────────────────────────────────
    currentLocationId() {
        if (!this.view.currentPath)
            return null;
        return this.view.graph.byPath.get(this.view.currentPath)?.id ?? null;
    }
    priority(node, currentId) {
        let score = 100 - tierOf(node) * 12;
        if (node.id === currentId)
            score += 800;
        if (node.id === this.view.selectedId)
            score += 1000;
        if (node.locked)
            score += 0.5;
        score += Math.min(this.childCount.get(node.id) ?? 0, 40) / 100;
        return score;
    }
    /** 画布上最终被画出来的节点（分级过滤 + 屏幕去重后的结果） */
    render() {
        const { w, h } = this.size();
        this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        this.applyTransform();
        const graph = this.view.graph;
        this.childCount = new Map();
        for (const node of graph.toArray())
            this.childCount.set(node.id, graph.children(node.id).length);
        this.computeOffsets();
        const currentId = this.currentLocationId();
        const trailNodeIds = new Set(this.visibleTrailPoints().map(point => point.nodeId));
        const keep = new Set();
        const addChain = (id) => {
            for (const node of graph.ancestors(id))
                keep.add(node.id);
            if (id)
                keep.add(id);
        };
        addChain(this.view.focusId);
        addChain(currentId);
        addChain(this.view.selectedId);
        for (const id of trailNodeIds)
            addChain(id);
        const candidates = [];
        for (const node of graph.toArray()) {
            if (this.view.hiddenNodeIds.has(node.id))
                continue;
            if (node.status === 'unplaced' && !this.view.showUnplaced)
                continue;
            const tier = tierOf(node);
            const threshold = TIER_VISIBLE_SCALE[Math.min(tier, TIER_VISIBLE_SCALE.length - 1)] ?? 1;
            if (this.scale < threshold)
                continue;
            // 高倍缩放时大域/地域点自动退场（高德式）：放大到街区级，「中州」这种洲级粒度只剩噪音。
            // 焦点/选中/当前地点的祖先链不受影响 —— 用户明确盯着的那条链保留。
            const hideAbove = TIER_HIDE_ABOVE_SCALE[Math.min(tier, TIER_HIDE_ABOVE_SCALE.length - 1)];
            if (this.scale > hideAbove && !keep.has(node.id))
                continue;
            candidates.push(node);
        }
        // 按优先级贪心占位：屏幕上贴太近的只留一个，缩小时洛阳就只剩一颗点
        const ranked = [...candidates].sort((a, b) => this.priority(b, currentId) - this.priority(a, currentId));
        const accepted = [];
        for (const node of ranked) {
            const pos = this.worldPos(node);
            const sx = pos[0] * this.scale + this.tx;
            const sy = pos[1] * this.scale + this.ty;
            if (sx < -100 || sy < -100 || sx > w + 100 || sy > h + 100)
                continue;
            const tooClose = accepted.some(item => Math.abs(item.sx - sx) < COLLAPSE_PX && Math.abs(item.sy - sy) < COLLAPSE_PX * 0.6);
            if (tooClose)
                continue;
            accepted.push({ node, sx, sy, tier: tierOf(node) });
        }
        this.drawn = accepted.map(item => item.node);
        // 宏观视角：缩放还没到「看得见城内要点」的级别时（窗口跨度 ≥ 一个大域），
        // 只报地名 —— 隐藏大域图标与层级连线，越宏观越要干净（细节留给放大后）。
        const macro = this.scale < (TIER_VISIBLE_SCALE[4] ?? 2.6);
        // 区域轮廓：界域/地域是「一片地方」而不是「一个点」—— 用虚线多边形把范围围出来，
        // 才看得出「省」（州/域）和「市」（宗/城）的差别。
        // 优先用节点自带的 shape（AI 按资料推的边界），没有就用后代位置算个凸包兜底。
        const regions = el('g');
        if (this.view.showRegions) {
            const childMap = new Map();
            for (const node of graph.toArray()) {
                if (!node.parentId)
                    continue;
                const list = childMap.get(node.parentId);
                if (list)
                    list.push(node);
                else
                    childMap.set(node.parentId, [node]);
            }
            for (const node of candidates) {
                if (tierOf(node) > 2 || node.status === 'unplaced')
                    continue;
                const points = [];
                const stack = [node.id];
                const seen = new Set([node.id]);
                while (stack.length) {
                    const id = stack.pop();
                    const self = graph.get(id);
                    if (self && self.status === 'ok')
                        points.push(self.xy);
                    for (const child of childMap.get(id) ?? []) {
                        if (seen.has(child.id))
                            continue;
                        seen.add(child.id);
                        stack.push(child.id);
                    }
                }
                const polygon = node.shape && node.shape.length >= 3 ? node.shape : padPolygon(convexHull(points), REGION_PAD);
                if (polygon.length < 3)
                    continue;
                regions.appendChild(el('polygon', {
                    points: polygon.map(point => `${point[0]},${point[1]}`).join(' '),
                    class: `dym-region dym-region-${node.kind}`,
                    'vector-effect': 'non-scaling-stroke',
                }));
            }
        }
        this.regionLayer.replaceChildren(regions);
        // 层级连线：只连到市级及以上（tier ≤ 3）。屋里那些房间不连线，
        // 否则一个客栈十三间房会从同一个点甩出十三根线，看着像蜘蛛网。
        // 宏观视角整组不画 —— 跨越大半张图的长线在缩小时只是噪音。
        // 接近阈值时按缩放淡入，避免「啪」地一下整片线闪出来。
        const linkFade = Math.max(0, Math.min(1, (this.scale - (TIER_VISIBLE_SCALE[4] ?? 2.6)) / 0.6));
        const links = el('g');
        if (this.view.showLinks && linkFade > 0.04) {
            const acceptedIds = new Set(accepted.map(item => item.node.id));
            for (const item of accepted) {
                if (item.tier > 3)
                    continue;
                const parentId = item.node.parentId;
                if (!parentId || !acceptedIds.has(parentId))
                    continue;
                const parent = graph.get(parentId);
                if (!parent)
                    continue;
                const from = this.worldPos(parent);
                const to = this.worldPos(item.node);
                const dx = to[0] - from[0];
                const dy = to[1] - from[1];
                const len = Math.hypot(dx, dy) || 1;
                // 轻微弧线：控制点落在中点法线方向偏移 8%，比直线更像手绘地图上的连线
                const bend = len * 0.08;
                const mx = (from[0] + to[0]) / 2 - (dy / len) * bend;
                const my = (from[1] + to[1]) / 2 + (dx / len) * bend;
                links.appendChild(el('path', {
                    d: `M${from[0]},${from[1]} Q${mx},${my} ${to[0]},${to[1]}`,
                    class: 'dym-link',
                    'vector-effect': 'non-scaling-stroke',
                    'stroke-width': item.tier <= 2 ? 1.3 : 1,
                    // 层级越深线越淡：一眼能看出主干（大域→城池）与末梢；再乘宏观淡入系数
                    'stroke-opacity': String(Math.max(0.2, 0.58 - item.node.depth * 0.07) * linkFade),
                }));
            }
        }
        this.linkLayer.replaceChildren(links);
        // 高度虚线（始终画，不受分级限制）
        const altGroup = el('g');
        for (const connector of this.connectors) {
            altGroup.appendChild(el('line', {
                x1: connector.from[0],
                y1: connector.from[1],
                x2: connector.to[0],
                y2: connector.to[1],
                stroke: 'rgba(79,109,120,.85)',
                'stroke-dasharray': '5 4',
                'vector-effect': 'non-scaling-stroke',
                'stroke-width': 1.3,
            }));
        }
        // 轨迹
        const trailGroup = el('g');
        const points = this.visibleTrailPoints();
        if (points.length) {
            const positions = points.map(point => this.trailPos(point));
            let segment = [];
            let segmentTravel = false;
            const flush = () => {
                if (segment.length >= 2) {
                    const d = segment.map(pos => `${pos[0]},${pos[1]}`).join(' ');
                    // 用了 non-scaling-stroke，描边宽度与虚线间距一律按**屏幕像素**给，
                    // 这样任何缩放级别下轨迹的粗细都一样（不要再除 scale）。
                    trailGroup.appendChild(el('polyline', {
                        points: d,
                        class: 'dym-trail-glow',
                        'vector-effect': 'non-scaling-stroke',
                        'stroke-width': 7,
                    }));
                    trailGroup.appendChild(el('polyline', {
                        points: d,
                        class: 'dym-trail',
                        'vector-effect': 'non-scaling-stroke',
                        'stroke-width': 2.4,
                        'stroke-dasharray': segmentTravel ? '7 5' : 'none',
                    }));
                }
                segment = [];
            };
            points.forEach((point, index) => {
                const pos = positions[index];
                // 节点失联（底图里已删除/重建）：轨迹线在此断开，绝不按陈旧坐标连去空地
                if (!pos) {
                    flush();
                    segmentTravel = false;
                    return;
                }
                if (point.kind === 'travel' && segment.length) {
                    segment.push(pos);
                    segmentTravel = true;
                    flush();
                    segment = [pos];
                    segmentTravel = false;
                    return;
                }
                segment.push(pos);
            });
            flush();
            // 脉冲点画在最后一个有效位置上
            let last = null;
            for (let index = positions.length - 1; index >= 0; index--) {
                if (positions[index]) {
                    last = positions[index];
                    break;
                }
            }
            if (last) {
                // 这两个小圆同样必须按屏幕像素换算成世界单位：任何缩放级别下都保持同样大小。
                // 脉冲环用 SVG <animate> 而不是 CSS keyframes —— CSS 里写死的 r 是世界单位，
                // 放大到几十倍会变成几百像素的巨环（踩过这个坑）。
                const pulse = el('circle', { cx: last[0], cy: last[1], r: 3.5 / this.scale, class: 'dym-pulse' });
                for (const [attribute, values] of [
                    ['r', `${3.5 / this.scale};${17 / this.scale}`],
                    ['opacity', '0.55;0'],
                ]) {
                    const animate = document.createElementNS(SVG_NS, 'animate');
                    animate.setAttribute('attributeName', attribute);
                    animate.setAttribute('values', values);
                    animate.setAttribute('dur', '1.9s');
                    animate.setAttribute('repeatCount', 'indefinite');
                    pulse.appendChild(animate);
                }
                trailGroup.appendChild(pulse);
                trailGroup.appendChild(el('circle', {
                    cx: last[0],
                    cy: last[1],
                    r: 4.4 / Math.max(0.3, this.scale),
                    fill: '#a83a1a',
                    stroke: 'rgba(253,247,232,.95)',
                    'stroke-width': 1.5 / Math.max(0.3, this.scale),
                }));
            }
        }
        this.trailLayer.replaceChildren(trailGroup, altGroup);
        // 节点
        const nodeGroup = el('g');
        const labelCandidates = [];
        // 局部密度：附近点越多，点标就画得越小 —— 挤在一起时小地方自动让位给大地方
        const density = new Map();
        for (const item of accepted) {
            let near = 0;
            for (const other of accepted) {
                if (other === item)
                    continue;
                if (Math.abs(other.sx - item.sx) < 64 && Math.abs(other.sy - item.sy) < 52)
                    near++;
            }
            density.set(item.node.id, near);
        }
        for (const item of accepted) {
            const { node, tier } = item;
            // 半径按**屏幕像素**给：r(世界) = px / scale，这样任何缩放级别下点的大小都恒定。
            // 不要在这里加"世界单位"的下限，否则放大时点会跟着一起变大（曾经踩过）。
            const radiusPx = TIER_RADIUS_PX[Math.min(tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            const crowded = density.get(node.id) ?? 0;
            const shrink = crowded >= 8 ? 0.58 : crowded >= 5 ? 0.72 : crowded >= 3 ? 0.86 : 1;
            const radius = (radiusPx * shrink) / Math.max(0.3, this.scale);
            const pos = this.worldPos(node);
            const color = KIND_COLORS[node.kind] ?? '#6f6252';
            const group = el('g', { class: `dym-node dym-lv${tier}`, 'data-id': node.id });
            if (node.status === 'unplaced')
                group.classList.add('dym-unplaced');
            if (node.id === this.view.selectedId)
                group.classList.add('dym-selected');
            if (this.view.focusId && node.id !== this.view.focusId) {
                const inside = graph.ancestors(node.id).some(ancestor => ancestor.id === this.view.focusId);
                if (!inside && tier >= 3)
                    group.classList.add('dym-dim');
            }
            // 界域/地域是「一片地方」，加一圈极淡的外环，让它与城池/宗门在观感上分开
            if (tier <= 2) {
                group.appendChild(el('circle', {
                    cx: pos[0],
                    cy: pos[1],
                    r: radius * 1.62,
                    fill: 'none',
                    stroke: color,
                    'stroke-opacity': 0.2,
                    'vector-effect': 'non-scaling-stroke',
                    'stroke-width': 1,
                }));
            }
            const halo = el('circle', {
                cx: pos[0],
                cy: pos[1],
                r: radius,
                class: 'dym-halo',
                stroke: color,
                fill: 'rgba(253,247,232,.94)',
            });
            halo.setAttribute('stroke-width', String(1.4 / Math.max(0.3, this.scale)));
            group.appendChild(halo);
            // 多选高亮：奶油底圈 + 朱红实线圈，双描边保证在宣纸任何位置都醒目
            if (this.multi.has(node.id)) {
                const k = 1 / Math.max(0.3, this.scale);
                group.appendChild(el('circle', {
                    cx: pos[0],
                    cy: pos[1],
                    r: radius * 2.1,
                    fill: 'rgba(236,217,171,.18)',
                    stroke: 'rgba(255,253,245,.95)',
                    'stroke-width': 4 * k,
                }));
                group.appendChild(el('circle', {
                    cx: pos[0],
                    cy: pos[1],
                    r: radius * 2.1,
                    fill: 'none',
                    stroke: '#b45a1e',
                    'stroke-width': 2 * k,
                }));
            }
            group.appendChild(el('circle', { cx: pos[0], cy: pos[1], r: radius * 0.72, fill: color }));
            // 宏观视角下大域只留地名（图标在这个尺度纯属噪音）；放大后再把图标带回来
            if (!(macro && tier <= 2)) {
                const icon = ICONS[node.kind] ?? ICONS.poi;
                const iconScale = (radius * 1.35) / 24;
                const iconGroup = el('g', {
                    transform: `translate(${pos[0] - 12 * iconScale},${pos[1] - 12 * iconScale}) scale(${iconScale})`,
                    fill: 'none',
                    stroke: 'rgba(253,247,232,.95)',
                    'stroke-width': 2,
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round',
                });
                for (const d of icon.paths)
                    iconGroup.appendChild(el('path', { d }));
                for (const [cx, cy, r] of icon.circles ?? [])
                    iconGroup.appendChild(el('circle', { cx, cy, r }));
                group.appendChild(iconGroup);
            }
            if (node.altitude) {
                const badge = el('text', {
                    x: pos[0] + radius * 1.15,
                    y: pos[1] - radius * 0.75,
                    'font-size': 12 / Math.max(0.3, this.scale),
                    'stroke-width': 2 / Math.max(0.3, this.scale),
                    fill: '#4f6d78',
                });
                badge.textContent = node.altitude > 0 ? '▲' : '▼';
                group.appendChild(badge);
            }
            // 位置固定的点：右上一颗小图钉点，跟「锁定」的视觉区分开
            if (node.pinned) {
                group.appendChild(el('circle', {
                    cx: pos[0] + radius * 0.95,
                    cy: pos[1] - radius * 0.95,
                    r: Math.max(1.2, radius * 0.32),
                    fill: '#8a8272',
                    stroke: 'rgba(253,247,232,.9)',
                    'stroke-width': 1 / Math.max(0.3, this.scale),
                }));
            }
            nodeGroup.appendChild(group);
            const labelFrom = TIER_LABEL_SCALE[Math.min(tier, TIER_LABEL_SCALE.length - 1)] ?? 1;
            if (this.scale >= labelFrom || node.id === this.view.selectedId || node.id === currentId) {
                labelCandidates.push({ node, pos, tier });
            }
        }
        // 标签避让（高德式）：
        //   1) 选中 / 当前地点是「种子」，最先占位，别的标签必须绕开它们；
        //   2) 其余按层级从大到小排队，先试点标**右侧**，放不下换**左侧**，两侧都没有空间才不画；
        //   3) 判定用标签矩形（锚点 + 文字宽度），并且**点标本身也是障碍物** —— 标签不许压到别家的圆点。
        const isSeedLabel = (id) => id === this.view.selectedId || id === currentId;
        labelCandidates.sort((a, b) => {
            const seedA = isSeedLabel(a.node.id) ? 0 : 1;
            const seedB = isSeedLabel(b.node.id) ? 0 : 1;
            return seedA - seedB || a.tier - b.tier;
        });
        const labelObstacles = accepted.map(item => ({
            id: item.node.id,
            box: [
                item.sx - (TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6) * 1.05,
                item.sy - (TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6) * 1.05,
                item.sx + (TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6) * 1.05,
                item.sy + (TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6) * 1.05,
            ],
        }));
        const labelBoxes = [];
        const acceptedLabels = [];
        for (const item of labelCandidates) {
            const sx = item.pos[0] * this.scale + this.tx;
            const sy = item.pos[1] * this.scale + this.ty;
            const fontPx = TIER_FONT_PX[Math.min(item.tier, TIER_FONT_PX.length - 1)] ?? 12;
            const radiusPx = TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            const width = Math.max(14, item.node.name.length * fontPx * 1.04);
            const trySide = (side) => {
                const x0 = side === 'right' ? sx + radiusPx * 1.3 : sx - radiusPx * 1.3 - width;
                const box = [x0 - 2, sy - fontPx * 0.85, x0 + width + 2, sy + fontPx * 0.45];
                for (const other of labelBoxes) {
                    if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])
                        return null;
                }
                for (const obstacle of labelObstacles) {
                    // 自己的点标不算障碍（标签本来就从自己点旁边开始）
                    if (obstacle.id === item.node.id)
                        continue;
                    if (box[0] < obstacle.box[2] && box[2] > obstacle.box[0] && box[1] < obstacle.box[3] && box[3] > obstacle.box[1]) {
                        return null;
                    }
                }
                return box;
            };
            let side = 'right';
            let box = trySide('right');
            if (!box) {
                side = 'left';
                box = trySide('left');
            }
            if (!box) {
                // 种子标签（选中/当前地点）必须画出来：实在没空间就放右侧，普通标签直接放弃
                if (!isSeedLabel(item.node.id))
                    continue;
                side = 'right';
                const x0 = sx + radiusPx * 1.3;
                box = [x0, sy - fontPx * 0.85, x0 + width + 2, sy + fontPx * 0.45];
            }
            labelBoxes.push(box);
            acceptedLabels.push({ node: item.node, pos: item.pos, sx, sy, tier: item.tier, side });
            if (acceptedLabels.length >= 70)
                break;
        }
        for (const item of acceptedLabels) {
            const fontPx = TIER_FONT_PX[Math.min(item.tier, TIER_FONT_PX.length - 1)] ?? 12;
            const radiusPx = TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            // 文字在缩放坐标系里，描边宽度按缩放倒数给 —— 否则 CSS 的 2px 会被放大成几十像素的气泡
            const k = 1 / Math.max(0.3, this.scale);
            const text = el('text', {
                x: item.pos[0] + (item.side === 'left' ? -1 : 1) * radiusPx * 1.3 * k,
                y: item.pos[1] + fontPx * 0.34 * k,
                'font-size': fontPx * k,
                'stroke-width': (item.tier <= 2 ? 2.6 : 2.2) * k,
                'font-weight': item.tier <= 2 ? '700' : '400',
                'text-anchor': item.side === 'left' ? 'end' : 'start',
                class: item.tier <= 2 ? 'dym-label dym-label-major' : 'dym-label',
            });
            text.textContent = item.node.name;
            nodeGroup.appendChild(text);
        }
        this.nodeLayer.replaceChildren(nodeGroup);
        // 罗盘（屏幕坐标，放在画布右上角，避开左下角的图例和右下的缩放按钮）
        const compassScale = 1.25;
        const compass = el('g', {
            class: 'dym-compass',
            style: 'color: rgba(122,96,58,.8)',
            transform: `translate(${Math.max(8, w - 20 - 24 * compassScale)},52) scale(${compassScale})`,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 1.6,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
        });
        for (const d of COMPASS.paths)
            compass.appendChild(el('path', { d }));
        for (const [cx, cy, r] of COMPASS.circles)
            compass.appendChild(el('circle', { cx, cy, r }));
        this.overlay.replaceChildren(compass);
        // 框选橡皮筋（屏幕坐标，画在 overlay 层）
        if (this.rubber) {
            const { x0, y0, x1, y1 } = this.rubber;
            this.overlay.appendChild(el('rect', {
                x: Math.min(x0, x1),
                y: Math.min(y0, y1),
                width: Math.abs(x1 - x0),
                height: Math.abs(y1 - y0),
                rx: 4,
                fill: 'rgba(217,192,140,.12)',
                stroke: '#d9c08c',
                'stroke-width': 1,
                'stroke-dasharray': '5 3',
            }));
        }
        this.wrap.dataset.dymScale = this.scale.toFixed(2);
        this.wrap.dataset.dymNodes = String(accepted.length);
        // 顶部坐标条：只显示「当前选中的点」——名称 + 坐标（有高度再带上高度）
        const selectedNode = this.view.selectedId ? graph.get(this.view.selectedId) : undefined;
        if (selectedNode) {
            const coord = (value) => String(Math.round(value * 10) / 10);
            const altitude = selectedNode.altitude ? `　高度 ${(selectedNode.altitude / 1e8).toFixed(2)} 亿里` : '';
            this.hud.textContent = `${selectedNode.name}　(${coord(selectedNode.xy[0])}, ${coord(selectedNode.xy[1])})${altitude}`;
            this.hud.title = selectedNode.path;
            this.hud.style.display = 'block';
        }
        else {
            this.hud.style.display = 'none';
        }
    }
    // ── 交互 ────────────────────────────────────────────────────────────
    /** 框选结束：把橡皮筋矩形（屏幕坐标）换成世界矩形，选中范围内的已绘制节点 */
    finishRubber() {
        if (this.rubber) {
            const x0 = Math.min(this.rubber.x0, this.rubber.x1);
            const x1 = Math.max(this.rubber.x0, this.rubber.x1);
            const y0 = Math.min(this.rubber.y0, this.rubber.y1);
            const y1 = Math.max(this.rubber.y0, this.rubber.y1);
            const wx0 = (x0 - this.tx) / this.scale;
            const wx1 = (x1 - this.tx) / this.scale;
            const wy0 = (y0 - this.ty) / this.scale;
            const wy1 = (y1 - this.ty) / this.scale;
            // 从**全图**挑而不是只挑画出来的 —— 完全重叠时屏幕折叠只画一个，
            // 被遮住的那个也要能被框进去一起拖走（这正是框选对重叠点的主要用途）。
            // 只挑当前缩放下会显示的层级，免得误拖八竿子外看不见的大域点。
            const picked = new Set();
            for (const node of this.view.graph.toArray()) {
                if (this.view.hiddenNodeIds.has(node.id))
                    continue;
                if (node.status === 'unplaced' && !this.view.showUnplaced)
                    continue;
                if (node.pinned)
                    continue; // 位置固定：框选直接跳过
                if (this.scale < (TIER_VISIBLE_SCALE[tierOf(node)] ?? 0))
                    continue;
                const pos = this.worldPos(node);
                if (pos[0] >= wx0 && pos[0] <= wx1 && pos[1] >= wy0 && pos[1] <= wy1)
                    picked.add(node.id);
            }
            this.multi = picked;
            if (picked.size)
                this.hooks.onBoxSelected?.(picked.size);
        }
        this.rubber = null;
        this.render();
    }
    /** 清空多选（点击空白选点 / 下钻 / 全图时调用） */
    clearMulti() {
        if (this.multi.size) {
            this.multi.clear();
            this.render();
        }
    }
    hitTest(clientX, clientY) {
        const [wx, wy] = this.screenToWorld(clientX, clientY);
        let best = null;
        let bestDistance = Infinity;
        for (const node of this.drawn) {
            const tier = tierOf(node);
            const radiusPx = TIER_RADIUS_PX[Math.min(tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            const pos = this.worldPos(node);
            const threshold = Math.max(radiusPx / Math.max(0.3, this.scale), 12 / this.scale);
            const dx = pos[0] - wx;
            const dy = pos[1] - wy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < threshold && distance < bestDistance) {
                best = node;
                bestDistance = distance;
            }
        }
        return best;
    }
    /** 命中所有重叠的已绘制节点（按距离从近到远） */
    hitTestAll(clientX, clientY) {
        const [wx, wy] = this.screenToWorld(clientX, clientY);
        const hits = [];
        for (const node of this.drawn) {
            const tier = tierOf(node);
            const radiusPx = TIER_RADIUS_PX[Math.min(tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            const pos = this.worldPos(node);
            const threshold = Math.max(radiusPx / Math.max(0.3, this.scale), 12 / this.scale);
            const dx = pos[0] - wx;
            const dy = pos[1] - wy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < threshold)
                hits.push({ node, d: distance });
        }
        return hits.sort((a, b) => a.d - b.d).map(item => item.node);
    }
    /**
     * 拾取一个节点，重叠时**同位连点轮换**：
     * 同一位置连点，第一次选最上面的，再点换被压住的那个（像设计软件那样）。
     * 轮换到的点会记住 —— 下一次按住它拖动，拖的就是你轮换到的那个，不是压在上面的。
     */
    lastPick = null;
    pickedAtDown = null;
    pickNode(clientX, clientY) {
        const hits = this.hitTestAll(clientX, clientY);
        if (!hits.length) {
            this.lastPick = null;
            return null;
        }
        if (hits.length === 1) {
            this.lastPick = null;
            return hits[0];
        }
        const sameSpot = this.lastPick &&
            this.lastPick.ids.length === hits.length &&
            this.lastPick.ids.every((id, index) => id === hits[index].id) &&
            Math.hypot(clientX - this.lastPick.x, clientY - this.lastPick.y) < 10;
        if (sameSpot && this.lastPick) {
            this.lastPick.index = (this.lastPick.index + 1) % hits.length;
            this.lastPick.x = clientX;
            this.lastPick.y = clientY;
            return hits[this.lastPick.index];
        }
        this.lastPick = { x: clientX, y: clientY, ids: hits.map(hit => hit.id), index: 0 };
        return hits[0];
    }
    bind() {
        this.svg.addEventListener('wheel', event => {
            event.preventDefault();
            const rect = this.svg.getBoundingClientRect();
            this.zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16, event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });
        this.svg.addEventListener('pointerdown', event => {
            if (event.button !== 0)
                return;
            // 编辑/框选交互压掉浏览器默认行为：不压的话拖动会选中 SVG 文字（蓝高亮）并干扰指针事件
            if (this.view.editMode || this.boxSelectMode)
                event.preventDefault();
            this.svg.setPointerCapture(event.pointerId);
            const shift = event.shiftKey;
            const node = this.pickNode(event.clientX, event.clientY);
            this.pickedAtDown = node;
            if (this.view.editMode) {
                // 框选模式开着（或按住 Shift）+ 空白处拖动 = 框选
                if ((shift || this.boxSelectMode) && !node) {
                    this.drag = {
                        mode: 'rubber',
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: 0,
                        originY: 0,
                        moved: false,
                    };
                    this.updateCursor();
                    return;
                }
                if (node && shift) {
                    // Shift + 点 = 加入/移出多选（不拖动）
                    if (this.multi.has(node.id))
                        this.multi.delete(node.id);
                    else
                        this.multi.add(node.id);
                    this.render();
                    return;
                }
                if (node && !shift && this.multi.has(node.id) && this.multi.size > 1) {
                    // 抓住多选中的点 → 整组拖动（固定的点不参与）
                    const origins = new Map();
                    for (const id of this.multi) {
                        const picked = this.view.graph.get(id);
                        if (picked && !picked.pinned)
                            origins.set(id, this.worldPos(picked));
                    }
                    this.drag = {
                        mode: 'group',
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: 0,
                        originY: 0,
                        origins,
                        moved: false,
                    };
                    this.hooks.onMoveSnapshot?.();
                    this.updateCursor();
                    return;
                }
                if (node) {
                    if (!shift)
                        this.multi.clear();
                    const pos = this.worldPos(node);
                    this.drag = {
                        mode: 'node',
                        id: node.id,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: pos[0],
                        originY: pos[1],
                        moved: false,
                    };
                    // 撤销快照必须在坐标被实时改写**之前**打 —— 拖完再打，撤销恢复的还是拖完的位置
                    this.hooks.onMoveSnapshot?.();
                    this.updateCursor();
                    return;
                }
                if (!shift)
                    this.multi.clear();
            }
            this.drag = {
                mode: 'pan',
                startX: event.clientX,
                startY: event.clientY,
                originX: this.tx,
                originY: this.ty,
                moved: false,
            };
            this.updateCursor();
        });
        this.svg.addEventListener('pointermove', event => {
            if (!this.drag)
                return;
            const dx = event.clientX - this.drag.startX;
            const dy = event.clientY - this.drag.startY;
            if (Math.abs(dx) + Math.abs(dy) > 3)
                this.drag.moved = true;
            if (this.drag.mode === 'pan') {
                this.tx = this.drag.originX + dx;
                this.ty = this.drag.originY + dy;
                this.applyTransform();
            }
            else if (this.drag.mode === 'node') {
                const node = this.view.graph.get(this.drag.id ?? '');
                if (!node)
                    return;
                node.xy = [this.drag.originX + dx / this.scale, this.drag.originY + dy / this.scale];
                this.render();
            }
            else if (this.drag.mode === 'group') {
                const wx = dx / this.scale;
                const wy = dy / this.scale;
                for (const [id, origin] of this.drag.origins ?? []) {
                    const picked = this.view.graph.get(id);
                    if (!picked)
                        continue;
                    picked.xy = [origin[0] + wx, origin[1] + wy];
                }
                this.render();
            }
            else if (this.drag.mode === 'rubber') {
                const rect = this.svg.getBoundingClientRect();
                this.rubber = {
                    x0: this.drag.startX - rect.left,
                    y0: this.drag.startY - rect.top,
                    x1: event.clientX - rect.left,
                    y1: event.clientY - rect.top,
                };
                this.render();
            }
        });
        const endDrag = () => {
            if (!this.drag)
                return;
            const current = this.drag;
            this.drag = null;
            this.updateCursor();
            // 开拖时打了快照但没真动 → 把快照退回去，别让撤销多一个空步
            if (!current.moved && (current.mode === 'node' || current.mode === 'group')) {
                this.hooks.onMoveAborted?.();
            }
            if (current.mode === 'node' && current.id && current.moved) {
                const node = this.view.graph.get(current.id);
                if (node) {
                    this.hooks.onMoveNode(node.id, [Math.round(node.xy[0] * 100) / 100, Math.round(node.xy[1] * 100) / 100]);
                    this.suppressClick = true;
                }
            }
            else if (current.mode === 'group' && current.moved) {
                // 整组提交：一次撤销快照，逐点落坐标（来源保持不变）
                const items = [];
                for (const [id, origin] of current.origins ?? []) {
                    const picked = this.view.graph.get(id);
                    if (!picked)
                        continue;
                    items.push({ id, xy: [Math.round(picked.xy[0] * 100) / 100, Math.round(picked.xy[1] * 100) / 100] });
                }
                if (items.length) {
                    this.suppressClick = true;
                    this.hooks.onMoveNodes(items);
                }
            }
            else if (current.mode === 'rubber') {
                // 松手后浏览器会补发 click（在空白处）→ onSelect(null) → 清空多选。
                // 不拦下这一下，框选结果瞬间就被清掉（"框了选不中"的真凶）。
                this.suppressClick = true;
                this.finishRubber();
            }
        };
        this.svg.addEventListener('pointerup', endDrag);
        this.svg.addEventListener('pointercancel', endDrag);
        this.svg.addEventListener('click', event => {
            if (this.suppressClick) {
                this.suppressClick = false;
                return;
            }
            // 用按下时拾取的节点：重叠连点轮换的结果不被 click 重复推进
            const node = this.pickedAtDown;
            this.pickedAtDown = null;
            this.hooks.onSelect(node ? node.id : null);
        });
        this.svg.addEventListener('dblclick', event => {
            const node = this.pickedAtDown ?? this.hitTest(event.clientX, event.clientY);
            this.pickedAtDown = null;
            if (node) {
                this.hooks.onFocus(node.id);
                return;
            }
            if (this.view.editMode) {
                const xy = this.screenToWorld(event.clientX, event.clientY);
                this.hooks.onCreateNodeAt([Math.round(xy[0] * 100) / 100, Math.round(xy[1] * 100) / 100], this.view.focusId);
                return;
            }
            this.hooks.onFocus(null);
        });
        this.svg.addEventListener('contextmenu', event => {
            event.preventDefault();
            const node = this.pickedAtDown ?? this.hitTest(event.clientX, event.clientY);
            this.pickedAtDown = null;
            if (node) {
                this.hooks.onEditNode(node.id);
                return;
            }
            if (this.view.editMode) {
                const xy = this.screenToWorld(event.clientX, event.clientY);
                this.hooks.onCreateNodeAt([Math.round(xy[0] * 100) / 100, Math.round(xy[1] * 100) / 100], this.view.focusId);
            }
        });
        this.svg.addEventListener('pointerleave', () => {
            this.svg.classList.remove('dym-panning');
        });
    }
    describeNode(node) {
        const altitude = node.altitude ? `｜高度 ${(node.altitude / 1e8).toFixed(2)} 亿里` : '';
        const status = node.status === 'unplaced' ? '｜待定位' : '';
        const tier = node.tier ? `${tierOf(node)}（手动）` : String(tierOf(node));
        return `层级 ${tier}｜${KIND_LABELS[node.kind] ?? '地点'}｜(${node.xy[0].toFixed(1)}, ${node.xy[1].toFixed(1)})${altitude}${status}`;
    }
    destroy() {
        this.svg.remove();
    }
}
export function defaultView(graph) {
    return {
        graph,
        trail: [],
        hiddenPointIds: new Set(),
        hiddenNodeIds: new Set(),
        focusId: null,
        selectedId: null,
        currentPath: null,
        editMode: false,
        showTrail: true,
        showLinks: true,
        showRegions: true,
        showUnplaced: true,
        trailCityOnly: true,
        timelineIndex: null,
    };
}
export const WORLD_BOUNDS = { min: COORD_MIN, max: COORD_MAX };
export function html(text) {
    return escapeHtml(text);
}
export { tierOfKind };
//# sourceMappingURL=canvas.js.map