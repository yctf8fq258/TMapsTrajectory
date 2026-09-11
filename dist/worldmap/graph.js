import { BASE_MAP_SCHEMA, COORD_CENTER, COORD_MAX, COORD_MIN, LAYER_RADIUS, LOC_SEP, tierOfKind } from './types.js';
import { isBearingSegment, isImmortalRealmName, isTrivialFacility, looksLikeDescription, nodeId, normalize, joinSegments, splitSegments, } from './path.js';
/** 段名别名表：把世界书与变量里的不同叫法归到一个节点上 */
export const SEGMENT_ALIASES = {
    中州: '中央神州',
    神州: '中央神州',
    神都洛阳: '神都',
    皇宫: '宫城区',
    皇城: '宫城区',
    内城: '四区',
    百花谷: '百花坊',
};
/** 路径别名：把「世界书叫法」映射到「种子/已有底图的写法」，避免同一地点被建成两棵树
 *  注意：方位词（东南部/西部…）不再作为容器节点，所以要映射到真实的父节点上。 */
export const PATH_ALIASES = [
    { pattern: ['洛阳'], replacement: ['中央神州', '大周仙朝', '神都'] },
    { pattern: ['神都洛阳'], replacement: ['中央神州', '大周仙朝', '神都'] },
    { pattern: ['中央神州', '东南部'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '西部'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '极西'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '西南部'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '南部'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '东南方'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '东部'], replacement: ['中央神州'] },
    { pattern: ['中央神州', '北部'], replacement: ['中央神州'] },
    { pattern: ['玄天界', '中央神州'], replacement: ['中央神州'] },
];
/** 自动建树的最大深度：再往下基本都是环境描写，不该变成地图节点 */
export const MAX_AUTO_DEPTH = 6;
/** 对段数组应用路径别名（取最长匹配的一条） */
export function applyPathAliases(segments) {
    let best = null;
    for (const entry of PATH_ALIASES) {
        if (entry.pattern.length > segments.length)
            continue;
        const matched = entry.pattern.every((part, index) => segments[index] === part);
        if (!matched)
            continue;
        if (!best || entry.pattern.length > best.pattern.length)
            best = entry;
    }
    if (!best)
        return segments;
    return [...best.replacement, ...segments.slice(best.pattern.length)];
}
const KIND_RULES = [
    [/域$|洲$|雪原$|佛国$|神州$|界$/, 'region'],
    [/仙朝$|古国$|宗$|门$|宫$|殿$|阁$|楼$|堂$|寺$|族$|盟$|殿$|教$/, 'power'],
    [/城$|都$|镇$|坊$|市$|村$|驿$|谷$|岛$|山$|湖$|峰$/, 'city'],
    [/院$|园$|台$|泉$|窟$|间$|厅$|厢$|房$|室$|殿$|塔$|关$|门$|桥$/, 'site'],
];
function guessKind(name) {
    for (const [pattern, kind] of KIND_RULES) {
        if (pattern.test(name))
            return kind;
    }
    return 'poi';
}
function clamp(value) {
    return Math.max(COORD_MIN, Math.min(COORD_MAX, value));
}
export function isVec2(value) {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}
export class MapGraph {
    byId = new Map();
    byPath = new Map();
    byName = new Map();
    childIndex = new Map();
    cellMemo = new Map();
    constructor(nodes = []) {
        for (const node of nodes)
            this.add(node);
    }
    static fromBaseMap(map) {
        return new MapGraph(map.nodes ?? []);
    }
    get size() {
        return this.byId.size;
    }
    add(node) {
        this.byId.set(node.id, node);
        this.byPath.set(node.path, node);
        const named = this.byName.get(node.name);
        if (named)
            named.push(node);
        else
            this.byName.set(node.name, [node]);
        const key = node.parentId ?? '^';
        const children = this.childIndex.get(key);
        if (children)
            children.push(node);
        else
            this.childIndex.set(key, [node]);
        return node;
    }
    get(id) {
        return id ? this.byId.get(id) : undefined;
    }
    children(id) {
        return this.childIndex.get(id ?? '^') ?? [];
    }
    ancestors(id) {
        const chain = [];
        let cursor = this.get(id);
        const guard = new Set();
        while (cursor && !guard.has(cursor.id)) {
            guard.add(cursor.id);
            chain.unshift(cursor);
            cursor = this.get(cursor.parentId);
        }
        return chain;
    }
    descendants(id) {
        const result = [];
        const stack = [...this.children(id)];
        while (stack.length) {
            const node = stack.pop();
            result.push(node);
            stack.push(...this.children(node.id));
        }
        return result;
    }
    toArray() {
        return [...this.byId.values()];
    }
    /** 确保父链存在，返回最深节点。segments 为空时返回 null */
    ensurePath(segments, source = 'trail') {
        let parent = null;
        let path = '';
        for (const rawSegment of segments) {
            const name = this.alias(rawSegment);
            if (!name)
                continue;
            const child = this.findChild(parent?.id ?? null, name);
            if (child) {
                parent = child;
                continue;
            }
            path = parent ? `${parent.path}${LOC_SEP}${name}` : name;
            parent = this.create(parent, name, path, source);
        }
        return parent;
    }
    alias(segment) {
        const trimmed = segment.trim();
        if (!trimmed)
            return '';
        return SEGMENT_ALIASES[trimmed] ?? trimmed;
    }
    /** 名字匹配：精确同名，或「已知名字是更长段名的前缀且余下不超过 3 字」（慈宁宫东暖阁 → 慈宁宫） */
    matchName(node, name) {
        if (node.name === name || node.path === name)
            return node;
        const key = node.name;
        if (key.length < 2 || key.length >= name.length)
            return undefined;
        if (!name.startsWith(key))
            return undefined;
        if (name.length - key.length > 3)
            return undefined;
        return node;
    }
    /** 找子节点：先精确同名，再允许短后缀归并 */
    findChild(parentId, name) {
        const children = this.children(parentId);
        let best;
        for (const child of children) {
            const matched = this.matchName(child, name);
            if (!matched)
                continue;
            if (matched.name === name)
                return matched;
            if (!best || matched.name.length > best.name.length)
                best = matched;
        }
        return best;
    }
    /**
     * 在 parentId 下面最多往下 skip 层找同名节点。
     * 游戏正文经常省略中间层级（例如只写「神都·慈宁宫东暖阁」，而底图里慈宁宫挂在 神都·宫城区 下），
     * 没有这一步就会在错误的位置重复建点。
     */
    findDescendantByName(parentId, name, maxSkip = 2) {
        let frontier = this.children(parentId);
        for (let level = 0; level < maxSkip && frontier.length; level++) {
            let best;
            for (const node of frontier) {
                const matched = this.matchName(node, name);
                if (!matched)
                    continue;
                if (matched.name === name)
                    return matched;
                if (!best || matched.name.length > best.name.length)
                    best = matched;
            }
            if (best)
                return best;
            frontier = frontier.flatMap(node => this.children(node.id));
        }
        return undefined;
    }
    /**
     * 局部格子半径：一个节点的子节点应该分布在这个半径内。
     * 取「到最近兄弟的距离」的收敛值与「父节点格子半径 × 0.45」的较小者，
     * 这样深处（城内/屋内）的点不会被甩到比整座城还远的地方。
     */
    cellRadius(node) {
        const cached = this.cellMemo.get(node.id);
        if (cached !== undefined)
            return cached;
        const base = LAYER_RADIUS[Math.min(node.depth, LAYER_RADIUS.length - 1)] || 40;
        let value = base;
        const siblings = this.children(node.parentId);
        if (siblings.length >= 2) {
            let nearest = Infinity;
            for (const other of siblings) {
                if (other.id === node.id)
                    continue;
                const dx = other.xy[0] - node.xy[0];
                const dy = other.xy[1] - node.xy[1];
                nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
            }
            if (Number.isFinite(nearest) && nearest > 0.05)
                value = Math.min(value, nearest * 0.5);
        }
        const parent = node.parentId ? this.byId.get(node.parentId) : undefined;
        if (parent)
            value = Math.min(value, this.cellRadius(parent) * 0.45);
        value = Math.max(value, 0.3);
        this.cellMemo.set(node.id, value);
        return value;
    }
    findByName(name) {
        return this.byName.get(name) ?? [];
    }
    create(parent, name, path, source) {
        const depth = parent ? parent.depth + 1 : 0;
        const id = nodeId(parent?.id ?? null, name);
        const existing = this.byId.get(id);
        if (existing)
            return existing;
        const node = {
            id,
            name,
            path,
            parentId: parent?.id ?? null,
            depth,
            xy: this.autoPlace(parent, name),
            kind: guessKind(name),
            locked: false,
            source,
            status: 'unplaced',
        };
        // 能给别的节点当父节点的，说明它是路径里的一"站"，按市级处理；
        // 但马厩/客房这类杂物不升级，免得它们把轨迹又拉成一团。
        if (parent && (parent.source === 'trail' || parent.source === 'ai') && parent.kind === 'poi' && !isTrivialFacility(parent.name)) {
            parent.kind = 'city';
        }
        return this.add(node);
    }
    /**
     * 解析一个地点字符串，返回命中的节点与路径。
     * create=false 时不会新建节点，未命中返回 null。
     */
    resolve(raw, options = {}) {
        const create = options.create !== false;
        const source = options.source ?? 'trail';
        // 顺序很重要：先做段名/路径别名（它会把「中州东南」这类方位写法换成真实父节点），
        // 再把纯方位段过滤掉——它们只表示方向，不该在地图上占一个点。
        const segments = applyPathAliases(splitSegments(raw).map(segment => this.alias(segment)).filter(Boolean))
            .filter(segment => !isBearingSegment(segment));
        if (!segments.length)
            return null;
        // 0. 精确命中
        const exact = this.byPath.get(joinSegments(segments));
        if (exact)
            return { node: exact, created: false, segments };
        // 2. 前缀最长匹配（含 1 段的情况）
        for (let take = segments.length - 1; take >= 1; take--) {
            const prefix = segments.slice(0, take);
            const found = this.byPath.get(joinSegments(prefix));
            if (!found)
                continue;
            if (!create)
                return null;
            let deepest = found;
            let created = false;
            for (const segment of segments.slice(take)) {
                if (deepest.depth + 1 >= MAX_AUTO_DEPTH)
                    break;
                if (deepest.depth >= 2 && looksLikeDescription(segment))
                    break;
                // 自动建点时不要"马厩/水井/某某客房"这种无意义小点 —— 直接停在上一级
                if ((source === 'trail' || source === 'ai') && isTrivialFacility(segment))
                    break;
                const child = this.findChild(deepest.id, segment) ?? this.findDescendantByName(deepest.id, segment, 2);
                if (child) {
                    deepest = child;
                    continue;
                }
                // 新节点的路径必须从 deepest.path 推出来：上面可能刚跳层认领了一个更深的已有节点
                deepest = this.create(deepest, segment, `${deepest.path}${LOC_SEP}${segment}`, source);
                created = true;
            }
            return { node: deepest, created, segments };
        }
        // 3. 贪心建树
        if (!create)
            return null;
        let parent = null;
        let path = '';
        let created = false;
        for (const segment of segments) {
            if (parent && parent.depth + 1 >= MAX_AUTO_DEPTH)
                break;
            const parentId = parent ? parent.id : null;
            const child = this.findChild(parentId, segment) ?? (parentId ? this.findDescendantByName(parentId, segment, 2) : undefined);
            if (child) {
                parent = child;
                continue;
            }
            if (parent && looksLikeDescription(segment))
                break;
            if (parent && (source === 'trail' || source === 'ai') && isTrivialFacility(segment))
                break;
            path = parent ? `${parent.path}${LOC_SEP}${segment}` : segment;
            parent = this.create(parent, segment, path, source);
            created = true;
        }
        return parent ? { node: parent, created, segments } : null;
    }
    /** 自动落点：围绕父节点的向日葵螺旋；半径自适应父节点的局部格子 */
    autoPlace(parent, name) {
        const depth = parent ? parent.depth + 1 : 0;
        const base = LAYER_RADIUS[Math.min(depth, LAYER_RADIUS.length - 1)] || 40;
        const cell = parent ? this.cellRadius(parent) : 200;
        const radius = Math.max(0.35, Math.min(base, cell * 0.42));
        const siblings = this.children(parent?.id ?? null).length;
        const golden = 2.399963229728653;
        const angle = siblings * golden + (hashUnit(name) - 0.5) * 0.6;
        const distance = radius * (0.5 + 0.5 * Math.sqrt((siblings % 7) / 7 + 0.2));
        const center = parent ? parent.xy : COORD_CENTER;
        return [clamp(center[0] + Math.cos(angle) * distance), clamp(center[1] + Math.sin(angle) * distance)];
    }
    /** 写入坐标；locked 节点默认不动（force=true 才覆盖，用于"从预设重建"） */
    setPosition(id, xy, options = {}) {
        const node = this.byId.get(id);
        if (!node)
            return false;
        if (node.locked && !options.force)
            return false;
        node.xy = [clamp(Number(xy[0])), clamp(Number(xy[1]))];
        if (options.force)
            node.locked = false;
        if (options.source)
            node.source = options.source;
        return true;
    }
    /** 把未定位的新节点铺开成环形，便于人工微调 */
    scatterUnplaced() {
        let moved = 0;
        const groups = new Map();
        for (const node of this.byId.values()) {
            if (node.status !== 'unplaced' || node.locked)
                continue;
            const key = node.parentId ?? '^';
            const list = groups.get(key);
            if (list)
                list.push(node);
            else
                groups.set(key, [node]);
        }
        for (const [parentKey, list] of groups) {
            const parent = parentKey === '^' ? null : this.byId.get(parentKey) ?? null;
            list.forEach((node, index) => {
                const depth = node.depth;
                const radius = Math.max(2, (LAYER_RADIUS[Math.min(depth, LAYER_RADIUS.length - 1)] || 40) * 0.5);
                const angle = (index / Math.max(1, list.length)) * Math.PI * 2;
                const center = parent ? parent.xy : COORD_CENTER;
                node.xy = [clamp(center[0] + Math.cos(angle) * radius), clamp(center[1] + Math.sin(angle) * radius)];
                moved++;
            });
        }
        return moved;
    }
    bounds(ids) {
        const list = ids ? ids.map(id => this.byId.get(id)).filter(Boolean) : this.toArray();
        if (!list.length)
            return { minX: COORD_MIN, minY: COORD_MIN, maxX: COORD_MAX, maxY: COORD_MAX };
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const node of list) {
            minX = Math.min(minX, node.xy[0]);
            minY = Math.min(minY, node.xy[1]);
            maxX = Math.max(maxX, node.xy[0]);
            maxY = Math.max(maxY, node.xy[1]);
        }
        return { minX, minY, maxX, maxY };
    }
}
function hashUnit(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash % 1000) / 1000;
}
export function toBaseMap(graph, previous) {
    return {
        schemaVersion: BASE_MAP_SCHEMA,
        name: previous?.name ?? '本地底图',
        sourceRef: previous?.sourceRef,
        updatedAt: new Date().toISOString(),
        nodes: graph.toArray().sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
        hiddenIds: previous?.hiddenIds ?? [],
    };
}
export { normalize };
/** 节点的显示层级：优先用人工/预设写死的 tier，否则按 kind 推 */
export function tierOf(node) {
    const explicit = node.tier;
    if (typeof explicit === 'number' && explicit >= 1 && explicit <= 5)
        return explicit;
    return tierOfKind(node.kind);
}
/**
 * 底图清洗（每次加载/保存前都跑）：
 *   1. 剔除纯方位节点（西部/东南部…），其子节点上提到祖父，路径重算
 *   2. 剔除仙界节点及其整棵子树 —— 当前舞台是玄天界
 *   3. 合并重复节点：同名 + 路径互相包含 + 坐标几乎重合 → 只留一个，子节点迁移
 *   4. 重算 id/path/depth（上提与合并都会改变层级）
 */
