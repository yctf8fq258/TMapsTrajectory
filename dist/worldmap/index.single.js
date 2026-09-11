/* worldmap —— 单文件版（由 tools/release.mjs 生成，请勿直接编辑） */
(() => {
const __mods = Object.create(null);
const __def = (name, factory) => { __mods[name] = factory(); };
const __req = name => {
  const mod = __mods[name];
  if (!mod) throw new Error('[世界舆图] 单文件打包缺失模块: ' + name);
  return mod;
};
__def("./types.js", () => {
/**
 * 角色卡地图轨迹插件 —— 全部类型与常量。
 *
 * 设计要点（详细依据见 docs/计划书-世界舆图插件.md）：
 * · 坐标是**单一全局有符号坐标系**，**神都洛阳 = (0,0) 是世界中心**：
 *   正东 +x、正南 +y，向西/向北为负，范围 -500..500（1 单位 ≈ 15 亿里）。
 * · 节点层级由解析出来的**实际深度**决定，而不是 MVU 6 段格式的字面段号——因为
 *   真实数据是「大陆·势力·城池·建筑·房间」，段数会变（例如「中州东南·百花坊·外坊茶市」只有 3 段）。
 */
/** 坐标轴范围：神都为 0，四方各 500 单位（≈7500 亿里） */
const COORD_MIN = -500;
const COORD_MAX = 500;
/** 原点 = 神都洛阳 */
const COORD_CENTER = [0, 0];
/** 当前底图数据结构版本；1 → 2 是「原点从西北角搬到神都」的平移 */
const BASE_MAP_SCHEMA = 2;
/** v1 → v2 的平移量：旧坐标 - 500 */
const ORIGIN_SHIFT = -500;
/** 地点层级分隔符（U+00B7 MIDDLE DOT） */
const LOC_SEP = '·';
/** 会出现在「地点名」与「环境描述」之间的分隔符（实测四种都用过） */
const DESCRIPTION_CUTS = ['；', ';', '。', '，', ',', '！', '？', '!', '?', '\n'];
/** 文案里偶尔混进来的其它中点变体，解析前统一成 LOC_SEP */
const SEP_VARIANTS = ['·', '・', '•', '‧', '∙', '．', '﻿·'];
function tierOfKind(kind) {
    switch (kind) {
        case 'realm':
            return 1;
        case 'region':
            return 2;
        case 'city':
        case 'power':
            return 3;
        case 'site':
        case 'poi':
            return 4;
        case 'room':
            return 5;
        default:
            return 4;
    }
}
/** 低于该缩放倍率就不画这个层级的点（索引 = tier） */
const TIER_VISIBLE_SCALE = [0, 0.1, 0.32, 0.85, 2.6, 6.5];
/** 低于该缩放倍率就不画这个层级的文字标签 */
const TIER_LABEL_SCALE = [0, 0.1, 0.32, 1.15, 3.6, 8.5];
/** 屏幕像素半径（索引 = tier） */
const TIER_RADIUS_PX = [0, 12, 9.5, 8, 6, 4.6];
/** 屏幕像素字号（索引 = tier） */
const TIER_FONT_PX = [0, 15, 13.5, 12.5, 11.5, 10.5];
/** 两个点在屏幕上的距离小于它就算重叠，只画优先级最高的那个 */
const COLLAPSE_PX = 26;
/** 高度偏移的基准像素距离（屏幕像素） */
const ALTITUDE_OFFSET_PX = 44;
/**
 * 底图迁移：v1 的坐标原点是画布西北角（0,0），v2 搬到了**神都洛阳**。
 * 读到的旧底图整体平移 (-500,-500)，区域轮廓顶点一起搬。
 */
function migrateBaseMap(base) {
    const version = Number(base.schemaVersion ?? 1);
    if (version >= BASE_MAP_SCHEMA)
        return { ...base, schemaVersion: BASE_MAP_SCHEMA };
    const shift = (point) => [point[0] + ORIGIN_SHIFT, point[1] + ORIGIN_SHIFT];
    const nodes = (base.nodes ?? []).map(node => {
        const xy = Array.isArray(node.xy) && node.xy.length >= 2 ? shift(node.xy) : node.xy;
        const shape = Array.isArray(node.shape) ? node.shape.map(shift) : node.shape;
        return { ...node, xy, shape };
    });
    return { ...base, schemaVersion: BASE_MAP_SCHEMA, nodes };
}
/** 存储键名（避免与"卡内手机脚本"的 phone_data 冲突） */
const KEY_BASE_MAP = 'worldmap_v1';
const KEY_TRAIL = 'worldmap_trail_v1';
/** 所有自己注入到父页面的 DOM id 前缀（pagehide 与热重载靠它清理） */
const ID_PREFIX = 'worldmap-';
const DEFAULT_API = {
    // 默认给一套开箱可用的 DeepSeek 配置（国内直连、便宜、听话）。
    // 用别的服务（LM Studio / OpenAI / 各类中转）时把接口和模型名改掉即可。
    url: 'https://api.deepseek.com',
    key: '',
    model: 'deepseek-chat',
    // 上限 = max_tokens，只管模型一次能写多长，不影响喂进去的世界书。
    // 坐标表动辄几百行 JSON，16384 在十几个条目时就容易在尾部被截断
    // （表现是「模型返回为空」或 JSON 解析失败）。默认给到 32768。
    maxTokens: 32768,
    temperature: 0.2,
};
const DEFAULT_PRESET_URL = '';
const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    api: { ...DEFAULT_API },
    presetUrl: DEFAULT_PRESET_URL,
    autoPlaceRadius: 1,
    defaultOpen: true,
    showEventLayer: true,
    showUnplaced: true,
};
const DEFAULT_LAYOUT = {
    x: -1,
    y: 96,
    w: 620,
    h: 500,
    collapsed: false,
    drawerOpen: true,
    tab: 'places',
    docked: null,
    railWidth: 30,
};
/** 各深度自动落点的基准半径（归一化单位）；深度越深，围绕父节点越近 */
const LAYER_RADIUS = [0, 420, 140, 48, 16, 5.5, 2];
//# sourceMappingURL=types.js.map
return { COORD_MIN, COORD_MAX, COORD_CENTER, BASE_MAP_SCHEMA, ORIGIN_SHIFT, LOC_SEP, DESCRIPTION_CUTS, SEP_VARIANTS, tierOfKind, TIER_VISIBLE_SCALE, TIER_LABEL_SCALE, TIER_RADIUS_PX, TIER_FONT_PX, COLLAPSE_PX, ALTITUDE_OFFSET_PX, migrateBaseMap, KEY_BASE_MAP, KEY_TRAIL, ID_PREFIX, DEFAULT_API, DEFAULT_PRESET_URL, DEFAULT_SETTINGS, DEFAULT_LAYOUT, LAYER_RADIUS };
});
__def("./path.js", () => {
/**
 * 地点字符串解析：把 MVU 的 `世界.当前地点` / 世界书条目名，变成干净的层级段数组。
 *
 * 实测的难点（见计划书 F3）：
 *   · 层级分隔符统一是 `·`(U+00B7)，但中间偶尔混进 `・`/`•`/`．` 等变体；
 *   · 「地点名」与「环境描述」之间的分隔符**不统一**，`；`/`。`/`，`/`·` 都用过：
 *       中央神州·大周仙朝·神都·慈宁宫·西暖阁内殿；炭盆红亮…   （；）
 *       中央神州·大周仙朝·神都·皇宫·慈宁宫西暖阁·窗外风雪…     （·，早期楼层）
 *       中央神州·阵天宗外围·官道西段·双槐驿至西行官道。日头偏西… （。）
 *   所以这里只做「切描述 + 切段」，**不做**层级语义判断；
 *   真正的层级归属由 graph.ts 拿现有树做贪心最长匹配决定。
 */
const { DESCRIPTION_CUTS, LOC_SEP, SEP_VARIANTS } = __req('./types.js');
/** 世界书条目名上常见的前缀（喂给 AI 时要去掉，否则会被当成地名段） */
const ENTRY_PREFIXES = [
    /^\[MOD\](\[[^\]]*\]){0,4}/,
    /^地点[：:]/,
    /^秘境详情[：:]/,
    /^仙界地点详情[：:]/,
    /^势力详情[：:]/,
    /^势力详细[：:]/,
    /^妖族势力[：:]/,
    /^仙界势力详情[：:]/,
    /^地点[-—]/,
    /^设施[-—]/,
    /^区域[-—]/,
];
const BRACKET_PAIRS = [
    ['【', '】'],
    ['《', '》'],
    ['「', '」'],
    ['『', '』'],
    ['[', ']'],
    ['（', '）'],
    ['(', ')'],
];
/** 把各种中点变体统一成 `·`，去首尾空白，折叠重复分隔符 */
function normalize(raw) {
    let text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    for (const variant of SEP_VARIANTS) {
        if (variant !== LOC_SEP)
            text = text.split(variant).join(LOC_SEP);
    }
    text = text.replace(/[\u3000\u00a0]/g, ' ').trim();
    text = text.replace(new RegExp(`(${LOC_SEP})\\s*${LOC_SEP}`, 'g'), LOC_SEP);
    text = text.replace(new RegExp(`^${LOC_SEP}+|${LOC_SEP}+$`, 'g'), '');
    return text.trim();
}
/** 去掉世界书条目前缀与包裹括号，得到纯地名 */
function stripEntryPrefix(raw) {
    let text = normalize(raw);
    for (const pattern of ENTRY_PREFIXES)
        text = text.replace(pattern, '');
    text = text.trim();
    for (const [open, close] of BRACKET_PAIRS) {
        while (text.startsWith(open) && text.endsWith(close) && text.length > 2) {
            text = text.slice(1, -1).trim();
        }
    }
    return text;
}
/**
 * 切掉环境描述，只留地点名部分。
 * 实测有楼层用 `·` 分隔描述，那种情况这里切不掉，交给 graph 的贪心匹配兜底。
 */
function cutDescription(raw) {
    const text = normalize(raw);
    let cut = text.length;
    for (const mark of DESCRIPTION_CUTS) {
        const index = text.indexOf(mark);
        if (index >= 0 && index < cut)
            cut = index;
    }
    return text.slice(0, cut).trim();
}
/** 按 `·` 切段，去空、去重相邻重复 */
function splitSegments(raw) {
    const head = cutDescription(raw);
    const segments = head
        .split(LOC_SEP)
        .map(part => part.trim())
        .filter(Boolean);
    const merged = [];
    for (const segment of segments) {
        if (merged.length && merged[merged.length - 1] === segment)
            continue;
        merged.push(segment);
    }
    return merged;
}
/** 段数组拼回路径 */
function joinSegments(segments) {
    return segments.join(LOC_SEP);
}
/** 稳定的节点 id：按父 id + 段名做 FNV-1a 哈希，跨存档可复现 */
function nodeId(parentId, name) {
    const text = `${parentId ?? '^'}/${name}`;
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'n' + hash.toString(36).padStart(7, '0');
}
/** 纯方位/分区词：「东南部」「极西」「中域腹地」这类只表示方向，不该在地图上变成点 */
const BEARING_NAMES = new Set([
    '东', '南', '西', '北', '中',
    '东部', '南部', '西部', '北部', '中部',
    '东南', '西南', '东北', '西北',
    '东南部', '西南部', '东北部', '西北部',
    '东南方', '西南方', '东北方', '西北方',
    '极东', '极南', '极西', '极北',
    '中域', '中域腹地', '腹地', '内陆', '沿海', '边境', '外围',
    '北地', '南疆', '东荒', '西域',
    '中州东南', '中州西北', '中州东部', '中州西部', '中州南部', '中州北部',
    '北部与极北', '东部与极东', '南部与极南', '西部与极西',
]);
/** 判断一个段是不是「纯方位词」——是的话解析时直接跳过这一层，不建节点 */
function isBearingSegment(segment) {
    const text = segment.trim();
    if (!text)
        return false;
    if (BEARING_NAMES.has(text))
        return true;
    return /^(东|南|西|北|中)(部|侧|面|方|域|境|隅)$/.test(text);
}
/** 仙界相关名字：当前剧情舞台是玄天界，默认不把仙界铺进底图 */
const IMMORTAL_REALM = /(仙域|仙界|天庭|凌霄|界碑关|时空乱流)/;
function isImmortalRealmName(name) {
    return IMMORTAL_REALM.test(name);
}
/**
 * 「不明意义的小点」黑名单：马厩、柴房、水井、某某客房……
 * 这类东西在建筑内部到处都是，画到地图上只会变成蜘蛛网，所以**只对自动新建的节点**生效
 * （种子 / 作者预设 / 人工拖动过的节点一律不动）。
 */
const TRIVIAL_FACILITY = new RegExp('^(' +
    [
        '马厩', '马棚', '牲口棚', '牲畜棚', '鸡舍', '猪圈', '柴房', '柴堆', '灶房', '厨房', '伙房',
        '水井', '井台', '水缸', '水房', '茅房', '茅厕', '净房', '浴房', '澡堂', '汤池',
        '库房', '仓库', '储物间', '储酒间', '杂物间', '账房', '门房', '院门', '大门', '侧门', '角门', '后门',
        '后院', '前院', '跨院', '天井', '回廊', '走廊', '过道', '影壁', '照壁', '围墙', '院墙',
        '菜园', '花园', '花圃', '演武场', '校场', '马道', '石阶', '台阶',
    ].join('|') +
    ')$');
/** 后缀型的小点：某某客房 / 某某客舍 / 某某铺子 */
const TRIVIAL_SUFFIX = /(客房|客舍|厢房|耳房|偏房|卧房|寝室|铺子|摊子|小摊|店铺|门脸)$/;
function isTrivialFacility(name) {
    const text = name.trim();
    if (!text)
        return false;
    if (TRIVIAL_FACILITY.test(text))
        return true;
    // 「天字号客房」这种：名字里带房/间/室 且不长，且不是某某宫/殿/阁这类正经建筑
    if (text.length <= 5 && TRIVIAL_SUFFIX.test(text))
        return true;
    return false;
}
/** 描述性词素：出现在地点名里基本可以断定这一段是环境描写而不是地名 */
const DESCRIPTION_MARKERS = [
    '的',
    '拍打',
    '明灭',
    '斜落',
    '低垂',
    '半垂',
    '透过',
    '映亮',
    '流转',
    '垂落',
    '氤氲',
    '热气',
    '风声',
    '暮光',
    '晨光',
    '雪停',
    '映着',
    '泛着',
    '漫开',
    '萦绕',
    '拍得',
];
/** 环境描写常见的起首字（窗外/榻上/案头…） */
const DESCRIPTION_HEADS = /^(窗|榻|案|灯|雪|晨|暮|夜|雨|风|云|炉|香|帐|纱|帘|光|影|殿内|屋内|院中|门外)/;
/**
 * 判断一个段是否更像「环境描述」而不是地名（用于贪心建树的止损）。
 * 依据实测样本：合法的深层地名（松烟阁外长巷口/西街尽头/观河桥头）都不含 `的`、
 * 不长于 8 字；而误入的描述段（榻上纱帐半垂/朱红阵纹沿檐角明灭/地火阵烘暖的内寝宫）
 * 都能被下面几条规则命中。
 */
function looksLikeDescription(segment) {
    if (segment.length >= 9)
        return true;
    if (/[，。；！？、]/.test(segment))
        return true;
    for (const marker of DESCRIPTION_MARKERS) {
        if (segment.includes(marker))
            return true;
    }
    if (DESCRIPTION_HEADS.test(segment))
        return true;
    if (/^(有|无|见|听|闻|但|而|却|且|因|遂|乃|则|其|此|那|这)/.test(segment))
        return true;
    return false;
}
/** 从「距神都七百亿里」这类文本里抽方向与距离，供 AI 布局时做提示（不直接决定坐标） */
function parseBearing(text) {
    const dirs = [];
    const dirPattern = /(正东|正南|正西|正北|东侧|西侧|南侧|北侧|东南|东北|西南|西北|东部|西部|南部|北部|以东|以西|以南|以北|向东|向西|向南|向北|正上方|正下方|地底|地下|高空|深处|湖心|后山|山脚|山顶)/g;
    let match;
    while ((match = dirPattern.exec(text)))
        dirs.push(match[1]);
    const distanceMatch = text.match(/([0-9０-９]+(?:\.[0-9]+)?)\s*(亿里|万里|千里|里)/);
    return { dirs, distance: distanceMatch ? Number(distanceMatch[1]) : undefined };
}
//# sourceMappingURL=path.js.map
return { normalize, stripEntryPrefix, cutDescription, splitSegments, joinSegments, nodeId, isBearingSegment, isImmortalRealmName, isTrivialFacility, looksLikeDescription, parseBearing };
});
__def("./graph.js", () => {
const { BASE_MAP_SCHEMA, COORD_CENTER, COORD_MAX, COORD_MIN, LAYER_RADIUS, LOC_SEP, tierOfKind } = __req('./types.js');
const { isBearingSegment, isImmortalRealmName, isTrivialFacility, looksLikeDescription, nodeId, normalize, joinSegments, splitSegments } = __req('./path.js');
/** 段名别名表：把世界书与变量里的不同叫法归到一个节点上 */
const SEGMENT_ALIASES = {
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
const PATH_ALIASES = [
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
const MAX_AUTO_DEPTH = 6;
/** 对段数组应用路径别名（取最长匹配的一条） */
function applyPathAliases(segments) {
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
function isVec2(value) {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}
class MapGraph {
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
function toBaseMap(graph, previous) {
    return {
        schemaVersion: BASE_MAP_SCHEMA,
        name: previous?.name ?? '本地底图',
        sourceRef: previous?.sourceRef,
        updatedAt: new Date().toISOString(),
        nodes: graph.toArray().sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
        hiddenIds: previous?.hiddenIds ?? [],
    };
}
/** 节点的显示层级：优先用人工/预设写死的 tier，否则按 kind 推 */
function tierOf(node) {
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
function sanitizeNodes(input) {
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
return { SEGMENT_ALIASES, PATH_ALIASES, MAX_AUTO_DEPTH, applyPathAliases, isVec2, MapGraph, toBaseMap, normalize, tierOf, sanitizeNodes };
});
__def("./trail.js", () => {
const { COORD_MAX, COORD_MIN } = __req('./types.js');
const { isVec2 } = __req('./graph.js');
const { normalize } = __req('./path.js');
const PATCH_BLOCK = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/i;
const PATCH_BLOCK_OPEN = /<JSONPatch>([\s\S]*)$/i;
const UPDATE_BLOCK = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i;
/** 剥掉 ``` 围栏 */
function stripFence(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
    if (match)
        return match[1].trim();
    return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
}
/** 宽容 JSON 修复：去尾逗号、补齐未闭合的括号、去掉块内杂散文字 */
function repairJson(text) {
    let body = stripFence(text);
    const firstBracket = body.indexOf('[');
    const firstBrace = body.indexOf('{');
    const start = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
    if (start > 0)
        body = body.slice(start);
    body = body.replace(/,\s*([\]}])/g, '$1');
    body = body.replace(/\/\/[^\n]*/g, '');
    const stack = [];
    let inString = false;
    let escaped = false;
    for (const character of body) {
        if (inString) {
            if (escaped)
                escaped = false;
            else if (character === '\\')
                escaped = true;
            else if (character === '"')
                inString = false;
            continue;
        }
        if (character === '"')
            inString = true;
        else if (character === '[' || character === '{')
            stack.push(character);
        else if (character === ']' || character === '}')
            stack.pop();
    }
    if (stack.length) {
        const tail = [...stack].reverse().map(open => (open === '[' ? ']' : '}')).join('');
        body = body.replace(/,\s*$/, '') + tail;
    }
    return body;
}
/** 解析 <JSONPatch> 里的 patch 数组；拿不到就返回 null（调用方静默跳过这一楼） */
function parseJsonPatch(mes) {
    if (!mes || mes.indexOf('JSONPatch') < 0)
        return null;
    const block = mes.match(PATCH_BLOCK) ?? mes.match(PATCH_BLOCK_OPEN);
    if (!block)
        return null;
    for (const candidate of [stripFence(block[1]), repairJson(block[1])]) {
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed))
                return parsed;
        }
        catch {
            /* 继续尝试下一种修复 */
        }
    }
    return null;
}
function normalizePath(raw) {
    if (typeof raw !== 'string')
        return '';
    return raw.replace(/^\/?stat_data\/?/, '/').replace(/^stat_data/, '') || '';
}
/** 从一条 assistant 消息里抽出 `地图` 变量与 `世界.当前地点/当前时间` */
function extractMessageMapInfo(mes) {
    const info = {};
    const ops = parseJsonPatch(mes);
    if (!ops)
        return info;
    for (const op of ops) {
        if (!op || typeof op !== 'object')
            continue;
        const key = normalizePath(op.path);
        const kind = String(op.op ?? '');
        if (kind === 'remove' || kind === 'move')
            continue;
        if (key === '/地图' && op.value && typeof op.value === 'object') {
            info.mapVar = { ...op.value };
            continue;
        }
        if (key.startsWith('/地图/')) {
            const field = key.slice('/地图/'.length);
            info.mapVar = info.mapVar ?? {};
            info.mapVar[field] = op.value;
            continue;
        }
        if (key === '/世界/当前地点' && typeof op.value === 'string')
            info.location = op.value;
        else if (key === '/世界/当前时间' && typeof op.value === 'string')
            info.time = op.value;
    }
    return info;
}
/** 上一楼层里 `<UpdateVariable>` 外部的正文（用于兜底：正文里直接写了「当前地点：X」） */
function extractLooseLocation(mes) {
    const withoutUpdate = mes.replace(UPDATE_BLOCK, '');
    const match = withoutUpdate.match(/(?:当前地点|所在地点|位置)\s*[：:]\s*([^\n，。；]{2,80})/);
    return match ? match[1].trim() : undefined;
}
/** 全量重建轨迹 */
function rebuildTrail(options) {
    const { messages, graph } = options;
    const jumpLimit = options.jumpLimit ?? 150;
    const points = [];
    const anomalies = [];
    let createdNodes = 0;
    let previous = null;
    messages.forEach((message, messageId) => {
        if (!message || message.is_user)
            return;
        const raw = typeof message.message === 'string' ? message.message : '';
        if (!raw)
            return;
        const info = extractMessageMapInfo(raw);
        const locationRaw = info.location ?? info.mapVar?.层级;
        const loose = locationRaw ? undefined : extractLooseLocation(raw);
        const source = locationRaw ?? loose;
        if (!source && !info.mapVar?.坐标)
            return;
        const pathText = normalize(source ?? '');
        const resolved = pathText ? graph.resolve(pathText, { create: true, source: 'trail' }) : null;
        if (resolved?.created)
            createdNodes++;
        const node = resolved?.node ?? null;
        if (!node)
            return;
        // 坐标优先用 AI 给的值，其次用已知坐标，最后用自动落点
        let posSrc = 'auto';
        let xy = node.xy;
        const aiCoord = info.mapVar?.坐标;
        if (isVec2(aiCoord)) {
            const candidate = [Number(aiCoord[0]), Number(aiCoord[1])];
            const sane = candidate[0] >= COORD_MIN - 20 &&
                candidate[0] <= COORD_MAX + 20 &&
                candidate[1] >= COORD_MIN - 20 &&
                candidate[1] <= COORD_MAX + 20 &&
                (!previous || distance(previous.xy, candidate) <= jumpLimit || node.depth <= 1);
            if (sane) {
                xy = candidate;
                posSrc = 'ai';
                if (!node.locked) {
                    node.xy = xy;
                    if (node.status === 'unplaced' && node.source === 'trail')
                        node.status = 'ok';
                }
            }
            else {
                anomalies.push({ messageId, reason: `坐标跳变过大或越界：${JSON.stringify(candidate)}` });
            }
        }
        else if (node.source !== 'trail' || node.status === 'ok') {
            posSrc = 'lookup';
        }
        if (typeof info.mapVar?.高度 === 'number')
            node.altitude = info.mapVar.高度;
        const point = {
            id: `${messageId}-${message.swipe_id ?? 0}`,
            messageId,
            swipeId: message.swipe_id ?? 0,
            t: info.time ?? (typeof info.mapVar?.时间 === 'string' ? info.mapVar.时间 : ''),
            nodeId: node.id,
            path: node.path,
            xy,
            posSrc,
            kind: classify(previous, node, xy, jumpLimit),
        };
        points.push(point);
        previous = point;
    });
    // ── 与上一版轨迹合并：分配稳定 seq + 保住被删楼层的点 ──────────────────
    const stored = options.previous?.points ?? [];
    const keyOf = (point) => `${point.t}|${point.path}`;
    const byContent = new Map(stored.map(point => [keyOf(point), point]));
    const byMessage = new Map(stored.map(point => [point.messageId, point]));
    let nextSeq = stored.reduce((max, point) => Math.max(max, point.seq ?? 0), 0) + 1;
    for (const point of points) {
        // 优先按「时间+地点」认领旧序号：删楼会让 messageId 整体前移，按楼层认领会串位
        const matched = byContent.get(keyOf(point)) ?? byMessage.get(point.messageId);
        point.seq = matched?.seq ?? nextSeq++;
    }
    const covered = new Set(points.map(point => keyOf(point)));
    const liveMessages = new Set(points.map(point => point.messageId));
    let orphanCount = 0;
    for (const old of stored) {
        if (liveMessages.has(old.messageId))
            continue;
        if (covered.has(keyOf(old)))
            continue;
        if (!old.path)
            continue;
        points.push({ ...old, orphan: true });
        orphanCount++;
    }
    points.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const trail = {
        schemaVersion: 1,
        points,
        hiddenPointIds: options.hiddenPointIds ?? [],
    };
    return { trail, createdNodes, anomalies, orphanCount };
}
function classify(previous, node, xy, jumpLimit) {
    if (!previous)
        return 'move';
    if (previous.nodeId === node.id)
        return 'stay';
    const previousDepth = previous.path.split('·').length;
    const depth = node.path.split('·').length;
    if (Math.abs(depth - previousDepth) >= 2)
        return 'travel';
    if (distance(previous.xy, xy) > jumpLimit)
        return 'travel';
    return 'move';
}
function distance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}
/** 把轨迹里连续重复的坐标合并，供画线使用 */
function polylinePoints(points, hidden) {
    const visible = points.filter(point => !hidden.has(point.id));
    const result = [];
    for (const point of visible) {
        const last = result[result.length - 1];
        if (last && last.nodeId === point.nodeId && last.xy[0] === point.xy[0] && last.xy[1] === point.xy[1]) {
            result[result.length - 1] = { ...last, kind: point.kind, messageId: point.messageId, id: point.id, t: point.t || last.t };
            continue;
        }
        result.push(point);
    }
    return result;
}
//# sourceMappingURL=trail.js.map
return { repairJson, parseJsonPatch, extractMessageMapInfo, extractLooseLocation, rebuildTrail, distance, polylinePoints };
});
__def("./store.js", () => {
const { DEFAULT_LAYOUT, DEFAULT_SETTINGS, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } = __req('./types.js');
const LOCAL_PREFIX = 'worldmap_map_local_';
function readLocal(key) {
    try {
        const raw = localStorage.getItem(LOCAL_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
function writeLocal(key, value) {
    try {
        localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
    }
    catch {
        /* 隐私模式等场景静默失败 */
    }
}
/** 读某个作用域下自己那一份数据 */
function readScope(key, scope) {
    try {
        const variables = getVariables({ type: scope });
        const value = variables?.[key];
        return value === undefined || value === null ? null : value;
    }
    catch {
        return readLocal(`${scope}_${key}`);
    }
}
/** 写某个作用域下自己那一份数据（深合并，不动别人的键） */
function writeScope(key, value, scope) {
    try {
        insertOrAssignVariables({ [key]: value }, { type: scope });
        return true;
    }
    catch (error) {
        window.console.warn('[世界舆图] 写入变量失败，回退到 localStorage', scope, error);
        writeLocal(`${scope}_${key}`, value);
        return false;
    }
}
/**
 * 上一版的存储键名。**只作一次性兼容读取**：新键读不到数据时回退读老键，
 * 之后照常写回新键 —— 这样升级后已经调好的底图与轨迹不会丢。
 */
const LEGACY_KEY_BASE_MAP = 'daoyuan_map_v1';
const LEGACY_KEY_TRAIL = 'daoyuan_trail_v1';
function loadBaseMap() {
    const map = readScope(KEY_BASE_MAP, 'character') ??
        readScope(KEY_BASE_MAP, 'chat') ??
        readScope(LEGACY_KEY_BASE_MAP, 'character') ??
        readScope(LEGACY_KEY_BASE_MAP, 'chat');
    if (!map || !Array.isArray(map.nodes))
        return null;
    return migrateBaseMap(map);
}
function saveBaseMap(map) {
    const ok = writeScope(KEY_BASE_MAP, map, 'character');
    if (!ok)
        writeScope(KEY_BASE_MAP, map, 'chat');
    return ok;
}
function loadTrail() {
    const trail = readScope(KEY_TRAIL, 'chat') ?? readScope(LEGACY_KEY_TRAIL, 'chat');
    if (!trail || !Array.isArray(trail.points))
        return null;
    return trail;
}
function saveTrail(trail) {
    writeScope(KEY_TRAIL, trail, 'chat');
}
function loadSettings() {
    const stored = readScope('settings', 'script') ?? readScope('settings', 'global');
    if (!stored)
        return { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api } };
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        schemaVersion: 1,
        api: { ...DEFAULT_SETTINGS.api, ...(stored.api ?? {}) },
    };
}
function saveSettings(settings) {
    writeScope('settings', settings, 'script');
}
function loadLayout() {
    return { ...DEFAULT_LAYOUT, ...(readLocal('layout') ?? {}) };
}
function saveLayout(layout) {
    writeLocal('layout', layout);
}
/** 当前聊天 / 角色的基本信息，用于日志与 UI */
function describeContext() {
    let character = '';
    try {
        character = getCurrentCharacterName() ?? '';
    }
    catch {
        /* 忽略 */
    }
    let chat = '';
    try {
        chat = String(SillyTavern?.getCurrentChatId?.() ?? '');
    }
    catch {
        /* 忽略 */
    }
    return { chat, character };
}
//# sourceMappingURL=store.js.map
return { readScope, writeScope, loadBaseMap, saveBaseMap, loadTrail, saveTrail, loadSettings, saveSettings, loadLayout, saveLayout, describeContext };
});
__def("./seed.js", () => {
const { nodeId } = __req('./path.js');
const DEGREE = 15; // 亿里 / 单位
/** 图纸坐标 → 世界坐标 的平移量：图纸上的 (500,500) 是神都，世界坐标里它就是 (0,0) */
const SHEET_ORIGIN = 500;
/**
 * 把「距神都 N 亿里 + 方位」换算成**图纸坐标**（与上面表格同一套，构造节点时统一平移）。
 * bearing：0 = 正北，90 = 正东，180 = 正南，270 = 正西。
 */
function offsetFromGodCapital(distanceYi, degrees, bearing) {
    const radius = distanceYi / DEGREE;
    const radians = ((bearing - 90) * Math.PI) / 180;
    return [round(SHEET_ORIGIN + Math.cos(radians) * radius), round(SHEET_ORIGIN + Math.sin(radians) * radius)];
}
function round(value) {
    return Math.round(value * 100) / 100;
}
const rows = [
    // ── 四域（十字轴，中央神州居中）──────────────────────────────────────
    ['中央神州', 500, 500, 'region', 0, '玄天界地理中心，边长约 3000 亿里，神都洛阳居中'],
    ['东极青木域', 700, 500, 'region', 0, '最东方，南北跨度 4500 亿里、东西纵深 3800 亿里'],
    ['西漠佛国', 300, 500, 'region', 0, '最西方，南北 3500 亿里、东西 2500 亿里'],
    ['南离火洲', 500, 700, 'region', 0, '最南方，东西 4000 亿里、南北 3000 亿里'],
    ['北冥雪原', 500, 300, 'region', 0, '最北方，东西 3500 亿里、南北 2800 亿里'],
    // ── 四条边界天堑 ──────────────────────────────────────────────────────
    ['中央神州·无尽山脉', 600, 500, 'region', 0, '东侧边界，南北走向 3000 亿里、宽 300 亿里'],
    ['中央神州·叹息沙海', 400, 500, 'region', 0, '西侧边界，3000 亿里长、宽 120 亿里'],
    ['中央神州·烬骨荒原', 500, 600, 'region', 0, '南侧边界，3000 亿里长、宽 80 亿里'],
    ['中央神州·绝迹冰谷', 500, 400, 'region', 0, '北侧边界，3000 亿里长、裂隙宽 35 亿里'],
    // ── 中央神州：中域腹地 ────────────────────────────────────────────────
    ['中央神州·大周仙朝', 500, 500, 'power', 0, '核心统辖，主城神都洛阳'],
    ['中央神州·大周仙朝·神都', 500, 500, 'city', 0, '大周仙朝都城，太初山上的仙都'],
    ['中央神州·阵天宗', 514, 514, 'power', 0, '距神都 300 亿里，位于千阵岭'],
    ['中央神州·万宝楼', 503, 497, 'power', 0, '商号组织，中域'],
    ['中央神州·黑金阁', 505, 495, 'power', 0, '暗市组织，中域'],
    ['中央神州·斩仙盟', 502, 506, 'power', 0, '中域同盟'],
    ['中央神州·天机阁', 498, 498, 'power', 0, '推演天机，中域'],
    // ── 中央神州：各方势力（方位词只用来算坐标，本身不建节点）────────────
    ['中央神州·蜀山剑门', ...offsetFromGodCapital(700, 0, 270), 'power', 0, '距神都向西 700 亿里'],
    ['中央神州·昆仑道门', ...offsetFromGodCapital(1000, 0, 270), 'power', 0, '距神都向西 1000 亿里，昆仑神山'],
    ['中央神州·青玉宗', 410, 545, 'power', 0, '青音湖，距蜀山 500 亿里、距百花谷 200 亿里'],
    ['中央神州·湮丹宗', ...offsetFromGodCapital(800, 0, 90), 'power', 0, '杏临谷，距神都 800 亿里'],
    ['中央神州·万法宗', ...offsetFromGodCapital(1200, 0, 135), 'power', 0, '万法天仪仙城，距神都 1200 亿里'],
    ['中央神州·灵墟宗', 584, 557, 'power', 0, '灵兽原，距万法宗 400 亿里'],
    ['中央神州·符韵门', ...offsetFromGodCapital(600, 0, 90), 'power', 0, '云符山，距神都 600 亿里'],
    ['中央神州·星道宗', 500, 460, 'power', 3_000_000_000, '云符山正上方 30 亿里高空的摘星悬岛'],
    ['中央神州·南梁古国', 520, 537, 'power', 0, '洛阳以南 550 亿里，东临无尽海、西靠云梦大泽'],
    ['中央神州·百花坊', 525, 530, 'city', 0, '百花谷外的坊市，合欢宗明线'],
    ['中央神州·合欢宗', 526, 531, 'power', 0, '明线距神都 400 亿里，位于百花谷'],
    // ── 西漠佛国 ──────────────────────────────────────────────────────────
    ['西漠佛国·须弥山·大雷音寺', 372, 500, 'power', 0, '距神都 1920 亿里，向东 300 亿里入叹息沙海'],
    // ── 北冥雪原 ──────────────────────────────────────────────────────────
    ['北冥雪原·广寒宫', 500, 320, 'power', 0, '雪原深处，向南 1500 亿里至绝迹冰谷边缘'],
    ['北冥雪原·北冥黑渊·水晶龙宫', 500, 320, 'power', -6_666_667, '广寒宫正下方地底一千万里，蛟龙一族'],
    ['北冥雪原·星辰塔', 520, 290, 'site', 0, '每三百年在上空浮现，九十九层'],
    // ── 南离火洲 ──────────────────────────────────────────────────────────
    ['南离火洲·万丈火山·太阳神宫', 520, 700, 'power', 0, '火山区域核心统辖'],
    ['南离火洲·葬仙坡·尸魔宗', 505, 660, 'power', 0, '烬骨荒原南侧边缘，向南 200 亿里为血海'],
    ['南离火洲·血神宫', 520, 680, 'power', 0, '距太阳神宫西南'],
    ['南离火洲·万魂殿', 480, 690, 'power', 0, '阴风山脉万鬼窟'],
    // ── 东极青木域 ────────────────────────────────────────────────────────
    ['东极青木域·万妖山脉·神猿族', 640, 500, 'power', 0, '向西跨 300 亿里无尽山脉至中州'],
    ['东极青木域·青丘·九尾天狐族', 760, 470, 'power', 0, '向东 1200 亿里至青丘'],
    ['东极青木域·沂云森林', 700, 470, 'region', 0, '东部'],
    ['东极青木域·落凤坡·五色孔雀族', 720, 560, 'power', 0, '南部'],
    ['东极青木域·蓬莱仙岛', 900, 500, 'site', 0, '每六十年在青木域极东出现一次'],
];
/** 神都内部（同心结构：宫城区 › 四区 › 六坊 › 环墟），坐标在同一点附近做微偏移以便观察 */
const godCapitalRows = [
    ['中央神州·大周仙朝·神都·宫城区', 500, 500, 'city', 0, '太初山顶，皇城与镇魔司'],
    ['中央神州·大周仙朝·神都·宫城区·慈宁宫', 500.9, 500.35, 'site', 0, '圣德太后寝宫'],
    ['中央神州·大周仙朝·神都·宫城区·长乐坊', 499.4, 500.6, 'site', 0, '宫外坊市'],
    ['中央神州·大周仙朝·神都·宫城区·镇魔司', 501.2, 499.7, 'power', 0, '北镇抚司档房'],
    ['中央神州·大周仙朝·神都·四区', 500.6, 501.1, 'city', 0, '山腰与内城四区'],
    ['中央神州·大周仙朝·神都·六坊', 501.4, 502, 'city', 0, '城墙内外的六坊'],
    ['中央神州·大周仙朝·神都·环墟', 502.4, 502.9, 'city', 0, '城墙外的环墟'],
];
function expand(source, sourceTag) {
    const byPath = new Map();
    const result = [];
    for (const [path, x, y, kind, altitude, note] of source) {
        const segments = path.split('·');
        let parentId = null;
        let accumulated = '';
        segments.forEach((name, index) => {
            accumulated = index === 0 ? name : `${accumulated}·${name}`;
            const isLast = index === segments.length - 1;
            const existing = byPath.get(accumulated);
            if (existing) {
                parentId = existing.id;
                if (isLast) {
                    existing.xy = [x, y];
                    if (kind)
                        existing.kind = kind;
                    if (typeof altitude === 'number')
                        existing.altitude = altitude;
                    if (note)
                        existing.note = note;
                    existing.locked = true;
                    existing.status = 'ok';
                }
                return;
            }
            const id = nodeId(parentId, name);
            const node = {
                id,
                name,
                path: accumulated,
                parentId,
                depth: index,
                xy: [round(x - SHEET_ORIGIN), round(y - SHEET_ORIGIN)],
                kind: isLast ? kind ?? 'poi' : index === 0 ? 'realm' : 'region',
                altitude: isLast && typeof altitude === 'number' ? altitude : undefined,
                locked: isLast,
                source: sourceTag,
                status: isLast ? 'ok' : 'ok',
                note: isLast ? note : undefined,
            };
            byPath.set(accumulated, node);
            result.push(node);
            parentId = id;
        });
    }
    return result;
}
/** 世界骨架：世界书里明确写了方位/距离的点 */
const SEED_NODES = expand(rows, 'seed');
/** 神都内部细节：世界书《洛阳扩展》里的同心四区 */
const SEED_CAPITAL_NODES = expand(godCapitalRows, 'seed');
const SEED_ALL = [...SEED_NODES, ...SEED_CAPITAL_NODES].filter((node, index, list) => list.findIndex(item => item.id === node.id) === index);
//# sourceMappingURL=seed.js.map
return { offsetFromGodCapital, SEED_NODES, SEED_CAPITAL_NODES, SEED_ALL };
});
__def("./preset.js", () => {
const { migrateBaseMap } = __req('./types.js');
const { MapGraph, toBaseMap } = __req('./graph.js');
const { SEED_ALL } = __req('./seed.js');
function seedBaseMap(name = '内置世界骨架') {
    const graph = new MapGraph(SEED_ALL.map(node => ({ ...node })));
    return { ...toBaseMap(graph), name, sourceRef: undefined };
}
/** 把 incoming 合并进 base（就地修改 base.nodes），返回统计 */
function mergeBaseMaps(base, incoming, options = {}) {
    const source = options.source ?? 'preset';
    const byPath = new Map(base.nodes.map(node => [node.path, node]));
    const report = { added: 0, updated: 0, skipped: 0, conflicts: [] };
    for (const node of incoming.nodes ?? []) {
        if (!node || typeof node.path !== 'string')
            continue;
        const existing = byPath.get(node.path);
        if (!existing) {
            const copy = { ...node, source, status: node.status ?? 'ok' };
            base.nodes.push(copy);
            byPath.set(copy.path, copy);
            report.added++;
            continue;
        }
        const protectedNode = existing.locked || existing.source === 'manual';
        if (protectedNode && !options.force) {
            const moved = Math.abs(existing.xy[0] - node.xy[0]) > 1 || Math.abs(existing.xy[1] - node.xy[1]) > 1;
            if (moved) {
                report.conflicts.push({ path: existing.path, kept: existing.xy, dropped: node.xy });
            }
            report.skipped++;
            continue;
        }
        existing.xy = [Number(node.xy[0]) || existing.xy[0], Number(node.xy[1]) || existing.xy[1]];
        if (node.kind)
            existing.kind = node.kind;
        if (node.note)
            existing.note = node.note;
        if (typeof node.altitude === 'number')
            existing.altitude = node.altitude;
        if (options.force)
            existing.locked = node.locked ?? false;
        existing.source = source;
        report.updated++;
    }
    base.updatedAt = new Date().toISOString();
    return report;
}
/** 拉取作者预设（GitHub raw / jsdelivr 都行，jsdelivr 带 CORS 头） */
async function fetchPresetMap(url) {
    if (!url)
        return null;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const data = (await response.json());
    if (!data || !Array.isArray(data.nodes))
        throw new Error('预设格式不正确：缺少 nodes 数组');
    return migrateBaseMap({ ...data, hiddenIds: data.hiddenIds ?? [] });
}
/**
 * 决定首次/重置时用哪份底图。
 * local 有效就不覆盖（除非 forcePreset）；否则依次尝试作者预设、内置骨架。
 */
async function resolveInitialBaseMap(options) {
    if (options.local && !options.forcePreset) {
        return { map: options.local, source: 'local' };
    }
    const seed = seedBaseMap(options.presetUrl ? '作者预设 + 内置骨架' : '内置世界骨架');
    if (!options.presetUrl)
        return { map: seed, source: 'seed' };
    try {
        const preset = await fetchPresetMap(options.presetUrl);
        if (!preset)
            return { map: seed, source: 'seed' };
        seed.name = preset.name || seed.name;
        seed.sourceRef = { repo: preset.sourceRef?.repo ?? '', ref: preset.sourceRef?.ref ?? '', url: options.presetUrl };
        const report = mergeBaseMaps(seed, preset, { source: 'preset', force: false });
        seed.hiddenIds = preset.hiddenIds ?? [];
        return { map: seed, source: 'preset', report };
    }
    catch (error) {
        return { map: seed, source: 'seed', presetError: String(error) };
    }
}
//# sourceMappingURL=preset.js.map
return { seedBaseMap, mergeBaseMaps, fetchPresetMap, resolveInitialBaseMap };
});
__def("./layout-ai.js", () => {
const { COORD_MAX, COORD_MIN } = __req('./types.js');
const { isBearingSegment, isTrivialFacility, looksLikeDescription } = __req('./path.js');
/**
 * 条目名以这些词开头 → 算地点类条目。
 *
 * 注意「地点」和「势力」是**裸前缀**（不要求后面跟冒号）：整理世界书时
 * `地点：X`、`地点-X`、`势力：X`、`势力X` 各种写法都出现过。之前只认带冒号的
 * `地点：`/`势力详情：`，结果一整批「势力」条目被漏掉，底图上没有这些宗门。
 */
const LOCATION_COMMENT = /^(地点|势力|秘境详情|妖族势力|设施[-—]|区域[-—])/;
const LOCATION_CONTENT = /(驻地\s*[:：]|位置\s*[:：]|相对距离\s*[:：]|空间距离\s*[:：]|距[^，。；]{1,12}[0-9０-９]+\s*亿里)/;
/** 仙界相关条目：当前剧情舞台是玄天界，整套跳过 */
const IMMORTAL_ENTRY = /(仙界|仙域|天庭|瑶池|凌霄|界碑关)/;
/** 世界骨架档固定要取的条目名 */
const WORLD_SKELETON_NAMES = ['玄天界介绍', '玄天界周期性秘境', '秘境详情：蓬莱仙岛'];
/** 剥掉 `[MOD][xxx]` 之类的前缀，拿到真正的条目名 */
function entryTitle(comment) {
    return comment.replace(/^\[MOD\](\[[^\]]*\]){0,4}/, '').trim();
}
function isLocationEntry(comment, content) {
    const name = entryTitle(comment);
    if (IMMORTAL_ENTRY.test(name))
        return false;
    if (LOCATION_COMMENT.test(name))
        return true;
    if (comment.startsWith('[MOD]') && /(地点|设施|区域|坊|宫|城|宗|谷|岛)/.test(name))
        return true;
    return LOCATION_CONTENT.test(content) && content.length > 60;
}
/** 读当前聊天挂着的所有世界书（角色主书 + 扩展书 + 全局书） */
async function collectLocationEntries() {
    const names = new Set();
    try {
        const charBooks = getCharWorldbookNames('current');
        if (charBooks?.primary)
            names.add(charBooks.primary);
        for (const name of charBooks?.additional ?? [])
            names.add(name);
    }
    catch (error) {
        window.console.warn('[世界舆图] 读取角色世界书名失败', error);
    }
    try {
        for (const name of getGlobalWorldbookNames())
            names.add(name);
    }
    catch (error) {
        window.console.warn('[世界舆图] 读取全局世界书名失败', error);
    }
    const entries = [];
    let total = 0;
    for (const book of names) {
        try {
            const list = (await getWorldbook(book));
            total += list.length;
            for (const raw of list) {
                // 注意：JSR 的 WorldbookEntry 用的是 `name`（不是原始 JSON 里的 `comment`），
                // 关键字在 `strategy.keys`（不是 `key`）。这里两种形状都兼容。
                const entry = raw;
                const comment = String(entry?.name ?? entry?.comment ?? '');
                const content = String(entry?.content ?? '');
                if (!content.trim())
                    continue;
                if (!isLocationEntry(comment, content))
                    continue;
                const keys = Array.isArray(entry?.strategy?.keys)
                    ? entry.strategy.keys.map(String)
                    : Array.isArray(entry?.key)
                        ? entry.key.map(String)
                        : [];
                entries.push({ book, comment, content, keys });
            }
        }
        catch (error) {
            window.console.warn(`[世界舆图] 读取世界书「${book}」失败`, error);
        }
    }
    entries.sort((a, b) => a.comment.localeCompare(b.comment, 'zh'));
    window.console.info(`[世界舆图] 世界书 ${names.size} 本 / 条目 ${total} 条 / 命中地点类 ${entries.length} 条`);
    return { entries, books: [...names], total };
}
/** 按批次挡位挑选条目 */
function selectEntries(entries, scope, focusPath) {
    if (scope === 'all')
        return entries;
    if (scope === 'world') {
        return entries.filter(entry => {
            const name = entryTitle(entry.comment);
            if (WORLD_SKELETON_NAMES.some(fixed => name === fixed || name.endsWith(fixed)))
                return true;
            // 「地点」和「势力」开头的全都要 —— 只收地点会把所有宗门/门派漏掉
            return /^(地点|势力)/.test(name);
        });
    }
    // region：挑与该路径有关联的条目
    const focusSegments = (focusPath ?? '').split('·').filter(Boolean);
    const focusName = focusSegments[focusSegments.length - 1] ?? '';
    return entries.filter(entry => {
        const name = entryTitle(entry.comment);
        if (focusName && (name.includes(focusName) || entry.content.includes(focusName)))
            return true;
        return focusSegments.some(segment => segment.length >= 2 && entry.content.includes(segment));
    });
}
const SYSTEM_PROMPT = `你是一个修仙世界的地理测绘助手。你要把给定的世界观资料整理成**十字坐标轴上的节点**，输出严格 JSON。

【只画玄天界】
- 本次只测绘「玄天界」。资料里凡属于**仙界/仙域/天庭/瑶池/凌霄**的内容一律**不要**输出。
- 玄天界 = 中央神州居中，四方为东极青木域、南离火洲、西漠佛国、北冥雪原。

【坐标系：神都洛阳就是原点】
- **中央神州·大周仙朝·神都洛阳 = (0,0)** —— 它是整个坐标系的原点，也是一切距离换算的基准。
- 画布是 **-500..500 的有符号坐标**：正东 +x、正南 +y，**向西 / 向北为负**。
  例：北冥雪原在正北 → y 是负的；西漠佛国在正西 → x 是负的。
- 换算比例：**1 单位 = 15 亿里**。资料写「距神都 700 亿里、向西」就换算成 x = -700/15 ≈ -47。
- 固定锚点（直接采用，不要改）：
  神都(0,0)、东极青木域(200,0)、西漠佛国(-200,0)、南离火洲(0,200)、北冥雪原(0,-200)；
  中央神州四条边界：无尽山脉(100,0)、叹息沙海(-100,0)、烬骨荒原(0,100)、绝迹冰谷(0,-100)。
- **所有坐标都围着神都铺开**：先钉死神都在 (0,0)，再按方位/距离把其余地点摆到它四周，
  不要出现整张图偏离原点、或者把神都挪到别处的情况。
- 只有方位没有距离时，按方位给合理偏移（东南方就 x+40、y+40 之类），宁可粗略也不要留空。
- 同一父级下的兄弟节点必须彼此分开，不要重叠。

【第一件事：把该有的都找齐，一个都不能漏】
- 资料里**每一条以「地点」「势力」开头的条目，都必须产出一个节点**。有 20 条就出 20 个，
  不许因为「不好定位」就跳过。同一个地方在两条资料里重复出现的，合并成一个。
- 输出前自己核对一遍：条目数 ≈ 节点数。

【第二件事：坐标要有依据，不许编】
- 先把**所有条目正文**里的方位、距离、相邻关系（「在X东北约300亿里」「紧邻Y」「位于Z腹地」）找出来，
  让不同条目**相互印证**：A 条说它在神都以东、B 条说它挨着沂云森林，就结合两条一起定坐标。
- 只有一处资料提到它时，用那处给出的「相对某个已知地点的方向+距离」推算。
- 完全没有任何方位线索时，挂到最合理的上级节点附近，并在 note 里写明「资料未给方位，按上级估算」。
- **禁止为了凑数随手编坐标**。宁可贴着上级放，也不要凭空给一个看起来精确的数。

【第三件事：分清楚「省」和「市」—— 这里最容易画错】
资料里这两类的体量差着两个数量级，**绝不能都画成一样大的点**：

1) 大区（相当于「省」）：\`*州\`、\`*域\`、\`*国\`、\`*洲\`、\`*原\`、\`*界\` 这类横跨几千亿里的整体。
   - kind 用 region；只有最上层的玄天界用 realm。
   - **它是一片范围，不是一个点**：除 x/y（填范围中心）外，还要给 \`shape\` —— 沿资料描述的实际走向，
     用 4~8 个顶点把这片地方的边界围出来。顶点用同一套有符号坐标，首尾不用重复，形状大体符合资料里的长宽。
     例：东极青木域东西 3800 亿里（≈253 单位）、南北 4500 亿里（≈300 单位），中心在 (200,0)，
     shape 可以是 [[200,-150],[330,-80],[335,90],[200,150],[75,90],[70,-80]]。
2) 点（相当于「市」）：\`*宗\`、\`*门\`、\`*派\`、\`*谷\`、\`*林\`、\`*沼\`、\`*宫\`、\`*殿\`、\`*城\`、\`*坊\`、\`*塔\`、\`*岛\`。
   - 势力 / 宗门 / 门派 / 家族 → kind 用 city（宗级势力一律按市级处理）。
   - 单个地理点（秘境、岛屿、塔、遗址）→ kind 用 site。
   - 这些**只给 x/y，不要给 shape**，它们就是一个点。
- 判断口径：**某个「宗」一定在某个「州」的内部**。同一批里如果两个节点体量明显一大一小，
  大的那个就该是带 shape 的 region，小的那个是 city/site；不要让「州」和「宗」变成同一级的两个点。

【绝对不要做成节点的东西】
- **纯方位词**：东部/南部/西部/北部/东南部/西南部/东北部/西北部/极东/极西/中部/中域腹地/腹地 —— 这些只表示方向，
  **不要把方位词单独输出成一个节点**，也不要用它当父路径的中间层。例如「中央神州·西部·蜀山剑门」要输出成
  「中央神州·蜀山剑门」，位置按「向西 700 亿里」算即可。
- 环境描述（含「的」「半垂」「明灭」这类描写的短句）。
- 零碎设施：马厩、柴房、水井、后院、某某客房、某某铺子、某家门口。**不要输出 room 这一级**，
  它们只会把地图糊成一团。
- 重复地点：同一个地方只输出一次，用资料里最完整的那个名字。

【输出格式】只输出这个 JSON，不要解释、不要代码块围栏：
{"nodes":[
{"path":"中央神州·大周仙朝·神都","x":0,"y":0,"kind":"city","note":"资料：玄天界中心，坐标系原点"},
{"path":"东极青木域","x":200,"y":0,"kind":"region","shape":[[200,-150],[330,-80],[335,90],[200,150],[75,90],[70,-80]],"note":"资料：最东方，东西3800亿里、南北4500亿里"}
],"edges":[{"from":"中央神州","to":"东极青木域","kind":"边界"}]}
path 用「·」连接、从大到小；不要出现方位词层。shape 只给 realm / region，其他一律不给。
再强调一次：神都洛阳必须是 (0,0)，向西 / 向北的坐标是负数。`;
/** 宽容地读 shape：只接受 [x,y] 数组，至少 3 个点，坐标落在画布内 */
function sanitizeShape(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const points = [];
    for (const item of raw) {
        if (!Array.isArray(item) || item.length < 2)
            continue;
        const x = Number(item[0]);
        const y = Number(item[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            continue;
        if (x < COORD_MIN - 50 || x > COORD_MAX + 50 || y < COORD_MIN - 50 || y > COORD_MAX + 50)
            continue;
        points.push([x, y]);
    }
    return points.length >= 3 ? points : undefined;
}
/** 允许 AI 输出的层级：界域/地域/城池/势力/具体地点（不要 room，会糊成一团） */
const ALLOWED_AI_KINDS = ['realm', 'region', 'city', 'power', 'site'];
function buildLayoutPrompt(entries, options) {
    const budget = options.budget ?? 24000;
    const scopeLabel = options.scope === 'world' ? '世界骨架（大域/大势力/主要城池）' : options.scope === 'region' ? `区域细分：${options.focusPath ?? ''}` : '全部地点';
    const header = `任务：绘制【${scopeLabel}】。\n\n已知节点（不要改动它们的坐标，只补充新节点）：\n`;
    const known = options.existing
        .filter(node => node.depth <= 3)
        .slice(0, 120)
        .map(node => `${node.path} (${node.xy[0]},${node.xy[1]})`)
        .join('\n');
    let used = 0;
    const chunks = [];
    for (const entry of entries) {
        const body = entry.content.length > 1200 ? entry.content.slice(0, 1200) + '…' : entry.content;
        const chunk = `\n### ${entry.comment}\n${body}\n`;
        if (used + chunk.length > budget)
            break;
        used += chunk.length;
        chunks.push(chunk);
    }
    const user = `${header}${known}\n\n世界观资料：\n${chunks.join('')}\n\n请输出 JSON。`;
    return { system: SYSTEM_PROMPT, user, used, total: entries.length };
}
/** 宽容解析：剥围栏 → 直接 parse → 修复后再 parse */
function parseLayoutReply(text) {
    const candidates = [];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced)
        candidates.push(fenced[1]);
    candidates.push(text);
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0)
        candidates.push(text.slice(firstBrace));
    for (const candidate of candidates) {
        const body = candidate.trim();
        for (const attempt of [body, repairJsonLoose(body)]) {
            try {
                const parsed = JSON.parse(attempt);
                const nodes = Array.isArray(parsed) ? parsed : parsed?.nodes;
                if (!Array.isArray(nodes))
                    continue;
                const result = [];
                for (const node of nodes) {
                    const path = String(node?.path ?? '').trim();
                    const x = Number(node?.x ?? node?.xy?.[0]);
                    const y = Number(node?.y ?? node?.xy?.[1]);
                    if (!path || !Number.isFinite(x) || !Number.isFinite(y))
                        continue;
                    result.push({ path, x, y, kind: node?.kind, shape: sanitizeShape(node?.shape), note: node?.note });
                }
                if (result.length)
                    return result;
            }
            catch {
                /* 试下一种 */
            }
        }
    }
    return [];
}
function repairJsonLoose(text) {
    let body = text.trim();
    const start = body.indexOf('{');
    if (start > 0)
        body = body.slice(start);
    const lastBrace = body.lastIndexOf('}');
    if (lastBrace >= 0)
        body = body.slice(0, lastBrace + 1);
    return body.replace(/,\s*([\]}])/g, '$1');
}
/** 把 AI 给的节点合并进图（就地修改 graph） */
function mergeAiLayout(graph, nodes) {
    const result = { added: 0, moved: 0, skippedLocked: 0, skippedBad: 0, skippedTrivial: 0, conflicts: [] };
    const sorted = [...nodes].sort((a, b) => a.path.split('·').length - b.path.split('·').length);
    for (const item of sorted) {
        const x = Number(item.x);
        const y = Number(item.y);
        if (!Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < COORD_MIN - 50 ||
            x > COORD_MAX + 50 ||
            y < COORD_MIN - 50 ||
            y > COORD_MAX + 50) {
            result.skippedBad++;
            continue;
        }
        const segments = item.path
            .split('·')
            .map(part => part.trim())
            .filter(Boolean)
            // 方位词不做节点：即使模型没听话，这里也把它剥掉
            .filter(segment => !isBearingSegment(segment));
        if (!segments.length || segments.some(looksLikeDescription)) {
            result.skippedBad++;
            continue;
        }
        // 只接受界域/地域/城池/势力/具体地点；零碎设施（room 那一级）一律丢弃
        const kind = item.kind;
        if (kind && !ALLOWED_AI_KINDS.includes(kind)) {
            result.skippedTrivial++;
            continue;
        }
        if (segments.some(segment => isTrivialFacility(segment))) {
            result.skippedTrivial++;
            continue;
        }
        const resolved = graph.resolve(segments.join('·'), { create: true, source: 'ai' });
        if (!resolved) {
            result.skippedBad++;
            continue;
        }
        const node = resolved.node;
        if (node.locked || node.source === 'manual') {
            const moved = Math.abs(node.xy[0] - x) > 1 || Math.abs(node.xy[1] - y) > 1;
            if (moved)
                result.conflicts.push({ path: node.path, kept: node.xy, dropped: [x, y] });
            result.skippedLocked++;
            continue;
        }
        const wasNew = resolved.created;
        node.xy = [x, y];
        node.source = 'ai';
        node.status = 'ok';
        if (item.kind)
            node.kind = item.kind;
        // shape 只对「一片地方」有意义：大区留下，点状节点一律清掉
        const isArea = node.kind === 'realm' || node.kind === 'region';
        node.shape = isArea ? item.shape ?? node.shape : undefined;
        if (item.note)
            node.note = item.note;
        if (wasNew)
            result.added++;
        else
            result.moved++;
    }
    return result;
}
/** 调一次模型（OpenAI 兼容端点，不经过酒馆正文管道） */
async function requestLayout(settings, prompt) {
    const base = settings.api.url.replace(/\/+$/, '');
    const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(settings.api.key ? { Authorization: `Bearer ${settings.api.key}` } : {}),
        },
        body: JSON.stringify({
            model: settings.api.model,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
            ],
            temperature: settings.api.temperature,
            max_tokens: settings.api.maxTokens,
            stream: false,
        }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 300)}`);
    }
    const data = (await response.json());
    const choice = data?.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text) {
        // 「空回复」几乎都是输出被 max_tokens 掐掉了：有的服务端这时 content 直接是空串，
        // 有的会把已生成的一半塞进 content、finish_reason 是 length。两种都要说清楚。
        const limit = settings.api.maxTokens;
        const used = data?.usage?.completion_tokens;
        if (choice?.finish_reason === 'length') {
            throw new Error(`模型输出被「上限」截断（上限 ${limit}${used ? `，已用 ${used}` : ''}）。` +
                `资料太多时模型要吐很长的 JSON，把设置里的「上限」调大到 16384 以上再试。`);
        }
        if (choice?.message?.reasoning_content) {
            throw new Error(`模型只返回了思考过程、没有返回 JSON（上限 ${limit}）。` +
                `换一个直接输出答案的模型（名称里带 nothinking / non-thinking 的），或把上限调大。`);
        }
        throw new Error(`模型返回为空（上限 ${limit}）。常见原因：上限太小被截断、模型不支持该端点、或服务端把回复放进了别的字段。` +
            `把「上限」调到 16384 以上再试；仍为空就换个模型。`);
    }
    if (choice?.finish_reason === 'length') {
        // 有内容但被截断：多半解析不出完整 JSON，提前给出可操作的提示
        window.console.warn(`[世界舆图] 模型输出被上限截断（${settings.api.maxTokens}），可能解析失败`);
    }
    return { text, usage: data.usage };
}
/** 一次性走完：收集 → 挑选 → 请求 → 合并 */
async function runLayout(graph, settings, scope, focusPath, onProgress) {
    onProgress?.('正在读取世界书…');
    const { entries, books, total } = await collectLocationEntries();
    if (!entries.length) {
        throw new Error(`没有读到任何地点类世界书条目（共检查 ${books.length} 本世界书 / ${total} 条条目：` +
            `${books.join('、') || '没读到书名'}）。请确认当前角色卡绑定了世界书。`);
    }
    const picked = selectEntries(entries, scope, focusPath);
    if (!picked.length) {
        throw new Error(`世界书里读到了 ${entries.length} 条地点类条目，但这一档（${scope === 'world' ? '世界骨架' : scope === 'region' ? '当前区域' : '全部'}）没筛出可用的。` +
            `换个档位试试，或先用「全部地点」。`);
    }
    const prompt = buildLayoutPrompt(picked, { scope, focusPath, existing: graph.toArray() });
    onProgress?.(`已选 ${prompt.total} 条资料（约 ${Math.round(prompt.used / 1000)}k 字符），正在请求模型…`);
    const { text } = await requestLayout(settings, prompt);
    const nodes = parseLayoutReply(text);
    if (!nodes.length)
        throw new Error('模型返回的内容无法解析出任何节点，已放弃本次生成');
    onProgress?.(`模型返回 ${nodes.length} 个节点，正在合并…`);
    const result = mergeAiLayout(graph, nodes);
    return { result, used: prompt.used, total: prompt.total, picked, rawReply: text };
}
function graphToBaseMapPatch(graph, base) {
    base.nodes = graph.toArray();
    base.updatedAt = new Date().toISOString();
    return base;
}
//# sourceMappingURL=layout-ai.js.map
return { entryTitle, isLocationEntry, collectLocationEntries, selectEntries, buildLayoutPrompt, parseLayoutReply, mergeAiLayout, requestLayout, runLayout, graphToBaseMapPatch };
});
__def("./ui/theme.js", () => {
const STYLE_ID = 'worldmap-style';
const CSS = `
.worldmap-root, .worldmap-root * { box-sizing: border-box; }
.worldmap-root {
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
  min-width: 340px; min-height: 240px;
  font-family: "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", Georgia, serif;
  font-size: 13px; line-height: 1.6;
  color: #241d13;
  background:
    radial-gradient(135% 105% at 16% -4%, #fdf6e2 0%, #f6ead0 38%, #ecdcb8 68%, #ddc79c 100%);
  border: 1px solid rgba(104,80,44,.62);
  border-radius: 12px;
  box-shadow: 0 20px 56px rgba(0,0,0,.48), 0 2px 0 rgba(255,255,255,.28) inset, 0 0 80px rgba(150,120,70,.2) inset;
  overflow: hidden;
  transition: width .22s ease, box-shadow .22s ease;
}
.worldmap-root::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    repeating-linear-gradient(0deg, rgba(124,96,54,.055) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(124,96,54,.042) 0 1px, transparent 1px 4px),
    radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(120,92,50,.13) 100%);
}
.worldmap-root > * { position: relative; z-index: 1; }
.worldmap-root.dym-collapsed { min-height: 0; height: auto !important; }
.worldmap-root.dym-collapsed .dym-body,
.worldmap-root.dym-collapsed .dym-timeline { display: none; }