export function sanitizeNodes(input) {
    const report = { removedBearing: 0, removedImmortal: 0, merged: 0, total: input.length };
    const originalChildren = new Map();
    for (const node of input) {
        const key = node.parentId ?? '^';
        const list = originalChildren.get(key);
        if (list)
            list.push(node);
        else
            originalChildren.set(key, [node]);
    }
    const effectiveParent = new Map();
    const immortal = new Set();
    const removed = new Set();
    for (const node of input) {
        effectiveParent.set(node.id, node.parentId ?? null);
        if (isImmortalRealmName(node.name))
            immortal.add(node.id);
    }
    let grew = true;
    while (grew) {
        grew = false;
        for (const node of input) {
            const parent = effectiveParent.get(node.id);
            if (parent && immortal.has(parent) && !immortal.has(node.id)) {
                immortal.add(node.id);
                grew = true;
            }
        }
    }
    for (const node of input) {
        if (immortal.has(node.id))
            continue;
        if (!isBearingSegment(node.name))
            continue;
        report.removedBearing++;
        removed.add(node.id);
        const grand = effectiveParent.get(node.id) ?? null;
        for (const child of originalChildren.get(node.id) ?? []) {
            if (!immortal.has(child.id))
                effectiveParent.set(child.id, grand);
        }
    }
    report.removedImmortal = immortal.size;
    // ── 3. 合并重复（在重算 id/path **之前**做：那时 id 还是唯一可靠的键）──
    const byId = new Map(input.map(node => [node.id, node]));
    const effectivePathOf = (node) => {
        const chain = [];
        let cursor = node;
        const guard = new Set();
        while (cursor && !guard.has(cursor.id)) {
            guard.add(cursor.id);
            if (!removed.has(cursor.id))
                chain.unshift(cursor.name);
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        return chain.join(LOC_SEP);
    };
    for (let round = 0; round < 3; round++) {
        const survivors = input.filter(node => !removed.has(node.id));
        const byName = new Map();
        for (const node of survivors) {
            const list = byName.get(node.name);
            if (list)
                list.push(node);
            else
                byName.set(node.name, [node]);
        }
        let mergedThisRound = 0;
        for (const [, group] of byName) {
            if (group.length < 2)
                continue;
            const paths = new Map(group.map(node => [node.id, effectivePathOf(node)]));
            for (let i = 0; i < group.length; i++) {
                const a = group[i];
                if (removed.has(a.id))
                    continue;
                for (let j = i + 1; j < group.length; j++) {
                    const b = group[j];
                    if (removed.has(b.id))
                        continue;
                    const pa = paths.get(a.id);
                    const pb = paths.get(b.id);
                    if (!pa || !pb)
                        continue;
                    const samePath = pa === pb;
                    const related = samePath || pa.endsWith(LOC_SEP + pb) || pb.endsWith(LOC_SEP + pa);
                    if (!related)
                        continue;
                    const dx = a.xy[0] - b.xy[0];
                    const dy = a.xy[1] - b.xy[1];
                    // 有效路径完全相同一定是同一处（方位节点上提后常见），无条件合并；
                    // 只是互相包含时，还要坐标几乎重合才敢合并，免得误伤同名异地。
                    if (!samePath && Math.sqrt(dx * dx + dy * dy) >= 1.5)
                        continue;
                    const keeper = a.locked !== b.locked ? (a.locked ? a : b) : pa.length <= pb.length ? a : b;
                    const loser = keeper === a ? b : a;
                    removed.add(loser.id);
                    mergedThisRound++;
                    // 输家的子节点改挂到赢家
                    for (const child of originalChildren.get(loser.id) ?? []) {
                        if (!removed.has(child.id))
                            effectiveParent.set(child.id, keeper.id);
                    }
                    break;
                }
            }
        }
        report.merged += mergedThisRound;
        if (!mergedThisRound)
            break;
    }
    // ── 4. 按有效父节点重算 id/path/depth ────────────────────────────────
    const childrenOf = new Map();
    for (const node of input) {
        if (immortal.has(node.id) || removed.has(node.id))
            continue;
        const key = effectiveParent.get(node.id) ?? '^';
        const list = childrenOf.get(key);
        if (list)
            list.push(node);
        else
            childrenOf.set(key, [node]);
    }
    const out = [];
    const seen = new Set();
    const queue = (childrenOf.get('^') ?? []).map(node => ({
        node,
        parent: null,
    }));
    while (queue.length) {
        const item = queue.shift();
        if (seen.has(item.node.id))
            continue;
        seen.add(item.node.id);
        const parent = item.parent;
        const path = parent ? `${parent.path}${LOC_SEP}${item.node.name}` : item.node.name;
        const copy = {
            ...item.node,
            id: nodeId(parent?.id ?? null, item.node.name),
            parentId: parent?.id ?? null,
            path,
            depth: parent ? parent.depth + 1 : 0,
        };
        out.push(copy);
        for (const child of childrenOf.get(item.node.id) ?? [])
            queue.push({ node: child, parent: copy });
    }
    return { nodes: out, report };
}
//# sourceMappingURL=graph.js.map