/* ── 贴边窄条：做成"索引标贴"那种小书签，贴在页面边缘 ───────────────── */
.worldmap-root.dym-rail {
  width: 30px !important; min-width: 30px; min-height: 0;
  border-radius: 8px 0 0 8px;
  border-right: none;
  background: linear-gradient(180deg, #cf9350 0%, #b0702f 55%, #96581f 100%);
  box-shadow: -4px 6px 16px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.25) inset;
  transition: width .2s ease;
}
.worldmap-root.dym-rail.dym-rail-left { border-radius: 0 8px 8px 0; border-right: 1px solid rgba(104,80,44,.62); border-left: none; box-shadow: 4px 6px 16px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.25) inset; }
.worldmap-root.dym-rail::before { display: none; }
.worldmap-root.dym-rail .dym-body,
.worldmap-root.dym-rail .dym-timeline,
.worldmap-root.dym-rail .dym-resize { display: none !important; }
.worldmap-root.dym-rail .dym-titlebar {
  flex-direction: column; height: 100%; padding: 9px 0; gap: 7px;
  background: transparent; box-shadow: none; cursor: pointer;
}
.worldmap-root.dym-rail .dym-title {
  writing-mode: vertical-rl; font-size: 12.5px; letter-spacing: .3em; color: #fff8e8;
  text-shadow: 0 1px 2px rgba(0,0,0,.35);
}
.worldmap-root.dym-rail .dym-badge,
.worldmap-root.dym-rail .dym-spacer,
.worldmap-root.dym-rail .dym-actions { display: none; }
.dym-rail-hint { display: none; }
.worldmap-root.dym-rail .dym-rail-hint {
  display: block; writing-mode: vertical-rl; font-size: 9.5px; letter-spacing: .18em;
  color: rgba(255,248,232,.78);
}

/* ── 区域轮廓：界域/地域用虚线多边形围出范围 ─────────────────────────── */
.dym-region {
  stroke-dasharray: 7 5;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-width: 1.4;
  stroke: rgba(120, 100, 60, .6);
  fill: rgba(120, 100, 60, .04);
  pointer-events: none;
}
.dym-region-realm {
  stroke: rgba(146, 104, 42, .78);
  fill: rgba(146, 104, 42, .05);
  stroke-width: 1.9;
}
.dym-region-region {
  stroke: rgba(111, 125, 69, .72);
  fill: rgba(111, 125, 69, .045);
  stroke-width: 1.3;
}

/* ── 标题栏 ─────────────────────────────────────────────────────────── */
.dym-titlebar {
  display: flex; align-items: center; gap: 9px; padding: 8px 11px; flex: 0 0 auto;
  background: linear-gradient(180deg, #6d4a24 0%, #55381b 60%, #452c14 100%);
  color: #f6ead0; cursor: move; user-select: none;
  box-shadow: 0 1px 0 rgba(255,255,255,.14) inset, 0 2px 6px rgba(0,0,0,.28);
}
.dym-title { font-size: 15.5px; letter-spacing: .18em; font-weight: 700; text-shadow: 0 1px 0 rgba(0,0,0,.45); }
.dym-badge {
  font-size: 12px; padding: 1px 9px; border-radius: 10px; max-width: 48%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: rgba(246,234,208,.16); border: 1px solid rgba(246,234,208,.34);
}
.dym-spacer { flex: 1 1 auto; }
.dym-actions { display: flex; gap: 5px; }
.dym-actions button {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(246,234,208,.38); background: rgba(246,234,208,.14); color: #f6ead0;
  border-radius: 7px; cursor: pointer; font-size: 14px; line-height: 1; font-family: inherit;
}
.dym-actions button:hover { background: rgba(246,234,208,.3); }

/* ── 通用按钮：侧栏是浅底，必须用深色字，否则会"看不见但能点" ────────── */
.dym-btn {
  border: 1px solid rgba(110,84,46,.45);
  background: linear-gradient(180deg, rgba(255,252,244,.92), rgba(244,232,208,.78));
  color: #4a3418; border-radius: 7px; cursor: pointer; font-size: 12.5px; padding: 4px 10px;
  line-height: 1.5; font-family: inherit; box-shadow: 0 1px 2px rgba(120,92,50,.16);
}
.dym-btn:hover { background: linear-gradient(180deg, #fffdf7, #f0e2c2); border-color: rgba(110,84,46,.72); }
.dym-btn:active { transform: translateY(1px); }
.dym-btn:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
.dym-btn.dym-primary {
  background: linear-gradient(180deg, #b8542f, #94401f); border-color: #7d3316; color: #fdf3e2;
  text-shadow: 0 1px 0 rgba(0,0,0,.25);
}
.dym-btn.dym-primary:hover { background: linear-gradient(180deg, #c65c34, #a04722); }
.dym-btn.dym-danger { color: #96331a; border-color: rgba(150,51,26,.45); background: linear-gradient(180deg, #fff8f2, #f4e0d2); }
.dym-btn.dym-danger:hover { background: linear-gradient(180deg, #fff, #f0d3c0); border-color: rgba(150,51,26,.7); }
.dym-btn.dym-danger[data-armed="1"] { background: linear-gradient(180deg, #b8542f, #94401f); border-color: #7d3316; color: #fdf3e2; }
.dym-titlebar .dym-btn { border-color: rgba(246,234,208,.38); background: rgba(246,234,208,.14); color: #f6ead0; }
.dym-titlebar .dym-btn:hover { background: rgba(246,234,208,.3); }
.dym-actions button.dym-on { background: rgba(246,234,208,.34); color: #fff8e8; }

.dym-body { display: flex; flex: 1 1 auto; min-height: 0; }
.dym-canvas-wrap { position: relative; flex: 1 1 auto; min-width: 120px; overflow: hidden; }
.dym-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.dym-svg.dym-panning { cursor: grabbing; }
.dym-svg.dym-editing { cursor: crosshair; }

.dym-breadcrumb {
  position: absolute; left: 9px; top: 9px; display: flex; flex-wrap: wrap; gap: 2px; align-items: center;
  font-size: 12px; background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.4);
  border-radius: 8px; padding: 3px 8px; max-width: calc(100% - 18px);
  box-shadow: 0 1px 4px rgba(120,92,50,.14);
}
.dym-breadcrumb span { cursor: pointer; color: #7a5321; }
.dym-breadcrumb span:hover { color: #a3462a; text-decoration: underline; }
.dym-breadcrumb i { color: #b09772; font-style: normal; margin: 0 1px; }
.dym-breadcrumb b { color: #3a2c17; }

.dym-zoomctl { position: absolute; right: 9px; bottom: 9px; display: flex; flex-direction: column; gap: 4px; }
.dym-zoomctl button {
  width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1;
  background: rgba(255,251,238,.94); border: 1px solid rgba(122,96,58,.45); color: #4a3418;
  box-shadow: 0 1px 3px rgba(120,92,50,.2);
}
.dym-zoomctl button:hover { background: #fff; }

.dym-legend {
  position: absolute; left: 9px; bottom: 9px; font-size: 11px; color: #6a5433;
  background: rgba(255,251,238,.88); border: 1px solid rgba(122,96,58,.32); border-radius: 8px;
  padding: 3px 7px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 46%;
}
.dym-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
.dym-status {
  position: absolute; right: 9px; top: 9px; font-size: 11.5px; color: #6a5433;
  background: rgba(255,251,238,.88); border: 1px solid rgba(122,96,58,.32); border-radius: 8px; padding: 3px 8px;
  max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 侧栏（信息面板）─────────────────────────────────────────────────── */
/* 用比例而不是固定像素：设置页控件多，固定 250px 会被挤成一团；
   min-width:0 是关键 —— 否则侧栏会被内容的 min-content 宽度顶大（曾经被 textarea 顶到 431px）。 */
.dym-drawer {
  flex: 0 0 46%; min-width: 0; max-width: 520px;
  display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid rgba(122,96,58,.32); background: rgba(253,248,235,.5);
}
.worldmap-root.dym-narrow .dym-drawer { flex-basis: 232px; }

/* 收起右侧栏：画布占满，把手留在右沿 */
.worldmap-root.dym-drawer-off .dym-drawer { display: none; }
.dym-drawer-toggle {
  flex: 0 0 14px; width: 14px; padding: 0; cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 700; line-height: 1; color: #6b4f28;
  border: none; border-left: 1px solid rgba(122,96,58,.34);
  background: linear-gradient(90deg, rgba(240,228,203,.65), rgba(232,217,187,.98));
  box-shadow: inset 1px 0 0 rgba(255,255,255,.5);
}
.dym-drawer-toggle:hover { color: #9c3a1e; background: linear-gradient(90deg, rgba(246,214,190,.9), rgba(240,200,170,.98)); }
.dym-drawer-toggle:active { transform: translateX(1px); }
.worldmap-root.dym-drawer-off .dym-drawer-toggle { border-left-color: rgba(122,96,58,.45); }
.worldmap-root.dym-rail .dym-drawer-toggle { display: none; }
.dym-tabs { display: flex; border-bottom: 1px solid rgba(122,96,58,.3); flex: 0 0 auto; background: rgba(246,236,214,.6); }
.dym-tabs button {
  flex: 1 1 auto; padding: 7px 2px 6px; font-size: 13px; cursor: pointer; font-family: inherit;
  background: transparent; border: none; border-bottom: 2.5px solid transparent; color: #7a6242;
}
.dym-tabs button:hover { color: #4a3418; }
.dym-tabs button.dym-active { color: #9c3a1e; border-bottom-color: #b8542f; font-weight: 700; background: rgba(255,253,246,.7); }
.dym-panes { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 10px; font-size: 13px; }
.dym-panes::-webkit-scrollbar { width: 9px; }
.dym-panes::-webkit-scrollbar-thumb { background: rgba(122,96,58,.34); border-radius: 6px; }
.dym-pane { display: none; }
.dym-pane.dym-active { display: block; }

.dym-field { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.dym-field label { flex: 0 0 58px; color: #7a6242; font-size: 12.5px; }
.dym-field input[type=text], .dym-field input[type=number], .dym-field select {
  flex: 1 1 auto; min-width: 0; font-family: inherit; font-size: 12.5px; padding: 4px 7px;
  border: 1px solid rgba(122,96,58,.4); border-radius: 6px; background: rgba(255,253,247,.95); color: #2b2114;
}
.dym-field input:focus, .dym-field select:focus { outline: 2px solid rgba(184,84,47,.35); }
.dym-row { display: flex; gap: 6px; margin-bottom: 7px; flex-wrap: wrap; }
.dym-hint {
  font-size: 12px; color: #7d6a4a; line-height: 1.75; margin: 5px 0 9px;
  background: rgba(255,252,244,.6); border-left: 2px solid rgba(184,84,47,.4); border-radius: 0 6px 6px 0; padding: 5px 8px;
}
.dym-sect { font-size: 12px; color: #8a6f45; letter-spacing: .1em; margin: 12px 0 6px; }

/* 设置页：分块折叠，别把一堆输入框挤在一屏 */
.dym-sec {
  border: 1px solid rgba(122,96,58,.32); border-radius: 9px; margin: 0 0 9px;
  background: linear-gradient(180deg, rgba(255,253,247,.82), rgba(248,240,224,.7));
  overflow: hidden;
}
.dym-sec > summary {
  cursor: pointer; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #6b4f28;
  list-style: none; display: flex; align-items: center; gap: 6px; letter-spacing: .04em;
}
.dym-sec > summary::-webkit-details-marker { display: none; }
.dym-sec > summary::before {
  content: ''; width: 0; height: 0; flex: 0 0 auto;
  border-left: 5px solid #a3462a; border-top: 4px solid transparent; border-bottom: 4px solid transparent;
  transition: transform .16s ease;
}
.dym-sec[open] > summary::before { transform: rotate(90deg) translateX(1px); }
.dym-sec > summary:hover { background: rgba(163,70,42,.08); }
.dym-sec[open] > summary { border-bottom: 1px solid rgba(122,96,58,.24); }
.dym-sec > *:not(summary) { margin-left: 10px; margin-right: 10px; }
.dym-sec > *:not(summary):first-of-type { margin-top: 9px; }
.dym-sec > *:not(summary):last-child { margin-bottom: 9px; }
.dym-sec .dym-field label { flex: 0 0 66px; }
.dym-pw { position: relative; flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
.dym-pw input { flex: 1 1 auto; min-width: 0; }
.dym-pw button {
  flex: 0 0 auto; margin-left: 4px; width: 28px; height: 26px; padding: 0; cursor: pointer;
  border: 1px solid rgba(122,96,58,.4); border-radius: 6px; background: rgba(255,253,247,.95); color: #6b4f28;
}
.dym-pw button:hover { background: #fff; color: #a3462a; }
.dym-field .dym-tip { flex: 0 0 auto; font-size: 11px; color: #9a8158; cursor: help; border-bottom: 1px dotted rgba(122,96,58,.6); }
.dym-report {
  margin: 8px 0 0; padding: 7px 9px; border-radius: 7px; max-height: 168px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: rgba(43,33,20,.06); border: 1px dashed rgba(122,96,58,.45); color: #4a3418; white-space: pre-wrap;
}
.dym-report:empty { display: none; }
.dym-list { list-style: none; margin: 0; padding: 0; }
.dym-list li {
  padding: 4px 6px; border-radius: 6px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; font-size: 13px;
}
.dym-list li:hover { background: rgba(163,70,42,.1); }
.dym-list li.dym-selected { background: rgba(163,70,42,.2); }
.dym-list .dym-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; transform: translateY(-1px); }
.dym-list .dym-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dym-list .dym-tag { font-size: 11px; color: #9a8158; flex: 0 0 auto; }
.dym-list .dym-unplaced { color: #a3462a; font-style: italic; }
.dym-list .dym-orphan { color: #6b7a45; }
.dym-switches { display: grid; grid-template-columns: 1fr; gap: 5px; margin-bottom: 10px; }
.dym-switches label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #4a3418; cursor: pointer; }
.dym-switches input { accent-color: #b8542f; width: 14px; height: 14px; }

/* 导出/导入用的文本框：让用户能直接复制去发给 AI，也能把改好的粘回来 */
.dym-io {
  width: 100%; min-height: 132px; resize: vertical; margin: 2px 0 6px;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.55;
  padding: 6px 8px; border: 1px solid rgba(122,96,58,.42); border-radius: 7px;
  background: rgba(255,253,247,.96); color: #2b2114; white-space: pre; overflow: auto;
}
.dym-io:focus { outline: 2px solid rgba(184,84,47,.35); }

.dym-timeline {
  flex: 0 0 auto; display: flex; align-items: center; gap: 9px; padding: 7px 11px;
  border-top: 1px solid rgba(122,96,58,.3); background: rgba(246,236,214,.72);
  font-size: 12.5px; color: #5a4526;
}
.dym-timeline input[type=range] { flex: 1 1 auto; accent-color: #b8542f; }
.dym-timeline .dym-time { flex: 0 0 auto; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dym-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; z-index: 3; }
.dym-resize::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px;
  border-right: 2px solid rgba(122,96,58,.65); border-bottom: 2px solid rgba(122,96,58,.65);
}
.dym-launcher {
  position: fixed; z-index: 2147483000; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700;
  font-family: "Songti SC", "STSong", "SimSun", serif;
  background: radial-gradient(circle at 32% 28%, #7c5528, #3f2a13);
  color: #f4e6c6; border: 1px solid rgba(246,234,208,.55);
  box-shadow: 0 8px 20px rgba(0,0,0,.45); user-select: none;
}
.dym-launcher:hover { transform: scale(1.06); }
.dym-launcher .dym-launcher-dot {
  position: absolute; top: -2px; right: -2px; width: 11px; height: 11px; border-radius: 50%;
  background: #c4563a; border: 1px solid #f6ead0;
}

/* ── SVG 图层 ───────────────────────────────────────────────────────── */
.dym-link { stroke: rgba(108,84,48,.45); fill: none; }
.dym-trail-glow { fill: none; stroke: rgba(196,110,70,.22); stroke-linejoin: round; stroke-linecap: round; }
.dym-trail { fill: none; stroke: #a83a1a; stroke-linejoin: round; stroke-linecap: round; }
.dym-node { cursor: pointer; }
.dym-node text {
  paint-order: stroke; stroke: rgba(253,247,232,.95); stroke-width: 3px;
  pointer-events: none; font-family: "Songti SC", "STSong", "SimSun", serif; fill: #241d13;
}
.dym-node.dym-dim { opacity: .3; }
.dym-node.dym-unplaced .dym-halo { stroke-dasharray: 3 2.5; }
.dym-node.dym-selected .dym-halo { stroke: #a83a1a; stroke-width: 2.4; }
.dym-halo { fill: none; }
.dym-pulse { fill: rgba(196,86,58,.26); }
.dym-compass { opacity: .45; pointer-events: none; }
`;
/** Lucide 图标（24×24 视口，只存路径数据） */
const ICONS = {
    realm: {
        paths: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
        circles: [[12, 12, 10]],
    },
    region: { paths: ['m8 3 4 8 5-5 5 15H2L8 3z'] },
    power: {
        paths: [
            'M10 18v-7',
            'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z',
            'M14 18v-7',
            'M18 18v-7',
            'M3 22h18',
            'M6 18v-7',
        ],
    },
    city: {
        paths: [
            'M10 5V3',
            'M14 5V3',
            'M15 21v-3a3 3 0 0 0-6 0v3',
            'M18 3v8',
            'M18 5H6',
            'M22 11H2',
            'M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9',
            'M6 3v8',
        ],
    },
    site: {
        paths: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'],
        circles: [[12, 10, 3]],
    },
    room: {
        paths: [
            'M10 21H2',
            'M10 3H7a2 2 0 0 0-2 2v16',
            'M14 12h.01',
            'M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992z',
            'M22 21h-3',
        ],
    },
    poi: {
        paths: [
            'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
            'M20 2v4',
            'M22 4h-4',
        ],
        circles: [[4, 20, 2]],
    },
};
/** 罗盘（Lucide compass） */
const COMPASS = {
    paths: ['m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'],
    circles: [[12, 12, 10]],
};
const KIND_COLORS = {
    realm: '#7b6a3e',
    region: '#6f7d45',
    power: '#8a4f24',
    city: '#a3462a',
    site: '#4f6d78',
    room: '#5d6f8a',
    poi: '#6f6252',
};
const KIND_LABELS = {
    realm: '界域',
    region: '地域',
    power: '宗门',
    city: '城池',
    site: '地点',
    room: '房间',
    poi: '地点',
};
function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID))
        return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
}
function escapeHtml(text) {
    const table = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text ?? '').replace(/[&<>"']/g, c => table[c] ?? c);
}
//# sourceMappingURL=theme.js.map
return { STYLE_ID, CSS, ICONS, COMPASS, KIND_COLORS, KIND_LABELS, ensureStyle, escapeHtml };
});
__def("./ui/canvas.js", () => {
const { ALTITUDE_OFFSET_PX, COLLAPSE_PX, COORD_MAX, COORD_MIN, TIER_FONT_PX, TIER_LABEL_SCALE, TIER_RADIUS_PX, TIER_VISIBLE_SCALE, tierOfKind } = __req('./types.js');
const { tierOf } = __req('./graph.js');
const { polylinePoints } = __req('./trail.js');
const { COMPASS, ICONS, KIND_COLORS, KIND_LABELS, escapeHtml } = __req('./ui/theme.js');
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
class MapCanvas {
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
        const next = Math.max(0.2, Math.min(90, this.scale * factor));
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
        this.scale = Math.max(0.2, Math.min(80, Math.min((w * 0.84) / bw, (h * 0.84) / bh)));
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
     */
    trailPos(point) {
        const graph = this.view.graph;
        const node = graph.get(point.nodeId);
        if (!node)
            return point.xy;
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
        return polylinePoints(cut, this.view.hiddenPointIds);
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
            if (this.scale >= threshold || keep.has(node.id))
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
        const links = el('g');
        if (this.view.showLinks) {
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
                links.appendChild(el('line', {
                    x1: from[0],
                    y1: from[1],
                    x2: to[0],
                    y2: to[1],
                    class: 'dym-link',
                    'vector-effect': 'non-scaling-stroke',
                    'stroke-width': 1.1,
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
                if (point.kind === 'travel' && segment.length) {
                    segment.push(positions[index]);
                    segmentTravel = true;
                    flush();
                    segment = [positions[index]];
                    segmentTravel = false;
                    return;
                }
                segment.push(positions[index]);
            });
            flush();
            const last = positions[positions.length - 1];
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
            const group = el('g', { class: 'dym-node', 'data-id': node.id });
            if (node.status === 'unplaced')
                group.classList.add('dym-unplaced');
            if (node.id === this.view.selectedId)
                group.classList.add('dym-selected');
            if (this.view.focusId && node.id !== this.view.focusId) {
                const inside = graph.ancestors(node.id).some(ancestor => ancestor.id === this.view.focusId);
                if (!inside && tier >= 3)
                    group.classList.add('dym-dim');
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
            group.appendChild(el('circle', { cx: pos[0], cy: pos[1], r: radius * 0.72, fill: color }));
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
            if (node.altitude) {
                const badge = el('text', {
                    x: pos[0] + radius * 1.15,
                    y: pos[1] - radius * 0.75,
                    'font-size': 12 / Math.max(0.3, this.scale),
                    fill: '#4f6d78',
                });
                badge.textContent = node.altitude > 0 ? '▲' : '▼';
                group.appendChild(badge);
            }
            nodeGroup.appendChild(group);
            const labelFrom = TIER_LABEL_SCALE[Math.min(tier, TIER_LABEL_SCALE.length - 1)] ?? 1;
            if (this.scale >= labelFrom || node.id === this.view.selectedId || node.id === currentId) {
                labelCandidates.push({ node, pos, tier });
            }
        }
        // 标签避让：大的先占位，压住的就不画。
        // 判定用的是**标签矩形**（锚点 + 文字宽度）而不是锚点距离 —— 否则右侧延伸的文字
        // 会盖住下一个点的标签，看起来就是一团糊。
        labelCandidates.sort((a, b) => a.tier - b.tier);
        const acceptedLabels = [];
        for (const item of labelCandidates) {
            const sx = item.pos[0] * this.scale + this.tx;
            const sy = item.pos[1] * this.scale + this.ty;
            const fontPx = TIER_FONT_PX[Math.min(item.tier, TIER_FONT_PX.length - 1)] ?? 12;
            const radiusPx = TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6;
            const x0 = sx + radiusPx * 1.35;
            const width = Math.max(14, item.node.name.length * fontPx * 1.02);
            const box = [x0 - 2, sy - fontPx * 0.8, x0 + width + 2, sy + fontPx * 0.4];
            const clash = acceptedLabels.some(existing => box[0] < existing.box[2] && box[2] > existing.box[0] && box[1] < existing.box[3] && box[3] > existing.box[1]);
            if (clash && item.node.id !== this.view.selectedId && item.node.id !== currentId)
                continue;
            acceptedLabels.push({ ...item, box });
            if (acceptedLabels.length >= 70)
                break;
        }
        for (const item of acceptedLabels) {
            const radius = ((TIER_RADIUS_PX[Math.min(item.tier, TIER_RADIUS_PX.length - 1)] ?? 6) * 0.9) / Math.max(0.3, this.scale);
            const fontPx = TIER_FONT_PX[Math.min(item.tier, TIER_FONT_PX.length - 1)] ?? 12;
            const text = el('text', {
                x: item.pos[0] + radius * 1.35,
                y: item.pos[1] + radius * 0.45,
                'font-size': fontPx / Math.max(0.3, this.scale),
                'font-weight': item.tier <= 2 ? '700' : '400',
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
        this.wrap.dataset.dymScale = this.scale.toFixed(2);
        this.wrap.dataset.dymNodes = String(accepted.length);
    }
    // ── 交互 ────────────────────────────────────────────────────────────
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
    bind() {
        this.svg.addEventListener('wheel', event => {
            event.preventDefault();
            const rect = this.svg.getBoundingClientRect();
            this.zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16, event.clientX - rect.left, event.clientY - rect.top);
        }, { passive: false });
        this.svg.addEventListener('pointerdown', event => {
            if (event.button !== 0)
                return;
            this.svg.setPointerCapture(event.pointerId);
            const node = this.hitTest(event.clientX, event.clientY);
            if (this.view.editMode && node) {
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
                this.svg.classList.add('dym-panning');
                return;
            }
            this.drag = {
                mode: 'pan',
                startX: event.clientX,
                startY: event.clientY,
                originX: this.tx,
                originY: this.ty,
                moved: false,
            };
            this.svg.classList.add('dym-panning');
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
            else if (this.drag.id) {
                const node = this.view.graph.get(this.drag.id);
                if (!node)
                    return;
                node.xy = [this.drag.originX + dx / this.scale, this.drag.originY + dy / this.scale];
                this.render();
            }
        });
        const endDrag = () => {
            if (!this.drag)
                return;
            const current = this.drag;
            this.drag = null;
            this.svg.classList.remove('dym-panning');
            if (current.mode === 'node' && current.id && current.moved) {
                const node = this.view.graph.get(current.id);
                if (node) {
                    this.hooks.onMoveNode(node.id, [Math.round(node.xy[0] * 100) / 100, Math.round(node.xy[1] * 100) / 100]);
                    this.suppressClick = true;
                }
            }
        };
        this.svg.addEventListener('pointerup', endDrag);
        this.svg.addEventListener('pointercancel', endDrag);
        this.svg.addEventListener('click', event => {
            if (this.suppressClick) {
                this.suppressClick = false;
                return;
            }
            const node = this.hitTest(event.clientX, event.clientY);
            this.hooks.onSelect(node ? node.id : null);
        });
        this.svg.addEventListener('dblclick', event => {
            const node = this.hitTest(event.clientX, event.clientY);
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
            const node = this.hitTest(event.clientX, event.clientY);
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
        return `层级 ${tierOf(node)}｜${KIND_LABELS[node.kind] ?? '地点'}｜(${node.xy[0].toFixed(1)}, ${node.xy[1].toFixed(1)})${altitude}${status}`;
    }
    destroy() {
        this.svg.remove();
    }
}
function defaultView(graph) {
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
const WORLD_BOUNDS = { min: COORD_MIN, max: COORD_MAX };
function html(text) {
    return escapeHtml(text);
}
//# sourceMappingURL=canvas.js.map
return { MapCanvas, defaultView, WORLD_BOUNDS, html, tierOfKind };
});
__def("./ui/window.js", () => {
const { ID_PREFIX } = __req('./types.js');
const { KIND_COLORS, KIND_LABELS, escapeHtml, ensureStyle } = __req('./ui/theme.js');
const TABS = [
    { key: 'layers', label: '图层' },
    { key: 'places', label: '地点' },
    { key: 'edit', label: '编辑' },
    { key: 'trail', label: '轨迹' },
    { key: 'settings', label: '设置' },
];
class MapWindow {
    doc;
    actions;
    canvasWrap;
    root;
    launcher;
    drawer;
    drawerHandle;
    panes = new Map();
    tabButtons = new Map();
    badge;
    timelineInput;
    timelineLabel;
    breadcrumb;
    statusBar;
    searchInput;
    fileInput;
    data;
    /**
     * 宿主窗口（酒馆主页面）。
     * 悬浮窗的坐标是相对宿主视口的，所以 innerWidth / 视口高度 / resize 事件都必须取宿主的，
     * 而不是脚本 iframe 自己的窗口 —— 后者永远是那个隐藏小 iframe 的尺寸。
     */
    host;
    dockSide = null;
    /** 贴边判定阈值（像素） */
    edgeThreshold = 18;
    constructor(doc, data, actions, canvasWrap) {
        this.doc = doc;
        this.actions = actions;
        this.canvasWrap = canvasWrap;
        this.host = (doc.defaultView ?? window);
        this.data = data;
        ensureStyle(doc);
        this.root = doc.createElement('div');
        this.root.id = `${ID_PREFIX}root`;
        this.root.className = 'worldmap-root';
        this.launcher = doc.createElement('div');
        this.launcher.id = `${ID_PREFIX}launcher`;
        this.launcher.className = 'dym-launcher';
        this.launcher.title = '世界舆图';
        this.launcher.innerHTML = '舆<span class="dym-launcher-dot"></span>';
        this.build();
        this.applyLayout(data.layout);
        this.bindChrome();
    }
    build() {
        const doc = this.doc;
        // 标题栏
        const bar = doc.createElement('div');
        bar.className = 'dym-titlebar';
        bar.innerHTML = `<span class="dym-title">世界舆图</span><span class="dym-badge" data-role="badge">—</span>
      <span class="dym-rail-hint">点开</span>
      <span class="dym-spacer"></span>
      <div class="dym-actions">
        <button data-act="drawer" title="收起 / 展开右侧栏">»</button>
        <button data-act="locate" title="定位到当前地点">⌖</button>
        <button data-act="fit" title="全图">⤢</button>
        <button data-act="close" title="关闭（点脚本按钮可重新打开）">×</button>
      </div>`;
        this.badge = bar.querySelector('[data-role=badge]');
        // 主体
        const body = doc.createElement('div');
        body.className = 'dym-body';
        const canvasWrap = this.canvasWrap;
        canvasWrap.classList.add('dym-canvas-wrap');
        if (!canvasWrap.id)
            canvasWrap.id = `${ID_PREFIX}canvas`;
        this.breadcrumb = doc.createElement('div');
        this.breadcrumb.className = 'dym-breadcrumb';
        const zoomCtl = doc.createElement('div');
        zoomCtl.className = 'dym-zoomctl';
        zoomCtl.innerHTML = `<button data-act="zoom-in">＋</button><button data-act="zoom-out">－</button>`;
        const legend = doc.createElement('div');
        legend.className = 'dym-legend';
        legend.innerHTML = ['realm', 'region', 'power', 'city', 'site']
            .map(kind => `<span><i style="background:${KIND_COLORS[kind]}"></i>${KIND_LABELS[kind]}</span>`)
            .join('');
        this.statusBar = doc.createElement('div');
        this.statusBar.className = 'dym-status';
        this.drawer = doc.createElement('div');
        this.drawer.className = 'dym-drawer';
        // 收起 / 展开右侧栏的把手：贴着侧栏左沿，侧栏收起后它就在窗口右沿（一直可点）
        this.drawerHandle = doc.createElement('button');
        this.drawerHandle.className = 'dym-drawer-toggle';
        this.drawerHandle.type = 'button';
        this.drawerHandle.title = '收起 / 展开右侧栏';
        this.drawerHandle.textContent = '›';
        this.drawerHandle.addEventListener('click', () => this.toggleDrawer());
        const tabs = doc.createElement('div');
        tabs.className = 'dym-tabs';
        const panes = doc.createElement('div');
        panes.className = 'dym-panes';
        for (const tab of TABS) {
            const button = doc.createElement('button');
            button.textContent = tab.label;
            button.dataset.tab = tab.key;
            button.addEventListener('click', () => this.setTab(tab.key));
            tabs.appendChild(button);
            this.tabButtons.set(tab.key, button);
            const pane = doc.createElement('div');
            pane.className = 'dym-pane';
            pane.dataset.pane = tab.key;
            panes.appendChild(pane);
            this.panes.set(tab.key, pane);
        }
        this.drawer.append(tabs, panes);
        // 时间轴
        const timeline = doc.createElement('div');
        timeline.className = 'dym-timeline';
        const range = doc.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '0';
        range.value = '0';
        range.addEventListener('input', () => {
            const value = Number(range.value);
            const max = Number(range.max);
            this.actions.onTimeline(value >= max ? null : value);
        });
        this.timelineInput = range;
        this.timelineLabel = doc.createElement('span');
        this.timelineLabel.className = 'dym-time';
        const latest = doc.createElement('button');
        latest.className = 'dym-btn';
        latest.textContent = '回到最新';
        latest.addEventListener('click', () => this.actions.onTimeline(null));
        timeline.append(range, this.timelineLabel, latest);
        const resize = doc.createElement('div');
        resize.className = 'dym-resize';
        this.root.append(bar, body, timeline, resize);
        body.append(canvasWrap, this.drawerHandle, this.drawer);
        canvasWrap.append(this.breadcrumb, zoomCtl, legend, this.statusBar, this.data.canvas.svg);
        this.fileInput = doc.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                    const text = String(reader.result ?? '');
                    this.setIo(text, `已读入 ${file.name}，正在导入…`);
                    this.actions.onImportBaseMapText(text, message => this.setIoHint(message));
                };
                reader.readAsText(file);
            }
            this.fileInput.value = '';
        });
        this.root.appendChild(this.fileInput);
        this.buildPanes();
    }
    buildPanes() {
        const doc = this.doc;
        // ── 图层 ──
        const layers = this.panes.get('layers');
        layers.innerHTML = `
      <div class="dym-switches">
        <label><input type="checkbox" data-layer="showTrail"> 显示轨迹</label>
        <label><input type="checkbox" data-layer="trailCityOnly"> 轨迹只连到市级（去掉城内蜘蛛网）</label>
        <label><input type="checkbox" data-layer="showLinks"> 显示层级连线</label>
        <label><input type="checkbox" data-layer="showRegions"> 显示区域轮廓（州/域用虚线围范围）</label>
        <label><input type="checkbox" data-layer="showUnplaced"> 显示待定位节点</label>
      </div>
      <div class="dym-row"><button class="dym-btn" data-act="scatter">环形铺开待定位节点</button></div>
      <div class="dym-hint" data-role="layer-hint"></div>`;
        layers.querySelectorAll('[data-layer]').forEach(input => {
            input.addEventListener('change', () => this.actions.onToggleLayer(input.dataset.layer, input.checked));
        });
        layers.querySelector('[data-act=scatter]')?.addEventListener('click', () => this.actions.onScatterUnplaced());
        // ── 地点 ──
        const places = this.panes.get('places');
        places.innerHTML = `
      <div class="dym-field"><label>搜索</label><input type="text" data-role="search" placeholder="地名 / 路径片段"></div>
      <div class="dym-hint">单击定位、双击下钻；右键节点可重命名、删除、加子节点。</div>
      <ul class="dym-list" data-role="place-list"></ul>`;
        this.searchInput = places.querySelector('[data-role=search]');
        this.searchInput?.addEventListener('input', () => this.renderPlaceList());
        // ── 编辑 ──
        const edit = this.panes.get('edit');
        edit.innerHTML = `
      <div class="dym-switches"><label><input type="checkbox" data-role="edit-mode"> 编辑模式（拖动节点改位置）</label></div>
      <div class="dym-row">
        <button class="dym-btn" data-act="undo">撤销</button>
        <button class="dym-btn" data-act="redo">重做</button>
      </div>
      <div class="dym-hint" data-role="selected-info">未选中节点。</div>
      <div class="dym-field"><label>名称</label><input type="text" data-role="node-name"></div>
      <div class="dym-field"><label>X</label><input type="number" step="0.1" data-role="node-x"></div>
      <div class="dym-field"><label>Y</label><input type="number" step="0.1" data-role="node-y"></div>
      <div class="dym-row"><button class="dym-btn" data-act="apply-xy">应用坐标</button></div>
      <div class="dym-field"><label>新地点</label><input type="text" data-role="child-name" placeholder="新子地点名称"></div>
      <div class="dym-row">
        <button class="dym-btn" data-act="add-child">加子节点</button>
        <button class="dym-btn" data-act="add-sibling">加同级</button>
        <button class="dym-btn" data-act="add-free">在视图中心新增</button>
      </div>
      <div class="dym-row">
        <button class="dym-btn" data-act="toggle-lock">锁定 / 解锁</button>
        <button class="dym-btn" data-act="delete-node">删除节点</button>
      </div>
      <div class="dym-hint">
        增点：<b>开启编辑模式后，在画布空白处右键或双击</b>即可在那里新增一个地点（会挂在当前下钻的节点下）。<br>
        删点：选中后点上面的「删除节点」，或按 <b>Delete</b> 键（子节点会一起删）。<br>
        锁定后的节点不会被地图布局 AI 覆盖；人工拖动会自动标记为「人工」。
      </div>`;
        edit.querySelector('[data-role=edit-mode]')?.addEventListener('change', event => {
            this.actions.onSetEditMode(event.target.checked);
        });
        edit.querySelector('[data-act=undo]')?.addEventListener('click', () => this.actions.onUndo());
        edit.querySelector('[data-act=redo]')?.addEventListener('click', () => this.actions.onRedo());
        const applyXy = () => {
            const x = Number(edit.querySelector('[data-role=node-x]').value);
            const y = Number(edit.querySelector('[data-role=node-y]').value);
            if (!Number.isFinite(x) || !Number.isFinite(y))
                return;
            this.actions.onMoveSelected([x, y]);
        };
        edit.querySelector('[data-act=apply-xy]')?.addEventListener('click', applyXy);
        const childName = () => edit.querySelector('[data-role=child-name]').value.trim();
        edit.querySelector('[data-act=add-child]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            if (this.data.selectedId)
                this.actions.onAddChild(this.data.selectedId, name);
        });
        edit.querySelector('[data-act=add-sibling]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            const selected = this.data.selectedId ? this.data.canvas.getView().graph.get(this.data.selectedId) : undefined;
            if (selected)
                this.actions.onAddChild(selected.parentId, name);
        });
        edit.querySelector('[data-act=add-free]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            this.actions.onAddChild(this.data.focusId ?? this.data.selectedId, name);
        });
        edit.querySelector('[data-act=toggle-lock]')?.addEventListener('click', () => this.data.selectedId && this.actions.onToggleLock(this.data.selectedId));
        // 删除用两步确认，避免在隐藏 iframe 里弹 confirm 对话框
        const deleteButton = edit.querySelector('[data-act=delete-node]');
        deleteButton.addEventListener('click', () => {
            if (!this.data.selectedId)
                return;
            if (deleteButton.dataset.armed === '1') {
                deleteButton.dataset.armed = '';
                deleteButton.textContent = '删除节点';
                this.actions.onDeleteNode(this.data.selectedId);
                return;
            }
            deleteButton.dataset.armed = '1';
            deleteButton.textContent = '再点一次确认删除';
            setTimeout(() => {
                if (deleteButton.dataset.armed === '1') {
                    deleteButton.dataset.armed = '';
                    deleteButton.textContent = '删除节点';
                }
            }, 3200);
        });
        edit.querySelector('[data-role=node-name]')?.addEventListener('change', event => {
            if (this.data.selectedId)
                this.actions.onRenameNode(this.data.selectedId, event.target.value);
        });
        // ── 轨迹 ──
        const trail = this.panes.get('trail');
        trail.innerHTML = `
      <div class="dym-row">
        <button class="dym-btn" data-act="rebuild">从聊天记录重算</button>
        <button class="dym-btn" data-act="clear-hidden">恢复全部显示</button>
      </div>
      <div class="dym-hint" data-role="trail-hint"></div>
      <ul class="dym-list" data-role="trail-list"></ul>`;
        trail.querySelector('[data-act=rebuild]')?.addEventListener('click', () => this.actions.onRebuildTrail());
        trail.querySelector('[data-act=clear-hidden]')?.addEventListener('click', () => this.actions.onClearHiddenPoints());
        // ── 设置 ──
        const settings = this.panes.get('settings');
        settings.innerHTML = `
      <details class="dym-sec" open><summary>地图布局 AI（接口与模型）</summary>
        <div class="dym-hint">读世界书的地点条目、一次性给出坐标。与正文用的模型分开配置，默认沿用 MVU 的本地端点。</div>
        <div class="dym-field"><label>接口</label><input type="text" data-set="url" placeholder="http://localhost:1234/v1"></div>
        <div class="dym-field"><label>密钥</label>
          <span class="dym-pw">
            <input type="password" data-set="key" placeholder="留空表示接口不需要密钥" autocomplete="off">
            <button type="button" data-act="toggle-key" title="显示 / 隐藏密钥">👁</button>
          </span>
        </div>
        <div class="dym-field"><label>模型</label>
          <select data-role="model-select"><option value="">（先点下面的「获取模型列表」）</option></select>
        </div>
        <div class="dym-field"><label>自定义</label><input type="text" data-set="model" placeholder="也可以直接手填模型名"></div>
        <div class="dym-row"><button class="dym-btn" data-act="fetch-models">获取模型列表</button>
          <button class="dym-btn" data-act="test-api">测试连接</button></div>
        <div class="dym-field"><label>上限</label><input type="number" data-set="maxTokens" step="1024"></div>
        <div class="dym-hint">上限 = <b>一次最多让模型写多少 token</b>（只是输出长度，不影响读进去的世界书）。
          生成底图正常十来条资料，<b>16384 够用</b>；要是哪天一次喂 100 多条（比如从控制台跑 <code>__worldMap.runLayout('all')</code>），
          就调到 <b>32768~65535</b>。<b>填太小会看到「模型返回为空」或 JSON 解析失败</b>——那就是被截断了，不是模型不行。
          有些服务端上限就是 65535，填更大反而会被拒。</div>
        <div class="dym-field"><label>温度</label><input type="number" data-set="temperature" step="0.1"></div>
        <div class="dym-hint">温度 = 随机性。<b>0.2~0.4</b> 最稳；调高会让它"发挥"，坐标就开始乱编。</div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="save-settings">保存设置</button></div>
      </details>

      <details class="dym-sec"><summary>生成底图（按世界书铺点）</summary>
        <div class="dym-hint">
          读世界书里的<b>地点类条目</b>（《玄天界介绍》《地点：X》这类总纲），一次性给出大域、主要势力、
          主要城池的坐标；已经人工拖过的点会跳过，不会覆盖。<br>
          想要更细的城内地点，在地图上双击下钻后<b>手动加</b>更稳（AI 细化很容易编出无意义的小点）。
        </div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="layout-world">生成底图</button></div>
        <div class="dym-hint">生成结果（用了哪些条目、新增/移动/丢弃多少、模型原始回复）会显示在下面这块，同时抄一份到「导出 / 导入」的文本框里方便留存。</div>
        <div class="dym-report" data-role="layout-report">还没跑过地图布局 AI。</div>
        <div class="dym-row"><button class="dym-btn dym-danger" data-act="clear-nodes">清空地图上所有地点</button></div>
        <div class="dym-hint">清空后底图上一个点都不剩（<b>轨迹数据不受影响</b>，画面上只剩轨迹线及其坐标）。
          要重来一遍时用它：先清空 → 再点「生成底图」。
          点一次会变成「再点一次确认清空」，<b>可以撤销</b>。</div>
      </details>

      <details class="dym-sec"><summary>底图来源（作者预设 / 内置骨架）</summary>
        <div class="dym-field"><label>预设</label><input type="text" data-set="presetUrl" placeholder="作者预设 JSON 的网址（jsdelivr 上的 GitHub 文件）"></div>
        <div class="dym-row">
          <button class="dym-btn" data-act="pull-preset">拉取作者预设</button>
          <button class="dym-btn" data-act="reset-map">恢复内置骨架</button>
        </div>
        <div class="dym-hint">拉取时<b>已锁定的点不会被覆盖</b>；「恢复内置骨架」会把整张底图换成内置的 54 个节点（可撤销）。</div>
      </details>

      <details class="dym-sec"><summary>导出 / 导入（可发给 AI 改坐标）</summary>
        <div class="dym-row">
          <button class="dym-btn" data-act="export-map">导出底图 JSON</button>
          <button class="dym-btn" data-act="export-anchors">导出锚点文本</button>
        </div>
        <textarea class="dym-io" data-role="io" spellcheck="false"
          placeholder="点上面两个按钮之一，内容会出现在这里。&#10;· 底图 JSON：完整节点表，发给 AI 批量改坐标最方便；&#10;· 锚点文本：一段「地名(坐标)｜…」，直接替换提示词里的固定锚点；&#10;· 生成报告也会写在这里。&#10;改完粘回这里再点「从文本框导入」即可。"></textarea>
        <div class="dym-row">
          <button class="dym-btn" data-act="copy-io">复制</button>
          <button class="dym-btn" data-act="download-io">存成文件</button>
          <button class="dym-btn" data-act="import-io">从文本框导入</button>
          <button class="dym-btn" data-act="pick-file">选文件</button>
        </div>
        <div class="dym-hint" data-role="io-hint">导出的文件会存到浏览器的下载目录；不确定的话直接用「复制」再粘到别处。</div>
      </details>

      <details class="dym-sec"><summary>其他</summary>
        <div class="dym-row"><button class="dym-btn" data-act="export-trail">导出轨迹 JSON</button></div>
        <div class="dym-hint" data-role="settings-hint"></div>
      </details>`;
        settings.querySelector('[data-act=test-api]')?.addEventListener('click', () => this.actions.onTestApi());
        settings.querySelector('[data-act=fetch-models]')?.addEventListener('click', () => this.fetchModels());
        settings.querySelector('[data-act=save-settings]')?.addEventListener('click', () => this.collectSettings());
        settings.querySelector('[data-act=toggle-key]')?.addEventListener('click', () => {
            const input = settings.querySelector('[data-set=key]');
            input.type = input.type === 'password' ? 'text' : 'password';
        });
        settings.querySelector('[data-role=model-select]')?.addEventListener('change', event => {
            const value = event.target.value;
            if (!value)
                return;
            const input = settings.querySelector('[data-set=model]');
            if (input)
                input.value = value;
            this.collectSettings();
        });
        settings.querySelector('[data-act=layout-world]')?.addEventListener('click', () => this.actions.onRunLayout('world'));
        // 清空全部地点：两步确认（隐藏 iframe 里弹不了 confirm）
        const clearButton = settings.querySelector('[data-act=clear-nodes]');
        clearButton.addEventListener('click', () => {
            if (clearButton.dataset.armed === '1') {
                clearButton.dataset.armed = '';
                clearButton.textContent = '清空地图上所有地点';
                this.actions.onClearNodes();
                return;
            }
            clearButton.dataset.armed = '1';
            clearButton.textContent = '再点一次确认清空（可撤销）';
            setTimeout(() => {
                if (clearButton.dataset.armed === '1') {
                    clearButton.dataset.armed = '';
                    clearButton.textContent = '清空地图上所有地点';
                }
            }, 4000);
        });
        settings.querySelector('[data-act=pull-preset]')?.addEventListener('click', () => this.actions.onPullPreset());
        settings.querySelector('[data-act=reset-map]')?.addEventListener('click', () => this.actions.onResetBaseMap());
        settings.querySelector('[data-act=export-map]')?.addEventListener('click', () => {
            this.setIo(this.actions.onExportBaseMap(), '已生成完整底图 JSON：复制发给 AI 让它改坐标，改完粘回文本框再点「从文本框导入」。');
        });
        settings.querySelector('[data-act=export-anchors]')?.addEventListener('click', () => {
            this.setIo(this.actions.onExportAnchorText(), '这是可以直接替换提示词里「固定锚点」那一段的文本（照抄即可，坐标单位与地图一致）。');
        });
        settings.querySelector('[data-act=copy-io]')?.addEventListener('click', () => void this.copyIo());
        settings.querySelector('[data-act=download-io]')?.addEventListener('click', () => this.downloadIo());
        settings.querySelector('[data-act=import-io]')?.addEventListener('click', () => {
            const text = this.ioValue();
            if (!text.trim()) {
                this.setIoHint('文本框是空的，先粘贴 JSON 再导入。');
                return;
            }
            this.actions.onImportBaseMapText(text, message => this.setIoHint(message));
        });
        settings.querySelector('[data-act=pick-file]')?.addEventListener('click', () => this.fileInput.click());
        settings.querySelector('[data-act=export-trail]')?.addEventListener('click', () => this.actions.onExportTrail());
        this.fillSettings();
    }
    ioPane() {
        return this.panes.get('settings');
    }
    ioValue() {
        return this.ioPane().querySelector('[data-role=io]')?.value ?? '';
    }
    setIo(text, hint) {
        const area = this.ioPane().querySelector('[data-role=io]');
        if (area) {
            area.value = text;
            area.focus();
            area.setSelectionRange(0, 0);
        }
        if (hint)
            this.setIoHint(hint);
    }
    setIoHint(text) {
        const hint = this.ioPane().querySelector('[data-role=io-hint]');
        if (hint)
            hint.textContent = text;
    }
    /**
     * 对外：显示一段生成报告。
     * 报告就写在「生成底图」那一段下面（同一个页签，不用来回找），
     * 同时抄一份进「导出 / 导入」的文本框，方便复制留存。
     */
    showReport(text, hint) {
        const pane = this.ioPane();
        const report = pane.querySelector('[data-role=layout-report]');
        if (report) {
            report.textContent = text;
            const section = report.closest('details');
            if (section)
                section.open = true;
            report.scrollIntoView({ block: 'nearest' });
        }
        const area = pane.querySelector('[data-role=io]');
        if (area)
            area.value = text;
        this.setIoHint(hint);
        this.setTab('settings');
    }
    async copyIo() {
        const text = this.ioValue();
        if (!text) {
            this.setIoHint('文本框是空的。');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            this.setIoHint(`已复制 ${text.length} 个字符到剪贴板。`);
        }
        catch {
            // 非安全上下文等情况下退回"全选 + 提示手动复制"
            const area = this.ioPane().querySelector('[data-role=io]');
            area?.focus();
            area?.select();
            this.setIoHint('这个环境不允许自动写剪贴板，已帮你全选，按 Ctrl+C 即可。');
        }
    }
    downloadIo() {
        const text = this.ioValue();
        if (!text) {
            this.setIoHint('文本框是空的。');
            return;
        }
        try {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = this.doc.createElement('a');
            anchor.href = url;
            anchor.download = `世界舆图底图-${new Date().toISOString().slice(0, 10)}.json`;
            this.doc.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            this.setIoHint('已触发下载，文件在浏览器的下载目录里；收不到就用「复制」。');
        }
        catch (error) {
            this.setIoHint(`下载失败：${String(error)}。请改用「复制」。`);
        }
    }
    fillSettings() {
        const pane = this.panes.get('settings');
        const api = this.data.settings?.api;
        const map = {
            url: api?.url,
            key: api?.key,
            model: api?.model,
            maxTokens: api?.maxTokens,
            temperature: api?.temperature,
            presetUrl: this.data.settings?.presetUrl,
        };
        pane.querySelectorAll('[data-set]').forEach(input => {
            const value = map[input.dataset.set];
            input.value = value === undefined || value === null ? '' : String(value);
        });
    }
    /** 把模型列表填进下拉框；选中下拉里的一项就会直接替换「模型」输入框，不用手打 */
    fillModels(models) {
        const pane = this.panes.get('settings');
        const select = pane.querySelector('[data-role=model-select]');
        if (!select)
            return;
        select.innerHTML =
            `<option value="">（共 ${models.length} 个，点这里选）</option>` +
                models.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
        const current = pane.querySelector('[data-set=model]')?.value;
        if (current && models.includes(current))
            select.value = current;
    }
    /** 点「获取模型列表」：拉 /models 填进下拉，选中即替换模型框，不用先清空手打 */
    async fetchModels() {
        const pane = this.panes.get('settings');
        const button = pane.querySelector('[data-act=fetch-models]');
        if (button) {
            button.disabled = true;
            button.textContent = '拉取中…';
        }
        let base = '';
        let key = '';
        try {
            // 这里一律不用可选链以外的读取方式：点一下按钮就抛异常、界面上毫无反馈是最糟的体验
            const urlInput = pane.querySelector('[data-set=url]');
            const keyInput = pane.querySelector('[data-set=key]');
            base = String(urlInput?.value || this.data.settings?.api?.url || '').trim().replace(/\/+$/, '');
            key = String(keyInput?.value || this.data.settings?.api?.key || '');
            if (!base)
                throw new Error('还没填接口地址（形如 http://localhost:1234/v1）');
            const models = await this.listModels(base, key);
            if (!models.length)
                throw new Error(`${base}/models 没有返回任何模型`);
            this.fillModels(models);
            if (button)
                button.textContent = `已获取 ${models.length} 个`;
            this.showReport(`【获取模型列表】成功\n接口：${base}\n共 ${models.length} 个：\n` +
                models.map(id => `  · ${id}`).join('\n') +
                `\n\n选一个（下拉框或「自定义」框）再点「保存设置」。`, '已拉到模型列表，下拉里点一下就能替换模型名。');
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            if (button)
                button.textContent = `失败：${message.slice(0, 30)}`;
            let detail = '';
            try {
                detail = base ? await this.describeEndpoint(base) : '';
            }
            catch {
                detail = '';
            }
            this.showReport(`【获取模型列表】失败\n接口：${base || '(未填写)'}\n密钥：${key ? '已填写' : '(空)'}\n原因：${message}${detail}\n`, `获取模型列表失败：${message}${detail}`);
        }
        finally {
            if (button) {
                button.disabled = false;
                setTimeout(() => {
                    button.textContent = '获取模型列表';
                }, 4000);
            }
        }
    }
    async listModels(base, key) {
        let response;
        try {
            response = await fetch(`${base}/models`, {
                headers: key ? { Authorization: `Bearer ${key}` } : {},
            });
        }
        catch (error) {
            throw new Error(`连不上 ${base}/models（${String(error)}）`);
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${response.statusText}` +
                (response.status === 401 || response.status === 403 ? '（密钥不对或没权限）' : '') +
                (body ? `｜${body.slice(0, 160)}` : ''));
        }
        const data = (await response.json());
        return (data?.data ?? []).map(item => String(item.id ?? '')).filter(Boolean).sort();
    }
    /** 失败时补一句人话：接口到底通不通 */
    async describeEndpoint(base) {
        try {
            const response = await fetch(`${base}/models`, { method: 'GET' });
            if (response.ok)
                return '';
            const body = await response.text().catch(() => '');
            if (response.status === 401 || response.status === 403)
                return '（密钥可能不对或没填）';
            return `（接口返回 ${response.status}：${body.slice(0, 80)}）`;
        }
        catch (error) {
            return `（连不上 ${base}：${String(error).slice(0, 80)}）`;
        }
    }
    collectSettings() {
        const pane = this.panes.get('settings');
        const read = (key) => pane.querySelector(`[data-set=${key}]`)?.value ?? '';
        this.actions.onSaveSettings({
            api: {
                url: read('url').trim() || this.data.settings?.api?.url || '',
                key: read('key'),
                model: read('model').trim(),
                maxTokens: Number(read('maxTokens')) || 8192,
                temperature: Number(read('temperature')) || 0,
            },
            presetUrl: read('presetUrl').trim(),
        });
    }
    bindChrome() {
        const bar = this.root.querySelector('.dym-titlebar');
        bar.addEventListener('click', event => {
            const act = event.target.dataset?.act;
            if (act === 'drawer')
                this.toggleDrawer();
            else if (act === 'locate')
                this.actions.onLocateCurrent();
            else if (act === 'fit')
                this.actions.onFit();
            else if (act === 'close')
                this.close();
        });
        this.root.querySelector('[data-act=zoom-in]')?.addEventListener('click', () => this.data.canvas.zoomBy(1.25));
        this.root.querySelector('[data-act=zoom-out]')?.addEventListener('click', () => this.data.canvas.zoomBy(1 / 1.25));
        this.launcher.addEventListener('click', () => this.open());
        // 拖动标题栏（贴边窄条状态下拖动 = 从边上拖出来）
        let dragging = null;
        bar.addEventListener('pointerdown', event => {
            if (event.target.dataset?.act)
                return;
            dragging = {
                x: event.clientX,
                y: event.clientY,
                ox: this.root.offsetLeft,
                oy: this.root.offsetTop,
                undocked: false,
            };
            bar.setPointerCapture(event.pointerId);
        });
        bar.addEventListener('pointermove', event => {
            if (!dragging)
                return;
            const dx = event.clientX - dragging.x;
            const dy = event.clientY - dragging.y;
            if (this.isRail() && !dragging.undocked) {
                if (Math.abs(dx) + Math.abs(dy) < 8)
                    return; // 还没拖动，先当作待判定点击
                dragging.undocked = true;
                const rect = this.root.getBoundingClientRect();
                this.exitRail();
                this.root.style.left = `${rect.left}px`;
                this.root.style.right = 'auto';
                this.root.style.top = `${Math.max(0, rect.top)}px`;
                dragging.ox = rect.left;
                dragging.oy = rect.top;
                dragging.x = event.clientX;
                dragging.y = event.clientY;
                return;
            }
            const x = dragging.ox + (event.clientX - dragging.x);
            const y = dragging.oy + (event.clientY - dragging.y);
            this.root.style.left = `${Math.max(-40, Math.min(this.host.innerWidth - 60, x))}px`;
            this.root.style.right = 'auto';
            this.root.style.top = `${Math.max(0, y)}px`;
        });
        bar.addEventListener('pointerup', event => {
            if (!dragging)
                return;
            const moved = dragging.undocked || Math.abs(event.clientX - dragging.x) + Math.abs(event.clientY - dragging.y) > 6;
            dragging = null;
            if (!moved && this.isRail()) {
                // 单击书签：直接把整个窗口从边上放出来（不需要拖拽）
                this.openFromRail();
                return;
            }
            this.snapDock();
            this.persistLayout();
        });
        // 注意：这里**刻意不做悬停展开**。鼠标扫过书签时它保持原样不动，
        // 只有单击才开窗 —— 悬停就变大会在鼠标路过页面边缘时乱跳。
        // 右下角缩放
        const handle = this.root.querySelector('.dym-resize');
        let resizing = null;
        handle.addEventListener('pointerdown', event => {
            if (this.isRail())
                this.exitRail();
            resizing = { x: event.clientX, y: event.clientY, w: this.root.offsetWidth, h: this.root.offsetHeight };
            this.root.classList.add('dym-resizing');
            handle.setPointerCapture(event.pointerId);
            event.stopPropagation();
        });
        handle.addEventListener('pointermove', event => {
            if (!resizing)
                return;
            this.root.style.width = `${Math.max(380, resizing.w + (event.clientX - resizing.x))}px`;
            this.root.style.height = `${Math.max(260, resizing.h + (event.clientY - resizing.y))}px`;
            this.data.canvas.render();
        });
        handle.addEventListener('pointerup', () => {
            resizing = null;
            this.root.classList.remove('dym-resizing');
            this.persistLayout();
        });
        this.host.addEventListener('resize', () => this.data.canvas.render());
        // Delete / Backspace 删除选中节点（编辑模式下）
        this.doc.addEventListener('keydown', event => {
            if (!this.isOpen())
                return;
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
                return;
            if ((event.key === 'Delete' || event.key === 'Backspace') && this.data.selectedId) {
                event.preventDefault();
                this.actions.onDeleteNode(this.data.selectedId);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.actions.onSelectNode(null);
            }
        });
    }
    // ── 贴边自动缩进（"抽屉"）────────────────────────────────────────────
    railTop = 0;
    isRail() {
        return this.root.classList.contains('dym-rail');
    }
    /** 贴到左/右侧：立刻收成一条"索引标贴"那样的小书签 */
    enterRail(side) {
        this.dockSide = side;
        const rect = this.root.getBoundingClientRect();
        this.data.layout.w = Math.max(320, Math.round(rect.width));
        this.data.layout.h = Math.max(240, Math.round(rect.height));
        this.data.layout.y = Math.max(0, Math.round(rect.top));
        this.root.classList.add('dym-rail');
        this.root.classList.toggle('dym-rail-left', side === 'left');
        // 小书签：一两百像素高，贴在页面边缘，不挡正文
        const railHeight = Math.min(190, Math.max(112, Math.round(this.host.innerHeight * 0.19)));
        const railTop = Math.min(Math.max(8, rect.top), Math.max(8, this.host.innerHeight - railHeight - 8));
        this.railTop = railTop;
        this.root.style.height = `${railHeight}px`;
        this.root.style.top = `${railTop}px`;
        this.root.style.width = `${this.railWidth()}px`;
        if (side === 'right') {
            this.root.style.right = '0px';
            this.root.style.left = 'auto';
        }
        else {
            this.root.style.left = '0px';
            this.root.style.right = 'auto';
        }
        this.data.canvas.render();
    }
    railWidth() {
        return this.data.layout.railWidth || 30;
    }
    /** 悬停/点击时把书签临时展开成可用的大小（连高度一起还原，否则只有一条缝看不清） */
    openFromRail() {
        if (!this.isRail())
            return;
        this.exitRail();
        this.persistLayout();
    }
    /** 离开贴边状态，恢复原来的尺寸 */
    exitRail() {
        if (!this.isRail())
            return;
        this.root.classList.remove('dym-rail');
        this.dockSide = null;
        const width = this.data.layout.w;
        const height = Math.min(this.data.layout.h, Math.max(240, this.host.innerHeight - 16));
        const top = Math.min(Math.max(8, this.railTop), Math.max(8, this.host.innerHeight - height - 8));
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
        this.root.style.top = `${top}px`;
        requestAnimationFrame(() => this.data.canvas.render());
    }
    /** 松手时距边缘足够近就贴边收进去 */
    snapDock() {
        const rect = this.root.getBoundingClientRect();
        const width = this.host.innerWidth;
        if (rect.left <= this.edgeThreshold) {
            this.enterRail('left');
        }
        else if (width - rect.right <= this.edgeThreshold) {
            this.enterRail('right');
        }
        else if (this.isRail()) {
            this.exitRail();
        }
        else {
            this.dockSide = null;
        }
    }
    persistLayout() {
        const rect = this.root.getBoundingClientRect();
        // 窗口还没显示（display:none）时 rect 全是 0，写回去会把布局写坏
        if (rect.width < 40 || rect.height < 40)
            return;
        const rail = this.isRail();
        const rightSide = this.dockSide === 'right' || this.host.innerWidth - rect.right < rect.left;
        Object.assign(this.data.layout, {
            x: rightSide ? -1 : Math.round(rect.left),
            y: Math.round(rect.top),
            w: rail ? this.data.layout.w : Math.round(rect.width),
            h: rail ? this.data.layout.h : Math.round(rect.height),
            collapsed: this.root.classList.contains('dym-collapsed'),
            drawerOpen: !this.root.classList.contains('dym-drawer-off'),
            tab: this.currentTab,
            docked: rail ? this.dockSide : null,
        });
        try {
            localStorage.setItem('worldmap_local_layout', JSON.stringify(this.data.layout));
        }
        catch {
            /* 忽略 */
        }
    }
    currentTab = 'places';
    applyLayout(layout) {
        const width = layout.w || 620;
        const height = layout.h || 500;
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
        const maxX = Math.max(0, this.host.innerWidth - width - 8);
        const x = layout.x === undefined || layout.x < 0 ? maxX : Math.min(maxX, layout.x);
        const y = Math.min(Math.max(0, this.host.innerHeight - 120), Math.max(0, layout.y ?? 96));
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        if (this.host.innerWidth < 720)
            this.root.classList.add('dym-narrow');
        // 最小化按钮已移除：即便旧布局里存着 collapsed，也强制展开，避免出现"打不开"的窗口
        this.root.classList.remove('dym-collapsed');
        if (layout.collapsed)
            this.data.layout.collapsed = false;
        this.setTab(layout.tab ?? 'places');
        this.toggleDrawer(layout.drawerOpen === false);
        if (layout.docked)
            this.enterRail(layout.docked);
    }
    setTab(tab) {
        this.currentTab = tab;
        for (const [key, button] of this.tabButtons)
            button.classList.toggle('dym-active', key === tab);
        for (const [key, pane] of this.panes)
            pane.classList.toggle('dym-active', key === tab);
    }
    toggleCollapsed() {
        const collapsed = this.root.classList.toggle('dym-collapsed');
        this.root.classList.toggle('dym-collapsed-hidden', false);
        this.persistLayout();
        if (!collapsed)
            this.data.canvas.render();
    }
    /** 收起 / 展开右侧栏（收起后画布占满窗口，把手留在右沿） */
    toggleDrawer(force) {
        const off = force === undefined ? !this.root.classList.contains('dym-drawer-off') : force;
        this.root.classList.toggle('dym-drawer-off', off);
        this.data.layout.drawerOpen = !off;
        this.drawerHandle.textContent = off ? '‹' : '›';
        this.drawerHandle.title = off ? '展开右侧栏' : '收起右侧栏';
        const barButton = this.root.querySelector('[data-act=drawer]');
        if (barButton) {
            barButton.textContent = off ? '«' : '»';
            barButton.title = off ? '展开右侧栏' : '收起右侧栏';
            barButton.classList.toggle('dym-on', off);
        }
        this.persistLayout();
        requestAnimationFrame(() => this.data.canvas.render());
    }
    close() {
        this.exitRail();
        this.root.style.display = 'none';
        this.launcher.style.display = 'flex';
        const width = Math.max(320, this.root.offsetWidth || 620);
        this.launcher.style.left = `${Math.max(4, this.host.innerWidth - width - 48)}px`;
        this.launcher.style.top = `${Math.max(4, this.root.offsetTop + 40)}px`;
        this.data.layout = { ...this.data.layout, collapsed: false };
    }
    open() {
        this.root.style.display = 'flex';
        this.launcher.style.display = 'none';
        requestAnimationFrame(() => this.data.canvas.render());
    }
    isOpen() {
        return this.root.style.display !== 'none';
    }
    render(data) {
        this.data = { ...this.data, ...data };
        const { canvas } = this.data;
        const view = canvas.getView();
        this.badge.textContent = this.data.currentPath ? this.data.currentPath.split('·').slice(-2).join('·') : '尚未启程';
        this.badge.title = this.data.currentPath ?? '';
        // 面包屑：以当前聚焦链的根节点作为起点，没有聚焦时显示默认舞台
        const chain = view.focusId ? canvas.getView().graph.ancestors(view.focusId) : [];
        if (chain.length) {
            this.breadcrumb.innerHTML =
                `<span data-focus="">全图</span>` +
                    chain.map(node => ` <i>›</i> <span data-focus="${node.id}">${escapeHtml(node.name)}</span>`).join('');
        }
        else {
            this.breadcrumb.innerHTML = `<b>全图 · 双击节点下钻</b>`;
        }
        this.breadcrumb.querySelectorAll('[data-focus]').forEach(item => {
            item.addEventListener('click', () => this.actions.onFocusNode(item.dataset.focus || null));
        });
        // 图层开关
        const layers = this.panes.get('layers');
        layers.querySelectorAll('[data-layer]').forEach(input => {
            const key = input.dataset.layer;
            input.checked = Boolean(view[key]);
        });
        const unplaced = canvas.getView().graph.toArray().filter(node => node.status === 'unplaced').length;
        const hint = layers.querySelector('[data-role=layer-hint]');
        if (hint)
            hint.textContent = `节点 ${canvas.getView().graph.size} 个，其中待定位 ${unplaced} 个。待定位节点由轨迹自动落点产生，确认位置后可拖动微调。`;
        // 选中信息
        const edit = this.panes.get('edit');
        const selected = this.data.selectedId ? canvas.getView().graph.get(this.data.selectedId) : undefined;
        edit.querySelector('[data-role=selected-info]').textContent = selected
            ? `${selected.path}\n${canvas.describeNode(selected)}｜来源 ${selected.source}${selected.locked ? '｜已锁定' : ''}`
            : '未选中节点。';
        const nameInput = edit.querySelector('[data-role=node-name]');
        const xInput = edit.querySelector('[data-role=node-x]');
        const yInput = edit.querySelector('[data-role=node-y]');
        if (document.activeElement !== nameInput)
            nameInput.value = selected?.name ?? '';
        if (document.activeElement !== xInput)
            xInput.value = selected ? String(selected.xy[0]) : '';
        if (document.activeElement !== yInput)
            yInput.value = selected ? String(selected.xy[1]) : '';
        const editToggle = edit.querySelector('[data-role=edit-mode]');
        editToggle.checked = this.data.editMode;
        edit.querySelector('[data-act=undo]').disabled = !this.data.canUndo;
        edit.querySelector('[data-act=redo]').disabled = !this.data.canRedo;
        // 轨迹
        const trailPane = this.panes.get('trail');
        const trailHint = trailPane.querySelector('[data-role=trail-hint]');
        trailHint.textContent = this.data.trail.length
            ? `共 ${this.data.trail.length} 个轨迹点，已隐藏 ${this.data.hiddenPointIds.size} 个。` +
                (view.trailCityOnly
                    ? '当前画的是「市级以上」的走位（城内小点不参与连线，可在「图层」页签关掉这个限制）。'
                    : '当前画的是全部层级（城中细节也连线，容易糊成一团）。')
            : '还没有轨迹。装好提示词后新回合会自动落点，也可以点「从聊天记录重算」。';
        const trailList = trailPane.querySelector('[data-role=trail-list]');
        const ordered = this.data.trail.slice().sort((a, b) => (a.seq ?? a.messageId) - (b.seq ?? b.messageId));
        trailList.innerHTML = ordered
            .reverse()
            .map(point => {
            const hidden = this.data.hiddenPointIds.has(point.id);
            const orphan = point.orphan ? '<span class="dym-tag dym-orphan" title="这一楼已不在聊天里，但轨迹保留">留</span>' : '';
            return `<li data-point="${escapeHtml(point.id)}" style="opacity:${hidden ? 0.45 : 1}">
          <span class="dym-dot" style="background:#a3462a"></span>
          <span class="dym-name">楼${point.messageId}·${escapeHtml(point.path.split('·').slice(-2).join('·'))}</span>
          <span class="dym-tag">${escapeHtml(point.kind)}</span>${orphan}
        </li>`;
        })
            .join('');
        trailList.querySelectorAll('[data-point]').forEach(item => {
            const point = this.data.trail.find(candidate => candidate.id === item.dataset.point);
            if (!point)
                return;
            item.addEventListener('click', () => this.actions.onJumpToPoint(point));
            item.addEventListener('contextmenu', event => {
                event.preventDefault();
                this.actions.onTogglePointHidden(point.id);
            });
        });
        // 时间轴
        const max = Math.max(0, this.data.trail.length - 1);
        this.timelineInput.max = String(max);
        this.timelineInput.value = String(this.data.timelineIndex === null ? max : Math.min(this.data.timelineIndex, max));
        const shown = this.data.timelineIndex === null ? this.data.trail.length : Math.min(this.data.timelineIndex + 1, this.data.trail.length);
        const point = this.data.trail[shown - 1];
        this.timelineLabel.textContent = point ? `楼${point.messageId} ${point.t.slice(0, 12)}` : '无轨迹';
        this.statusBar.textContent = this.data.busy ? this.data.busy : this.data.status;
        this.statusBar.style.color = this.data.busy ? '#a3462a' : '#6a5433';
        const settingsHint = this.panes.get('settings').querySelector('[data-role=settings-hint]');
        if (settingsHint)
            settingsHint.textContent = this.data.presetError ? `作者预设：${this.data.presetError}` : '';
        // 地点列表
        this.renderPlaceList();
        canvas.render();
    }
    renderPlaceList() {
        const list = this.panes.get('places').querySelector('[data-role=place-list]');
        const keyword = this.searchInput?.value?.trim() ?? '';
        const nodes = this.data.canvas
            .getView()
            .graph.toArray()
            .filter(node => (keyword ? node.path.includes(keyword) : true))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh'));
        const shown = nodes.slice(0, 400);
        list.innerHTML = shown
            .map(node => {
            const selected = node.id === this.data.selectedId ? ' class="dym-selected"' : '';
            return `<li${selected} data-node="${node.id}">
          <span class="dym-dot" style="background:${KIND_COLORS[node.kind]}"></span>
          <span class="dym-name${node.status === 'unplaced' ? ' dym-unplaced' : ''}">${escapeHtml(node.name)}</span>
          <span class="dym-tag">${KIND_LABELS[node.kind]}${node.depth ? '·' + node.depth : ''}</span>
        </li>`;
        })
            .join('');
        list.querySelectorAll('[data-node]').forEach(item => {
            const id = item.dataset.node;
            item.addEventListener('click', () => this.actions.onSelectNode(id));
            item.addEventListener('dblclick', () => this.actions.onFocusNode(id));
        });
        if (nodes.length > shown.length) {
            list.insertAdjacentHTML('beforeend', `<li style="cursor:default">… 还有 ${nodes.length - shown.length} 个，请输入关键词缩小范围</li>`);
        }
    }
    /** 右键节点：选中并跳到编辑页签（不用系统对话框，避免隐藏 iframe 里的弹窗问题） */
    contextMenu(node) {
        this.actions.onSelectNode(node.id);
        this.setTab('edit');
        this.open();
    }
    /** 选中并跳转到编辑页签，供「加子节点」等操作复用 */
    selectForEdit(id) {
        this.actions.onSelectNode(id);
        this.setTab('edit');
    }
    destroy() {
        this.root.remove();
        this.launcher.remove();
    }
}
//# sourceMappingURL=window.js.map
return { MapWindow };
});
__def("./index.js", () => {
const { ID_PREFIX, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } = __req('./types.js');
const { MapGraph, sanitizeNodes, tierOf, toBaseMap } = __req('./graph.js');
const { rebuildTrail } = __req('./trail.js');
const { loadBaseMap, loadLayout, loadSettings, loadTrail, saveBaseMap, saveSettings, saveTrail } = __req('./store.js');
const { resolveInitialBaseMap, fetchPresetMap, mergeBaseMaps, seedBaseMap } = __req('./preset.js');
const { runLayout } = __req('./layout-ai.js');
const { MapCanvas, defaultView } = __req('./ui/canvas.js');
const { MapWindow } = __req('./ui/window.js');
const BUTTON_NAME = '世界舆图';
const hostWindow = (window.parent && window.parent !== window ? window.parent : window);
const hostDocument = hostWindow.document ?? document;
let graph;
let base;
let trail;
let settings;
let canvas = null;
let mapWindow = null;
let editMode = false;
let busy = null;
let status = '';
let presetError;
let selectedId = null;
let focusId = null;
let timelineIndex = null;
let currentPath = null;
let refreshTimer = null;
let saveTimer = null;
const undoStack = [];
const redoStack = [];
// ── 工具 ────────────────────────────────────────────────────────────────
function toast(kind, message) {
    try {
        const fn = hostWindow.toastr?.[kind];
        if (typeof fn === 'function')
            fn(message, '世界舆图');
        else
            window.console.log('[世界舆图]', kind, message);
    }
    catch {
        window.console.log('[世界舆图]', message);
    }
}
function snapshot() {
    return JSON.stringify({ nodes: graph.toArray(), hidden: base.hiddenIds });
}
function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 20)
        undoStack.shift();
    redoStack.length = 0;
}
function restore(json) {
    const parsed = JSON.parse(json);
    graph = new MapGraph(parsed.nodes);
    base.hiddenIds = parsed.hidden ?? [];
    syncSelection();
    persistBaseMap();
    render();
}
function syncSelection() {
    if (selectedId && !graph.get(selectedId))
        selectedId = null;
    if (focusId && !graph.get(focusId))
        focusId = null;
}
/**
 * 底图清洗：剔除方位词节点、剔除仙界子树、合并重复点。
 * 老版本存下来的底图靠它自动迁移，不需要用户手动清理。
 */
function sanitizeGraph(reason) {
    const { nodes, report } = sanitizeNodes(graph.toArray());
    if (!report.removedBearing && !report.removedImmortal && !report.merged)
        return false;
    graph = new MapGraph(nodes);
    syncSelection();
    const parts = [];
    if (report.removedBearing)
        parts.push(`去掉 ${report.removedBearing} 个方位节点`);
    if (report.removedImmortal)
        parts.push(`去掉 ${report.removedImmortal} 个仙界节点`);
    if (report.merged)
        parts.push(`合并 ${report.merged} 个重复点`);
    status = `底图已清理：${parts.join('、')}`;
    window.console.info('[世界舆图] 底图清洗', reason, report);
    return true;
}
function writeBackup() {
    try {
        localStorage.setItem('worldmap_local_backup', JSON.stringify(base));
    }
    catch {
        /* 忽略 */
    }
}
function persistBaseMap(immediate = false) {
    base.nodes = graph.toArray().sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path, 'zh'));
    base.updatedAt = new Date().toISOString();
    if (saveTimer)
        window.clearTimeout(saveTimer);
    if (immediate) {
        saveTimer = null;
        saveBaseMap(base);
        writeBackup();
        return;
    }
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        saveBaseMap(base);
        writeBackup();
    }, 600);
}
function persistTrail() {
    saveTrail(trail);
}
function download(filename, content) {
    try {
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = hostDocument.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        hostDocument.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    catch (error) {
        toast('error', `导出失败：${String(error)}`);
    }
}
// ── 数据刷新 ────────────────────────────────────────────────────────────
function readCurrentLocation() {
    const sources = [hostWindow.Mvu, window.Mvu];
    for (const Mvu of sources) {
        try {
            if (Mvu?.getMvuData) {
                const value = Mvu.getMvuData({ type: 'chat' })?.stat_data?.世界?.当前地点;
                if (typeof value === 'string' && value.trim())
                    return value.trim();
            }
        }
        catch {
            /* 换下一个来源 */
        }
    }
    try {
        const value = getVariables({ type: 'chat' })?.stat_data?.世界?.当前地点;
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    catch {
        /* 忽略 */
    }
    return null;
}
function refreshTrail() {
    try {
        const lastId = getLastMessageId();
        if (lastId < 0) {
            trail = { schemaVersion: 1, points: [], hiddenPointIds: trail?.hiddenPointIds ?? [] };
            render();
            return;
        }
        const messages = getChatMessages(`0-${lastId}`);
        const result = rebuildTrail({
            messages: messages.map(message => ({
                message: String(message?.message ?? ''),
                is_user: Boolean(message?.is_user),
                swipe_id: Number(message?.swipe_id ?? 0),
            })),
            graph,
            hiddenPointIds: [...(trail?.hiddenPointIds ?? [])],
            previous: trail,
        });
        trail = result.trail;
        let dirty = result.createdNodes > 0;
        if (result.orphanCount) {
            window.console.info(`[世界舆图] 保留了 ${result.orphanCount} 个"楼层已不在"的轨迹点`);
        }
        const location = readCurrentLocation();
        if (location) {
            const resolved = graph.resolve(location, { create: true, source: 'trail' });
            if (resolved) {
                currentPath = resolved.node.path;
                if (resolved.created)
                    dirty = true;
            }
        }
        else if (trail.points.length) {
            currentPath = trail.points[trail.points.length - 1].path;
        }
        if (dirty && sanitizeGraph('轨迹新建节点后'))
            dirty = true;
        if (dirty)
            persistBaseMap();
        persistTrail();
        status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点${result.orphanCount ? `（含 ${result.orphanCount} 个存档已删楼层）` : ''}`;
        render();
    }
    catch (error) {
        toast('error', `重建轨迹失败：${String(error)}`);
    }
}
// 状态栏那行字：底图/轨迹数量变了就调一次（清空、生成、导入、恢复骨架都会用到）
function syncStatus(note) {
    const base = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点`;
    status = note ? `${note}｜${base}` : base;
}
function scheduleRefresh(reason) {
    if (refreshTimer)
        window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        window.console.info('[世界舆图] 刷新：', reason);
        refreshTrail();
    }, 300);
}
// ── 渲染 ────────────────────────────────────────────────────────────────
function render() {
    if (!canvas || !mapWindow)
        return;
    canvas.setView({
        graph,
        trail: trail.points,
        hiddenPointIds: new Set(trail.hiddenPointIds),
        hiddenNodeIds: new Set(base.hiddenIds),
        focusId,
        selectedId,
        currentPath,
        editMode,
        timelineIndex,
    });
    mapWindow.render({
        canvas,
        base,
        trail: trail.points,
        hiddenPointIds: new Set(trail.hiddenPointIds),
        settings,
        layout: loadLayout(),
        editMode,
        busy,
        status,
        currentPath,
        selectedId,
        focusId,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        timelineIndex,
        presetError,
    });
}
// ── 生成报告：让用户看得见"到底生成了什么" ──────────────────────────────
function fmt2(xy) {
    return `${Math.round(xy[0])}, ${Math.round(xy[1])}`;
}
function buildLayoutReport(scopeLabel, outcome) {
    const { result, used, total, picked, rawReply } = outcome;
    const lines = [];
    lines.push(`【生成${scopeLabel}】完成`);
    lines.push(`新增 ${result.added} 个点｜移动 ${result.moved} 个｜跳过锁定 ${result.skippedLocked} 个｜` +
        `丢弃无效 ${result.skippedBad} 个｜丢弃无意义设施 ${result.skippedTrivial} 个`);
    lines.push(`送给模型的资料 ${total} 条（约 ${Math.round(used / 1000)}k 字符）；现在底图共 ${graph.size} 个节点。`);
    lines.push('');
    lines.push(`—— 选中的世界书条目（${picked.length} 条）——`);
    for (const entry of picked.slice(0, 60)) {
        lines.push(`  · [${entry.book}] ${entry.comment}`);
    }
    if (picked.length > 60)
        lines.push(`  … 其余 ${picked.length - 60} 条略`);
    if (result.conflicts.length) {
        lines.push('');
        lines.push('—— 坐标冲突（正史已占位，AI 给的被丢掉）——');
        for (const item of result.conflicts.slice(0, 40)) {
            lines.push(`  · ${item.path}：保留 (${fmt2(item.kept)})，丢弃 (${fmt2(item.dropped)})`);
        }
    }
    lines.push('');
    lines.push('—— 模型原始回复 ——');
    lines.push(rawReply.trim() || '(空)');
    return lines.join('\n');
}
// ── 动作 ────────────────────────────────────────────────────────────────
const actions = {
    onToggleLayer(key, value) {
        canvas?.setView({ [key]: value });
        render();
    },
    onSelectNode(id) {
        selectedId = id;
        render();
    },
    onFocusNode(id) {
        focusId = id;
        canvas?.focusOn(id);
        render();
    },
    onFit() {
        focusId = null;
        canvas?.fit();
        render();
    },
    onLocateCurrent() {
        const node = currentPath ? graph.byPath.get(currentPath) : null;
        if (!node) {
            toast('info', '还没有当前地点，先玩一回合或点「从聊天记录重算」');
            return;
        }
        selectedId = node.id;
        focusId = node.id;
        canvas?.focusOn(node.id);
        render();
    },
    onSetEditMode(value) {
        editMode = value;
        status = value ? '编辑模式：拖动节点即可改位置' : `节点 ${graph.size} 个`;
        render();
    },
    onUndo() {
        const previous = undoStack.pop();
        if (!previous)
            return;
        redoStack.push(snapshot());
        restore(previous);
        toast('info', '已撤销');
    },
    onRedo() {
        const next = redoStack.pop();
        if (!next)
            return;
        undoStack.push(snapshot());
        restore(next);
        toast('info', '已重做');
    },
    onMoveSelected(xy) {
        if (!selectedId)
            return;
        pushUndo();
        graph.setPosition(selectedId, xy, { force: true, source: 'manual' });
        const node = graph.get(selectedId);
        if (node) {
            node.locked = true;
            node.status = 'ok';
        }
        persistBaseMap();
        render();
    },
    onRenameNode(id, name) {
        const node = graph.get(id);
        const trimmed = name.trim();
        if (!node || !trimmed || trimmed === node.name)
            return;
        pushUndo();
        const oldPath = node.path;
        node.name = trimmed;
        node.path = node.parentId ? `${graph.get(node.parentId)?.path ?? ''}·${trimmed}` : trimmed;
        for (const child of graph.descendants(node.id)) {
            child.path = child.path.replace(oldPath, node.path);
        }
        graph = new MapGraph(graph.toArray());
        persistBaseMap();
        render();
        toast('success', `已重命名为「${trimmed}」`);
    },
    onDeleteNode(id) {
        const node = graph.get(id);
        if (!node)
            return;
        pushUndo();
        const doomed = new Set([id, ...graph.descendants(id).map(child => child.id)]);
        graph = new MapGraph(graph.toArray().filter(item => !doomed.has(item.id)));
        base.hiddenIds = base.hiddenIds.filter(hidden => !doomed.has(hidden));
        selectedId = null;
        persistBaseMap();
        refreshTrail();
        toast('info', `已删除 ${doomed.size} 个节点`);
    },
    onAddChild(id, name) {
        pushUndo();
        const parent = id ? graph.get(id) : null;
        const node = graph.ensurePath([...(parent ? parent.path.split('·') : []), name], 'manual');
        if (node) {
            node.locked = true;
            node.source = 'manual';
            node.status = 'ok';
            if (parent) {
                const cell = graph.cellRadius(parent);
                node.xy = [parent.xy[0] + cell * 0.32, parent.xy[1] + cell * 0.32];
            }
            selectedId = node.id;
        }
        persistBaseMap();
        render();
    },
    /** 编辑模式下在画布空白处右键/双击：就地新建一个地点 */
    onCreateNodeAt(xy, parentId) {
        pushUndo();
        const parent = parentId ? graph.get(parentId) : null;
        const siblings = graph.children(parent?.id ?? null).length;
        const name = `新地点${siblings + 1}`;
        const node = graph.ensurePath([...(parent ? parent.path.split('·') : []), name], 'manual');
        if (node) {
            node.xy = [xy[0], xy[1]];
            node.locked = true;
            node.source = 'manual';
            node.status = 'ok';
            selectedId = node.id;
        }
        persistBaseMap();
        render();
        mapWindow?.selectForEdit(node ? node.id : '');
        toast('success', `已在 (${xy[0]}, ${xy[1]}) 新增「${name}」，在「编辑」里可改名`);
    },
    onToggleLock(id) {
        const node = graph.get(id);
        if (!node)
            return;
        node.locked = !node.locked;
        if (node.locked)
            node.status = 'ok';
        persistBaseMap();
        render();
        toast('info', node.locked ? '已锁定，AI 不会再改它' : '已解锁');
    },
    onScatterUnplaced() {
        pushUndo();
        const moved = graph.scatterUnplaced();
        persistBaseMap();
        render();
        toast('info', moved ? `已铺开 ${moved} 个待定位节点` : '没有待定位节点');
    },
    onTimeline(index) {
        timelineIndex = index;
        render();
    },
    onJumpToPoint(point) {
        const node = graph.get(point.nodeId);
        if (!node)
            return;
        selectedId = node.id;
        focusId = node.id;
        const index = trail.points.findIndex(item => item.id === point.id);
        if (index >= 0)
            timelineIndex = index >= trail.points.length - 1 ? null : index;
        canvas?.focusOn(node.id);
        render();
    },
    onTogglePointHidden(id) {
        const set = new Set(trail.hiddenPointIds);
        if (set.has(id))
            set.delete(id);
        else
            set.add(id);
        trail.hiddenPointIds = [...set];
        persistTrail();
        render();
    },
    onRebuildTrail() {
        refreshTrail();
        toast('success', `已重算：${trail.points.length} 个轨迹点`);
    },
    onClearHiddenPoints() {
        trail.hiddenPointIds = [];
        persistTrail();
        render();
    },
    onSaveSettings(patch) {
        settings = { ...settings, ...patch, api: { ...settings.api, ...(patch.api ?? {}) } };
        saveSettings(settings);
        render();
        toast('success', '设置已保存');
    },
    async onTestApi() {
        if (busy)
            return;
        busy = '正在测试模型连接…';
        render();
        try {
            const base = settings.api.url.trim().replace(/\/+$/, '');
            if (!base)
                throw new Error('还没填接口地址（形如 http://localhost:1234/v1）');
            const started = Date.now();
            let response;
            try {
                response = await fetch(`${base}/models`, {
                    headers: settings.api.key ? { Authorization: `Bearer ${settings.api.key}` } : {},
                });
            }
            catch (error) {
                // 网络层失败（拒绝连接 / CORS / https 混用）时给出可操作的提示
                throw new Error(`连不上 ${base}/models：${String(error)}。检查接口地址是否带 /v1、服务是否在跑、是否允许跨域。`);
            }
            const ms = Date.now() - started;
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status} ${response.statusText}｜${base}/models` +
                    (response.status === 401 || response.status === 403 ? '（密钥不对或没权限）' : '') +
                    (body ? `｜${body.slice(0, 200)}` : ''));
            }
            const data = (await response.json());
            const models = (data?.data ?? []).map(item => String(item.id ?? '')).filter(Boolean);
            if (!models.length)
                throw new Error(`${base}/models 返回成功，但里面没有模型列表。`);
            // 顺手把下拉填好，省得再点一次「获取模型列表」
            mapWindow?.fillModels(models);
            const head = models.slice(0, 4).join('、');
            toast('success', `连接正常（${ms}ms）：共 ${models.length} 个模型，如 ${head}${models.length > 4 ? ' …' : ''}`);
            mapWindow?.showReport(`【测试连接】成功\n接口：${base}\n耗时：${ms}ms\n模型：${models.length} 个\n` +
                models.map(id => `  · ${id}`).join('\n') +
                `\n当前选用：${settings.api.model || '(未设置)'}`, '连接测试通过；模型下拉已填好，选一个再点「保存设置」即可。');
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            toast('error', `连接失败：${message}`);
            mapWindow?.showReport(`【测试连接】失败\n接口：${settings.api.url || '(未填写)'}\n密钥：${settings.api.key ? '已填写' : '(空)'}\n原因：${message}\n`, `连接失败：${message}`);
        }
        finally {
            busy = null;
            render();
        }
    },
    async onRunLayout(scope) {
        if (busy)
            return;
        pushUndo();
        const scopeLabel = scope === 'world' ? '底图' : scope === 'region' ? '当前区域' : '全部地点';
        busy = `正在生成${scopeLabel}…`;
        render();
        try {
            const focusPath = (focusId ? graph.get(focusId)?.path : currentPath) ?? undefined;
            const outcome = await runLayout(graph, settings, scope, focusPath, message => {
                busy = message;
                render();
            });
            sanitizeGraph('AI 生成布局后');
            persistBaseMap(true);
            syncStatus(`AI 生成${scopeLabel}完成`);
            render();
            toast('success', `完成：新增 ${outcome.result.added}、移动 ${outcome.result.moved}、跳过锁定 ${outcome.result.skippedLocked}、丢弃无效 ${outcome.result.skippedBad}（资料 ${outcome.total} 条 / ${Math.round(outcome.used / 1000)}k 字符）`);
            mapWindow?.showReport(buildLayoutReport(scopeLabel, outcome), '生成完成；报告已留在文本框里，可直接复制留存或发给 AI 讨论。');
        }
        catch (error) {
            const previous = undoStack.pop();
            if (previous)
                restore(previous);
            const message = String(error instanceof Error ? error.message : error);
            toast('error', `生成失败，已保留原图：${message}`);
            mapWindow?.showReport(`【生成${scopeLabel}】失败\n${message}\n`, `生成失败：${message}`);
        }
        finally {
            busy = null;
            render();
        }
    },
    async onPullPreset() {
        if (!settings.presetUrl) {
            toast('warning', '请先在设置里填作者预设的网址');
            return;
        }
        busy = '正在拉取作者预设…';
        render();
        try {
            const preset = await fetchPresetMap(settings.presetUrl);
            if (!preset)
                throw new Error('预设为空');
            pushUndo();
            const report = mergeBaseMaps(base, preset, { source: 'preset' });
            graph = new MapGraph(base.nodes);
            presetError = undefined;
            persistBaseMap(true);
            syncStatus('作者预设已合并');
            render();
            toast('success', `作者预设已合并：新增 ${report.added}、更新 ${report.updated}、跳过锁定 ${report.skipped}`);
        }
        catch (error) {
            presetError = String(error);
            toast('error', `拉取失败：${String(error)}`);
        }
        finally {
            busy = null;
            render();
        }
    },
    onResetBaseMap() {
        pushUndo();
        base = seedBaseMap();
        graph = new MapGraph(base.nodes);
        selectedId = null;
        focusId = null;
        persistBaseMap(true);
        syncStatus('已恢复内置骨架');
        render();
        toast('success', '已恢复内置世界骨架');
    },
    /** 清空地图上所有地点（轨迹数据不动），两步确认 + 可撤销 */
    onClearNodes() {
        const count = graph.size;
        if (!count) {
            toast('info', '地图上已经没有地点了');
            return;
        }
        pushUndo();
        base = { ...base, nodes: [], updatedAt: new Date().toISOString() };
        graph = new MapGraph([]);
        selectedId = null;
        focusId = null;
        persistBaseMap(true);
        syncStatus('地图已清空（轨迹保留，可撤销）');
        render();
        toast('success', `已清空 ${count} 个地点（可撤销）。轨迹还在，下一回合会按正文重新落点。`);
    },
    onExportBaseMap() {
        persistBaseMap(true);
        return JSON.stringify(base, null, 2);
    },
    /** 导出「地名(坐标)｜…」锚点文本：可以直接替换提示词里的固定锚点段 */
    onExportAnchorText() {
        return buildAnchorText(graph);
    },
    onExportTrail() {
        download(`世界舆图轨迹-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(trail, null, 2));
    },
    onImportBaseMapText(text, report) {
        try {
            const trimmed = text.trim();
            if (!trimmed)
                throw new Error('内容是空的');
            // 容错：允许粘进来的是被 ```json 包起来的片段
            const cleaned = trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '');
            const parsed = JSON.parse(cleaned);
            if (!parsed || !Array.isArray(parsed.nodes))
                throw new Error('缺少 nodes 数组，这看起来不是底图 JSON');
            pushUndo();
            base = migrateBaseMap({ ...parsed, hiddenIds: parsed.hiddenIds ?? [] });
            graph = new MapGraph(base.nodes);
            sanitizeGraph('导入底图后');
            persistBaseMap(true);
            syncStatus('已导入底图');
            refreshTrail();
            render();
            const message = `已导入 ${base.nodes.length} 个节点。`;
            report(message);
            toast('success', message);
        }
        catch (error) {
            const message = `导入失败：${String(error)}`;
            report(message);
            toast('error', message);
        }
    },
};
/**
 * 生成"锚点速查文本"：按层级分组、只取 tier ≤ 3 的点（也就是提示词里那些固定锚点），
 * 坐标保留 1 位小数。用户可以直接把这段替换掉提示词里的「固定锚点」那几行，
 * 也可以整段发给 AI 让它调整。
 */
function buildAnchorText(target) {
    const byTier = new Map();
    for (const node of target.toArray()) {
        const tier = tierOf(node);
        if (tier > 3)
            continue;
        const list = byTier.get(tier);
        if (list)
            list.push(node);
        else
            byTier.set(tier, [node]);
    }
    const one = (node) => `${node.name}(${node.xy[0]},${node.xy[1]})`;
    const lines = [];
    lines.push('# 世界舆图 · 锚点速查（可直接替换提示词里的「固定锚点」段）');
    lines.push('# 坐标以神都洛阳为原点 (0,0)，正东 +x、正南 +y，向西/向北为负，范围 -500~500；1 单位 ≈ 15 亿里');
    const tier1 = byTier.get(1) ?? [];
    const tier2 = byTier.get(2) ?? [];
    if (tier1.length)
        lines.push(`\n【界域/大域】${tier1.map(one).join('｜')}`);
    if (tier2.length)
        lines.push(`\n【地域/地貌】${tier2.map(one).join('｜')}`);
    const tier3 = byTier.get(3) ?? [];
    const groups = new Map();
    for (const node of tier3) {
        const parent = node.parentId ? target.get(node.parentId) : undefined;
        const key = parent ? parent.path : '（无上级）';
        const list = groups.get(key);
        if (list)
            list.push(node);
        else
            groups.set(key, [node]);
    }
    for (const [key, list] of groups) {
        lines.push(`\n【${key} 下属】${list.map(one).join('｜')}`);
    }
    lines.push(`\n# 共 ${tier1.length + tier2.length + tier3.length} 个锚点；更细的地点（tier 4/5）不列在这里。`);
    return lines.join('\n');
}
// ── 初始化 ──────────────────────────────────────────────────────────────
function readLocalBackup() {
    try {
        // 第二个键是上一版的遗留名，只读不写
        const raw = localStorage.getItem('worldmap_local_backup') ?? localStorage.getItem('daoyuan_map_local_backup');
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.nodes) ? migrateBaseMap(parsed) : null;
    }
    catch {
        return null;
    }
}
async function init() {
    settings = loadSettings();
    const resolution = await resolveInitialBaseMap({
        local: loadBaseMap() ?? readLocalBackup(),
        presetUrl: settings.presetUrl || undefined,
    });
    base = resolution.map;
    presetError = resolution.presetError;
    graph = new MapGraph(base.nodes);
    sanitizeGraph('加载底图时');
    trail = loadTrail() ?? { schemaVersion: 1, points: [], hiddenPointIds: [] };
    persistBaseMap(true);
    const wrap = hostDocument.createElement('div');
    wrap.id = `${ID_PREFIX}canvas`;
    wrap.className = 'dym-canvas-wrap';
    canvas = new MapCanvas(wrap, {
        onSelect: id => actions.onSelectNode(id),
        onFocus: id => actions.onFocusNode(id),
        onMoveNode: (id, xy) => {
            selectedId = id;
            actions.onMoveSelected(xy);
        },
        onEditNode: id => {
            const node = graph.get(id);
            if (node)
                mapWindow?.contextMenu(node);
        },
        onCreateNodeAt: (xy, parentId) => actions.onCreateNodeAt(xy, parentId),
    }, defaultView(graph));
    const windowActions = {
        ...actions,
        onAddChild: (id, name) => actions.onAddChild(id, name),
        onSaveSettings: (patch) => actions.onSaveSettings(patch),
    };
    mapWindow = new MapWindow(hostDocument, {
        canvas,
        base,
        trail: trail.points,
        hiddenPointIds: new Set(trail.hiddenPointIds),
        settings,
        layout: loadLayout(),
        editMode,
        busy,
        status,
        currentPath,
        selectedId,
        focusId,
        canUndo: false,
        canRedo: false,
        timelineIndex,
        presetError,
    }, windowActions, wrap);
    hostDocument.body.appendChild(mapWindow.root);
    hostDocument.body.appendChild(mapWindow.launcher);
    mapWindow.launcher.style.display = 'none';
    status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点`;
    render();
    canvas.fitStage();
    refreshTrail();
    toast('success', `世界舆图已就绪（底图来源：${resolution.source === 'local' ? '本地' : resolution.source === 'preset' ? '作者预设' : '内置骨架'}）`);
}
function bindEvents() {
    const onMessage = (event) => () => scheduleRefresh(event);
    try {
        eventOn(tavern_events.MESSAGE_RECEIVED, onMessage('新楼层'));
        eventOn(tavern_events.MESSAGE_UPDATED, onMessage('楼层被编辑'));
        eventOn(tavern_events.MESSAGE_SWIPED, onMessage('切换 swipe'));
        eventOn(tavern_events.MESSAGE_DELETED, onMessage('楼层被删除'));
        eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, onMessage('楼层渲染'));
        eventOn(tavern_events.CHAT_CHANGED, () => {
            selectedId = null;
            focusId = null;
            timelineIndex = null;
            trail = loadTrail() ?? { schemaVersion: 1, points: [], hiddenPointIds: [] };
            scheduleRefresh('切换聊天');
        });
    }
    catch (error) {
        toast('error', `注册酒馆事件失败：${String(error)}`);
    }
    try {
        eventOn(getButtonEvent(BUTTON_NAME), () => {
            if (!mapWindow)
                return;
            if (mapWindow.isOpen()) {
                mapWindow.close();
            }
            else {
                mapWindow.open();
                actions.onLocateCurrent();
            }
        });
    }
    catch (error) {
        window.console.warn('[世界舆图] 注册脚本按钮失败', error);
    }
    void (async () => {
        try {
            await waitGlobalInitialized('Mvu');
            const Mvu = window.Mvu;
            if (Mvu?.events?.VARIABLE_UPDATE_ENDED) {
                eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => scheduleRefresh('变量更新结束'));
            }
            scheduleRefresh('Mvu 就绪');
        }
        catch (error) {
            window.console.info('[世界舆图] 未检测到 MVU，改用纯 JSONPatch 扫描', error);
        }
    })();
}
function teardown() {
    try {
        eventClearAll();
    }
    catch {
        /* 忽略 */
    }
    try {
        mapWindow?.destroy();
    }
    catch {
        /* 忽略 */
    }
    hostDocument.querySelectorAll(`[id^="${ID_PREFIX}"]`).forEach(element => element.remove());
    window.console.info('[世界舆图] 已卸载');
}
$(() => {
    void (async () => {
        try {
            await init();
            bindEvents();
            try {
                replaceScriptButtons([{ name: BUTTON_NAME, visible: true }]);
            }
            catch {
                /* 某些环境不允许改按钮 */
            }
        }
        catch (error) {
            toast('error', `世界舆图启动失败：${String(error)}`);
            window.console.error('[世界舆图] 启动失败', error);
        }
    })();
});
$(window).on('pagehide', () => teardown());
// 便于在控制台排查：window.__worldMap
hostWindow.__worldMap = {
    get graph() {
        return graph;
    },
    get base() {
        return base;
    },
    get trail() {
        return trail;
    },
    get settings() {
        return settings;
    },
    get canvas() {
        return canvas;
    },
    get window() {
        return mapWindow;
    },
    refresh: () => refreshTrail(),
    render: () => render(),
    /** 界面只留了「生成底图」一个按钮；想跑别的档位可以从控制台调这个 */
    runLayout: (scope = 'world') => actions.onRunLayout(scope),
    clearNodes: () => actions.onClearNodes(),
    /** 调试用：直接设定缩放倍率（试验台 ?zoom= 会用到） */
    zoomTo: (scale) => {
        const current = canvas?.getScale() ?? 1;
        canvas?.zoomBy(scale / Math.max(0.0001, current));
        render();
        return canvas?.getScale() ?? 0;
    },
    state: () => ({ nodes: graph.size, points: trail.points.length, currentPath, keys: [KEY_BASE_MAP, KEY_TRAIL] }),
    toBaseMap: () => toBaseMap(graph, base),
    /** 自检：渲染管线各环节的实际数量，供本地试验台/控制台确认 */
    diagnostics: () => {
        const visible = canvas ? canvas.getView().graph.toArray() : [];
        const points = canvas ? canvas.visibleTrailPoints() : [];
        const inCanvas = (selector) => hostDocument.querySelectorAll(`#${ID_PREFIX}canvas ${selector}`).length;
        return {
            open: mapWindow?.isOpen() ?? false,
            nodes: graph.size,
            visibleNodes: visible.length,
            trailPoints: trail.points.length,
            trailVertices: points.length,
            currentPath,
            rootInDom: Boolean(hostDocument.getElementById(`${ID_PREFIX}root`)),
            svg: {
                circles: inCanvas('svg circle'),
                texts: inCanvas('svg text'),
                polylines: inCanvas('svg polyline'),
                lines: inCanvas('svg line'),
                nodes: inCanvas('g.dym-node'),
            },
            dom: {
                placeItems: hostDocument.querySelectorAll(`#${ID_PREFIX}root .dym-list li`).length,
                tabs: hostDocument.querySelectorAll(`#${ID_PREFIX}root .dym-tabs button`).length,
            },
            layout: (() => {
                const root = hostDocument.getElementById(`${ID_PREFIX}root`);
                if (!root)
                    return null;
                const rect = root.getBoundingClientRect();
                const pick = (selector) => {
                    const node = root.querySelector(selector);
                    if (!node)
                        return 'missing';
                    const box = node.getBoundingClientRect();
                    return `${Math.round(box.width)}x${Math.round(box.height)}`;
                };
                return {
                    root: `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.left)},${Math.round(rect.top)}`,
                    rail: root.classList.contains('dym-rail'),
                    titlebar: pick('.dym-titlebar'),
                    body: pick('.dym-body'),
                    canvas: pick('.dym-canvas-wrap'),
                    drawer: pick('.dym-drawer'),
                    timeline: pick('.dym-timeline'),
                };
            })(),
            scale: Number(hostDocument.getElementById(`${ID_PREFIX}canvas`)?.dataset.dymScale ?? 0),
        };
    },
};
//# sourceMappingURL=index.js.map
return {  };
});
})();