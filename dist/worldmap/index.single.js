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
/** 会出现在「地点名」与「环境描述」之间的分隔符（实测五种都用过，空格也算——AI 爱用空格隔描述） */
const DESCRIPTION_CUTS = ['；', ';', '。', '，', ',', '！', '？', '!', '?', '\n', ' '];
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
/**
 * 高于该缩放倍率就隐藏这个层级的点（索引 = tier；Infinity = 不隐藏）。
 * 高德式：放大到街区级别时，「中州」「大域」这种洲级粒度只剩噪音，自动退场。
 */
const TIER_HIDE_ABOVE_SCALE = [Number.POSITIVE_INFINITY, 8, 25, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
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
// ── 坐标世界书（二期）────────────────────────────────────────────────
/**
 * 插件自建坐标世界书的书名。挂到角色卡 additional（原世界书零改动），
 * 由 `geo-book.ts` 负责创建/同步/挂载/卸载；底图永远是唯一真源（单向同步）。
 */
const WORLDMAP_BOOK = '世界舆图·坐标表';
/** 坐标世界书里条目名的统一前缀 —— 布局 AI 与其他脚本靠它隔离我们的条目 */
const GEO_ENTRY_PREFIX = '[舆图]';
/** 坐标世界书条目上限：防绿灯扫描性能劣化；超过时只收 tier≤3 */
const GEO_BOOK_MAX_ENTRIES = 200;
/** [地理态势] 注入提示词的 id（覆盖式重注与 pagehide 卸载都靠它） */
const GEO_INJECT_ID = 'worldmap-geo-context';
/** 态势块与坐标条目的坐标换算说明（跟底图一致：1 单位 ≈ 15 亿里） */
const GEO_UNIT_HINT = '1 坐标单位 ≈ 15 亿里';
/**
 * 人物移动规则的默认文本（设置页文本框预填，可在框里直接改）。
 * 与 `docs/提示词-地图坐标.md` 第八节保持一致。
 */
const DEFAULT_MOVEMENT_RULES = `[人物移动规则]
· 距离口径：世界书与舆图给出的距离自带约 1000 倍夸张倍率，按数字直接换算，不要用现实尺度校正。
· 距离参照：中州/南州/北冥横穿约 2500~3000 亿里（167~200 格）；神都到各大宗门以数百亿里起步。
· 各境界日行速度（1 坐标格 ≈ 15 亿里）：
  凡人 日行数万里，可忽略不计；
  金丹以下 御器/御剑，日行数百万里（不足 0.01 格）——跨域必须依赖传送阵；
  金丹、元婴 飞行，日行数千万里（约 0.01~0.05 格）——跨域基本依赖传送阵或飞舟；
  化神及以上 超高速肉身飞行为主、可短暂瞬移，日行数十亿里（约数格），跨大区以月计；
  合体期和大乘前期 真正能瞬移，瞬移+飞行交替，日行数百亿里（数十格）：跨一个大区约半天到三天；
  大乘后期/渡劫期（最顶级）掌握法则，数秒横跨大陆（2500 亿里 ≈ 170 格）。
· 远距离移动优先传送阵或飞舟；公用传送阵一般只有中型及以上城市才有。
· 硬性约束：赶路方式必须匹配境界，严禁降级移动（如「化神修士走路/骑马从洛阳到合欢宗」）；
  若「[地理态势]」提示位移超限，正文必须补出与境界相符的手段
  （传送阵/飞舟/法宝，大乘后期以上可为法则跨越），否则改写目的地。`;
/**
 * 叙事地理规则的默认文本（设置页文本框预填）。与 `docs/提示词-地图坐标.md` 第九节一致。
 * 生效范围恰好等于坐标书本身：随书蓝灯注入，卸书即失效。
 */
const DEFAULT_NARRATIVE_RULES = `[叙事地理规则]
· 地点权威：已挂载《世界舆图·坐标表》——地点之间的方位、距离与归属，以本书条目与每轮「[地理态势]」
  为最高依据，优先于世界书地点条目原文里的方位/距离描述（那是未校准的粗略记录）。
  两者冲突时按坐标书写，不要在正文里复述或争论差异。
· 事件地理归属：每个事件都发生在具体坐标上。当前场景只能自然出现「[地理态势]」所列地界与周边的
  人、势力与动向；远处正在发生的事（如东境妖族之战）不得在相距遥远的另一处直接上演——
  埋伏、哨卡、逃兵、余波都不会凭空跨域出现。
· 远方信息入场的唯一途径：亲历者转述、传讯玉简/书信、商队与旅人传闻、官府公告等，
  且应带有滞后与失真；传闻不得直接当成眼前事实描写。
· 例外：正在移动的势力（追击、迁徙、远征）可以跨区出现，但必须交代行进路线与耗时，与移动规则一致。
· 「[地理态势]」每回合更新；切换场景（跨格移动、传送）后，遭遇池按新位置重算，
  旧地点的剧情线只能以信息形式延续。`;
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
/**
 * 生成底图的「方位补充表」默认内容（与 docs/底图补充.txt 保持一致，可在设置页编辑）。
 *
 * 用法（三层优先级）：**补充表为主**先落点 → 坐标骨架（原点/四域）定框架 → 世界书条目做校验与补漏。
 * 格式：`地名-方位-距离(亿里)`，括号里是相对线索（距某地 N、向某方向 N 到边界、正上/正下方、宽度）。
 */
const LAYOUT_SUPPLEMENT_DEFAULT = `-以神都洛阳为中州中心：地点-在洛阳的XX方向-直线距离（亿里）

万法宗-东南-1200
湮丹宗-南-800
青玉宗-西南-无记录/（距蜀山500、合欢宗200）
蜀山剑门-西-700
昆仑道门-西-1000/（距蜀山300）
阵天宗-西北-300
符韵门-北偏西-600
星道宗-极北-1800/（绝迹冰谷正上高空30）
合欢宗-东南（可能）-400/（靠近南梁古国）
灵墟宗-东偏北、靠近无尽山脉

-中州边界：
万法宗向东400-无尽山脉（宽300）
湮丹宗向南300-烬骨荒原（宽80）
叹息沙海（宽120）
绝迹冰谷（宽35）

-东极青木域以建木中心，但无具体相对位置。
东部-九尾天狐-距神猿1200、距北部柳蛇300
西部-神猿-靠近无尽山脉
南部-五色孔雀-距九尾天狐1800、距神猿2000

-北冥雪原：
广寒宫为中心，距南边界1500
黑渊/水晶龙宫-广寒宫正下方0.1

-西漠佛国：
大雷音寺=须弥山，无距离记录
菩提城-叹息沙海的西边300

-南离火州：
北部-尸魔宗-距南血神宫200、距西古战场200
东部-太阳神宫-距北尸魔宗230、距西血神宫50
西部-万魔殿-距东血神宫300-距东北古战场500
中/南部-血神宫`;
const DEFAULT_GEO_CONTEXT = {
    enabled: true,
    depth: 1,
    role: 'system',
    nearbyCount: 6,
    enforceBounds: true,
    jumpNotice: true,
};
const DEFAULT_COORD_BOOK = {
    enabled: false,
    includeTier4: true,
    maxEntries: GEO_BOOK_MAX_ENTRIES,
    excludeTrailPlaces: false,
    // 两段规则默认预填 —— 设置页打开就有文本，不需要再去文档里手动复制
    movementRules: DEFAULT_MOVEMENT_RULES,
    movementRulesEnabled: true,
    narrativeRules: DEFAULT_NARRATIVE_RULES,
    narrativeRulesEnabled: true,
};
const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    api: { ...DEFAULT_API },
    presetUrl: DEFAULT_PRESET_URL,
    autoPlaceRadius: 1,
    defaultOpen: true,
    showEventLayer: true,
    showUnplaced: true,
    geoContext: { ...DEFAULT_GEO_CONTEXT },
    coordBook: { ...DEFAULT_COORD_BOOK },
    layoutSupplement: LAYOUT_SUPPLEMENT_DEFAULT,
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
return { COORD_MIN, COORD_MAX, COORD_CENTER, BASE_MAP_SCHEMA, ORIGIN_SHIFT, LOC_SEP, DESCRIPTION_CUTS, SEP_VARIANTS, tierOfKind, TIER_VISIBLE_SCALE, TIER_HIDE_ABOVE_SCALE, TIER_LABEL_SCALE, TIER_RADIUS_PX, TIER_FONT_PX, COLLAPSE_PX, ALTITUDE_OFFSET_PX, migrateBaseMap, KEY_BASE_MAP, KEY_TRAIL, WORLDMAP_BOOK, GEO_ENTRY_PREFIX, GEO_BOOK_MAX_ENTRIES, GEO_INJECT_ID, GEO_UNIT_HINT, DEFAULT_MOVEMENT_RULES, DEFAULT_NARRATIVE_RULES, ID_PREFIX, DEFAULT_API, DEFAULT_PRESET_URL, LAYOUT_SUPPLEMENT_DEFAULT, DEFAULT_GEO_CONTEXT, DEFAULT_COORD_BOOK, DEFAULT_SETTINGS, DEFAULT_LAYOUT, LAYER_RADIUS };
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
    if (/^(东|南|西|北|中)(部|侧|面|方|域|境|隅)$/.test(text))
        return true;
    // 「东南方半空」「高空」「地底深处」这类方位+泛指位置的词，不是具体地点
    if (/^((东南|西南|西北|东北|正东|正南|正西|正北|东|南|西|北|中)(部|方|侧)?(的)?)?(半空|上空|高空|深处|地底|水底|地底深处)$/.test(text))
        return true;
    return false;
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
    if (isTimeLikeName(segment))
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
/** 「戌时铜灯将尽」「23点」这类时刻/更点，AI 偶尔会把它当成当前地点写进来 */
function isTimeLikeName(name) {
    return /^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时/.test(name) || /^[0-9０-９]{1,3}(点|时)(半|整)?/.test(name);
}
/**
 * 「整个名字就是垃圾」的强判定（供底图自动清洗用，比 looksLikeDescription 更保守）：
 *   · 名字里带逗号/顿号 —— 地点与描述没切开（慈宁宫西暖阁,戌时铜灯将尽）；
 *   · 空格后面跟着描述（官道西段浅谷至缓坡 官道石面阵纹稀疏）；
 *   · 整串是个时刻（戌时铜灯已燃）；
 *   · 名字长得离谱（≥12 字）或含典型描写词。
 * 只对自动生成的节点清理，种子/预设/人工/锁定一律不碰。
 */
function isJunkLocationName(name) {
    const text = (name ?? '').trim();
    if (!text)
        return true;
    if (/[，,、;；]/.test(text))
        return true;
    const spaceParts = text.split(/\s+/).filter(Boolean);
    if (spaceParts.length >= 2 && looksLikeDescription(spaceParts[spaceParts.length - 1]))
        return true;
    if (isTimeLikeName(text))
        return true;
    if (/(之后|以前|以后)$/.test(text))
        return true;
    if (text.length >= 12)
        return true;
    for (const marker of ['明灭', '流转', '氤氲', '萦绕', '斜落', '映亮', '低垂', '漫开', '泛着', '拍打', '热气', '褪色']) {
        if (text.includes(marker))
            return true;
    }
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
return { normalize, stripEntryPrefix, cutDescription, splitSegments, joinSegments, nodeId, isBearingSegment, isImmortalRealmName, isTrivialFacility, looksLikeDescription, isTimeLikeName, isJunkLocationName, parseBearing };
});
__def("./graph.js", () => {
const { BASE_MAP_SCHEMA, COORD_CENTER, COORD_MAX, COORD_MIN, LAYER_RADIUS, LOC_SEP, tierOfKind } = __req('./types.js');
const { isBearingSegment, isImmortalRealmName, isJunkLocationName, isTrivialFacility, looksLikeDescription, nodeId, normalize, joinSegments, splitSegments } = __req('./path.js');
/** 段名别名表：把世界书与变量里的不同叫法归到一个节点上 */
const SEGMENT_ALIASES = {
    中州: '中央神州',
    神州: '中央神州',
    神都洛阳: '神都',
    皇宫: '宫城区',
    皇城: '宫城区',
    内城: '四区',
    百花谷: '百花坊',
    // AI 偶尔把王朝与都城写成一段、或漏掉王朝层、或把「全国」当根 —— 都会建出平行树
    大周神都: '神都',
    大周: '大周仙朝',
    全国: '',
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
     * 近名子节点：只在「双方都是轨迹自动生成且未确认」时认领（见 similarName）。
     * 专治 AI 把同一处写出两种叫法（渡口茶棚/渡口茶摊）——不合并就会生成两个点，
     * 轨迹在两点之间来回打乒乓，坐标书里也会多出一条重复条目。
     */
    findFuzzyChild(parentId, name) {
        if (name.length < 3)
            return undefined;
        for (const child of this.children(parentId)) {
            if (child.source !== 'trail' || child.status !== 'unplaced' || child.locked)
                continue;
            if (similarName(child.name, name))
                return child;
        }
        return undefined;
    }
    /**
     * 「大周神都」= 子级「大周仙朝」+ 孙级「神都」被 AI 拼成了一段。
     * 尝试把这一段拆成两级认领到现有树上；只认领已存在的节点，绝不据此新建。
     */
    claimMerged(parent, segment) {
        if (segment.length < 3)
            return undefined;
        for (const child of this.children(parent.id)) {
            if (segment === child.name || !segment.startsWith(child.name))
                continue;
            const rest = segment.slice(child.name.length);
            if (!rest)
                continue;
            const grand = this.findChild(child.id, rest) ?? this.findDescendantByName(child.id, rest, 1);
            if (grand)
                return grand;
        }
        return undefined;
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
                const child = this.findChild(deepest.id, segment) ??
                    this.findDescendantByName(deepest.id, segment, 2) ??
                    this.claimMerged(deepest, segment) ??
                    (source === 'trail' ? this.findFuzzyChild(deepest.id, segment) : undefined);
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
            // 首段整个是垃圾名（AI 把时刻/描述当成当前地点写进来）→ 这个地点串放弃，不建点
            if (!parent && isJunkLocationName(segment))
                return null;
            const parentId = parent ? parent.id : null;
            const child = parent
                ? this.findChild(parentId, segment) ??
                    this.findDescendantByName(parentId, segment, 2) ??
                    this.claimMerged(parent, segment) ??
                    (source === 'trail' ? this.findFuzzyChild(parentId, segment) : undefined)
                : undefined;
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
    /**
     * 自动落点：围绕父节点的向日葵螺旋；半径自适应父节点的局部格子。
     * 名字里带方位词的（「车州渡西南三百里」「官道东段」）朝那个方向落 —— 方位是正文里
     * 最可靠的免费信息，比哈希随机角靠谱得多；距离数字不可信（口径夸张约千倍），只取方向。
     */
    autoPlace(parent, name) {
        const depth = parent ? parent.depth + 1 : 0;
        const base = LAYER_RADIUS[Math.min(depth, LAYER_RADIUS.length - 1)] || 40;
        const cell = parent ? this.cellRadius(parent) : 200;
        const radius = Math.max(0.35, Math.min(base, cell * 0.42));
        const siblings = this.children(parent?.id ?? null).length;
        const golden = 2.399963229728653;
        const jitter = (hashUnit(name) - 0.5) * 0.5;
        const bearing = bearingOf(name);
        const angle = bearing ? Math.atan2(bearing[1], bearing[0]) + jitter : siblings * golden + (hashUnit(name) - 0.5) * 0.6;
        // 方位点稍微离父点远一点，避免压在父点头上；普通点维持原来的疏密节奏
        const distance = radius * (bearing ? 1.15 : 0.5 + 0.5 * Math.sqrt((siblings % 7) / 7 + 0.2));
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
/** 八方位向量；四字复合方位先查，单字后查（「东南」优先于「南」） */
const BEARINGS = [
    ['东南', [0.707, 0.707]],
    ['西南', [-0.707, 0.707]],
    ['西北', [-0.707, -0.707]],
    ['东北', [0.707, -0.707]],
    ['东', [1, 0]],
    ['南', [0, 1]],
    ['西', [-1, 0]],
    ['北', [0, -1]],
];
/** 从地名里解析方位词（「渡口西南三百里」→ 西南）；没有就返回 null */
function bearingOf(name) {
    for (const [key, vec] of BEARINGS) {
        if (name.includes(key))
            return vec;
    }
    return null;
}
/**
 * 名字近似（编辑距离 ≤ 1，如「渡口茶棚」vs「渡口茶摊」）→ 大概率是 AI 对同一处的两种写法。
 * 只对双方都是轨迹自动生成且未确认的节点做合并；已确认/人工/AI 铺的点绝不误伤。
 */
function similarName(a, b) {
    if (a === b)
        return true;
    if (!a || !b || Math.abs(a.length - b.length) > 1)
        return false;
    if (a.length === b.length) {
        let diff = 0;
        for (let index = 0; index < a.length; index++) {
            if (a[index] !== b[index]) {
                diff++;
                if (diff > 1)
                    return false;
            }
        }
        return diff === 1;
    }
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    let i = 0;
    let j = 0;
    let skipped = false;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) {
            i++;
            j++;
            continue;
        }
        if (skipped)
            return false;
        skipped = true;
        j++;
    }
    return true;
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
 *   3. 剔除「垃圾名」节点（名字里带逗号/整串是时刻/离谱长名）——AI 把描述写进地名、
 *      把时刻当地点都会在这里清掉；种子/预设/人工/锁定一律不碰
 *   4. 合并重复节点：同名 + 路径互相包含 + 坐标几乎重合 → 只留一个，子节点迁移
 *   5. 重算 id/path/depth（上提与合并都会改变层级）
 */
function sanitizeNodes(input) {
    const report = { removedBearing: 0, removedImmortal: 0, removedJunk: 0, merged: 0, total: input.length };
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
        // 垃圾名：只清自动生成的（轨迹/AI），种子、预设、人工、锁定一律不碰
        if (!node.locked &&
            (node.source === 'trail' || node.source === 'ai') &&
            node.name &&
            isJunkLocationName(node.name)) {
            removed.add(node.id);
            report.removedJunk++;
        }
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
    // 垃圾名节点与方位节点一样：自己消失，子节点上提
    for (const id of [...removed]) {
        const grand = effectiveParent.get(id) ?? null;
        for (const child of originalChildren.get(id) ?? []) {
            if (!immortal.has(child.id) && !removed.has(child.id))
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
return { SEGMENT_ALIASES, PATH_ALIASES, MAX_AUTO_DEPTH, applyPathAliases, isVec2, MapGraph, bearingOf, similarName, toBaseMap, normalize, tierOf, sanitizeNodes };
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
        // 「AI 整理本会话地点」的规范化结果优先：命中就绕过脏字符串直接用干净路径
        const fix = source ? options.pathFixes?.[normalize(source)] : undefined;
        const pathText = fix?.path ?? normalize(source ?? '');
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
        // 整理结果里带了相对坐标、且这一层没有更可靠的来源 → 用它兜底
        if (posSrc === 'auto' && fix && Number.isFinite(Number(fix.x)) && Number.isFinite(Number(fix.y)) && !node.locked) {
            xy = [Number(fix.x), Number(fix.y)];
            posSrc = 'ai';
            node.xy = xy;
            if (node.status === 'unplaced' && node.source === 'trail')
                node.status = 'ok';
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
        // 规范化结果必须跟着 trail 走：否则第一次重算就把「AI 整理」冲掉，重开会话又全乱
        pathFixes: options.pathFixes,
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
/**
 * 收集本会话出现过的**原始地点串**（去重、保序），供「AI 整理本会话地点」发给模型。
 * 只取结构化来源（世界.当前地点 / 地图.层级）；正文兜底那种太脏，不进 AI 清单。
 */
function collectRawLocations(messages, limit = 120) {
    const seen = new Set();
    const out = [];
    for (const message of messages) {
        if (!message || message.is_user)
            continue;
        const info = extractMessageMapInfo(String(message.message ?? ''));
        const raw = info.location ?? info.mapVar?.层级;
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!text)
            continue;
        const key = normalize(text);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(text);
        if (out.length >= limit)
            break;
    }
    return out;
}
/** 把轨迹里连续重复的坐标合并，供画线使用。孤儿点（楼层已不在聊天里）不参与连线与绘制 */
function polylinePoints(points, hidden) {
    const visible = points.filter(point => !hidden.has(point.id) && !point.orphan);
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
return { repairJson, parseJsonPatch, extractMessageMapInfo, extractLooseLocation, rebuildTrail, distance, collectRawLocations, polylinePoints };
});
__def("./store.js", () => {
const { DEFAULT_COORD_BOOK, DEFAULT_GEO_CONTEXT, DEFAULT_LAYOUT, DEFAULT_MOVEMENT_RULES, DEFAULT_NARRATIVE_RULES, DEFAULT_SETTINGS, KEY_BASE_MAP, KEY_TRAIL, LAYOUT_SUPPLEMENT_DEFAULT, migrateBaseMap } = __req('./types.js');
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
/**
 * 两层分界：底图（角色卡变量，跨会话）只存「设定 + 人工新增/确认的非轨迹节点」；
 * **所有轨迹来源的节点**（含人工拖动过、锁定的）都属于轨迹层，随聊天变量走（trail.nodes）。
 * ——轨迹点编辑只改坐标不改来源，手调的轨迹点不会被当成设定写进底图/坐标书。
 * 内存里两者合成一棵树，持久化时按这条线劈开。
 */
function isBaseMapNode(node) {
    return node.source !== 'trail';
}
/** 轨迹层节点（与 isBaseMapNode 互补） */
function isTrailLayerNode(node) {
    return node.source === 'trail';
}
function loadBaseMap() {
    const map = readScope(KEY_BASE_MAP, 'character') ??
        readScope(KEY_BASE_MAP, 'chat') ??
        readScope(LEGACY_KEY_BASE_MAP, 'character') ??
        readScope(LEGACY_KEY_BASE_MAP, 'chat');
    if (!map || !Array.isArray(map.nodes))
        return null;
    // 底图里不允许混轨迹层节点：老版本存进来的轨迹点在读取时直接丢弃（按新架构用「从聊天记录重算」重建）
    const cleaned = { ...map, nodes: map.nodes.filter(isBaseMapNode) };
    return migrateBaseMap(cleaned);
}
function saveBaseMap(map) {
    const cleaned = { ...map, nodes: (map.nodes ?? []).filter(isBaseMapNode) };
    const ok = writeScope(KEY_BASE_MAP, cleaned, 'character');
    if (!ok)
        writeScope(KEY_BASE_MAP, cleaned, 'chat');
    return ok;
}
function loadTrail() {
    const trail = readScope(KEY_TRAIL, 'chat') ?? readScope(LEGACY_KEY_TRAIL, 'chat');
    if (!trail || !Array.isArray(trail.points))
        return null;
    return { ...trail, nodes: Array.isArray(trail.nodes) ? trail.nodes : [] };
}
function saveTrail(trail) {
    writeScope(KEY_TRAIL, trail, 'chat');
}
/**
 * 坐标书设置合并：老存档缺字段、或规则文本框是空串时，一律回退到**内置默认规则文本**——
 * 用户打开设置就能看到两段规则，不需要再去文档里手动复制。
 */
function mergeCoordBook(stored) {
    const merged = { ...DEFAULT_COORD_BOOK, ...(stored ?? {}) };
    if (!merged.movementRules)
        merged.movementRules = DEFAULT_MOVEMENT_RULES;
    if (!merged.narrativeRules)
        merged.narrativeRules = DEFAULT_NARRATIVE_RULES;
    return merged;
}
/** 插件设置的 localStorage 镜像键：脚本作用域会在重装/更新插件时丢，这里兜底（尤其 API KEY） */
const LOCAL_SETTINGS_KEY = 'settings';
function loadSettings() {
    const stored = readScope('settings', 'script') ??
        readScope('settings', 'global') ??
        readLocal(LOCAL_SETTINGS_KEY);
    // localStorage 镜像：脚本作用域里 API 配置缺了（更新插件/换安装方式）就用镜像补上
    const mirror = readLocal(LOCAL_SETTINGS_KEY);
    if (mirror?.api && stored) {
        const api = { ...DEFAULT_SETTINGS.api, ...(stored.api ?? {}) };
        for (const field of ['url', 'key', 'model']) {
            if (!String(api[field] ?? '').trim() && mirror.api[field])
                api[field] = mirror.api[field];
        }
        stored.api = api;
    }
    else if (!stored && mirror) {
        return finalizeSettings(mirror);
    }
    return finalizeSettings(stored);
}
/** 应用默认值并固化（含坐标书规则文本回退） */
function finalizeSettings(stored) {
    if (!stored)
        return { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api }, geoContext: { ...DEFAULT_GEO_CONTEXT }, coordBook: mergeCoordBook(null) };
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        schemaVersion: 1,
        api: { ...DEFAULT_SETTINGS.api, ...(stored.api ?? {}) },
        // 二期新字段：老存档没有这两块，用默认值补齐（缺省关自动同步、开态势注入）
        geoContext: { ...DEFAULT_GEO_CONTEXT, ...(stored.geoContext ?? {}) },
        coordBook: mergeCoordBook(stored.coordBook),
        // 方位补充表：老存档没有就给内置默认；用户清空过（空串）则尊重空串
        layoutSupplement: stored.layoutSupplement ?? LAYOUT_SUPPLEMENT_DEFAULT,
    };
}
function saveSettings(settings) {
    writeScope('settings', settings, 'script');
    // 同步一份到 localStorage：脚本作用域在插件更新/重装后可能清空，KEY 不能跟着丢
    writeLocal(LOCAL_SETTINGS_KEY, settings);
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
return { readScope, writeScope, isBaseMapNode, isTrailLayerNode, loadBaseMap, saveBaseMap, loadTrail, saveTrail, loadSettings, saveSettings, loadLayout, saveLayout, describeContext };
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
const { COORD_MAX, COORD_MIN, GEO_ENTRY_PREFIX, WORLDMAP_BOOK } = __req('./types.js');
const { isBearingSegment, isTrivialFacility, looksLikeDescription } = __req('./path.js');
/**
 * 条目名以这些词开头 → 算地点类条目。
 *
 * 注意「地点」和「势力」是**裸前缀**（不要求后面跟冒号）：整理世界书时
 * `地点：X`、`地点-X`、`势力：X`、`势力X` 各种写法都出现过。之前只认带冒号的
 * `地点：`/`势力详情：`，结果一整批「势力」条目被漏掉，底图上没有这些宗门。
 */
const LOCATION_COMMENT = /^(地点|势力|秘境详情|妖族势力|设施[-—]|区域[-—])/;
/** 地点类条目正文的特征（导出给自测：坐标条目的 content 必须避开这些写法） */
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
    // 自己生成的坐标条目（[舆图] 前缀）绝不是资料 —— 双保险，正常情况下书名已被剔除
    if (name.startsWith(GEO_ENTRY_PREFIX))
        return false;
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
    // 关键隔离：插件自建的《世界舆图·坐标表》绝不能当成资料 ——
    // 否则布局 AI 会把自己的坐标条目当输入，自我循环、越铺越歪。
    names.delete(WORLDMAP_BOOK);
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

【输入分三层，按优先级使用】
1. **方位补充表**（用户整理的方位/距离，最高优先）：先完全按它落点；
2. **坐标系骨架**：原点与四域中心固定（见下）；中州四界除非与补充表直接冲突，否则沿用；
3. **世界观资料**（世界书条目）：用来**校验**补充表是否合理，并补充表里没有的地点。

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

【工作流：先落补充表 → 再校验 → 再出图】
- 第一步（落表）：把方位补充表里每一条按「方位 → 角度、亿里 ÷15 → 格」换算成坐标，以神都为圆心铺开。
  方位照字面理解：东南 = +x+y 各占一半；北偏西 = -y 为主、略偏 -x；极北 = 正北拉满；
  「无记录」但有相对线索的（距某地 N、靠近某地），用相对线索定位。
- 第二步（精修）：括号里的相对线索必须用上——
  「距某地 N 亿里」= 以该地为圆心 N/15 格的圆；
  「正上方 / 正下方」= 同 xy 不同高度，写进 altitude（单位「里」，亿里 ×10^8）；
  「向某方向 N 亿里到某地 / 边界」= 从该地沿该方向平移 N/15 格；
  「宽 N 亿里」= 该边界地物的跨度 N/15 格。
  多条线索联立（例：「甲宗东南 1200 亿里」+「甲宗向东 400 亿里到东界山脉」+「山脉是中州边界」）
  时解交集——能得到唯一解就用它。
- 第三步（校验）：逐个节点拿世界书条目对照——
  · 方向或量级矛盾 → **以补充表为准**，并把冲突写进该节点 note（例：「资料冲突：条目记 600 亿里，按补充表 800 亿里取」）；
  · 条目里补充表没有的地点、区域轮廓（shape）、内部结构 → 正常按条目定位（相互印证、宁可贴上级、禁止编造）；
  · 完全无线索 → 挂最合理上级附近，note 写明「资料未给方位，按上级估算」。
- 冲突裁决顺序：**相对神都的方位+距离 > 补充表内的相对关系 > 世界书条目**。
  两条相对线索联立无解（两圆不相交）时：满足靠前的那条，另一条连同原因写进 note。

【第一件事：把该有的都找齐，一个都不能漏】
- 资料里**每一条以「地点」「势力」开头的条目，都必须产出一个节点**。有 20 条就出 20 个，
  不许因为「不好定位」就跳过。同一个地方在两条资料里重复出现的，合并成一个。
- 输出前自己核对一遍：条目数 ≈ 节点数。

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
- **资料里没有明说的子区域**：某宗「外城/内城/分部/外围」、某地「半空/上空/深处」这类衍生词——
  条目原文没明确写出这个子地点，就宁可只留上级，**严禁自行拆分或造点**。
- 环境描述（含「的」「半垂」「明灭」这类描写的短句）与时刻（戌时铜灯将尽这类）。
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
    // 生成底图是「一次性设定铺点」：输入只有方位补充表 + 世界书条目 + 提示词里的固定锚点，
    // 不再罗列已有节点（聊天轨迹点绝不能进来，正式底图点靠合并时的同名认领保证不叠加）。
    const header = `任务：绘制【${scopeLabel}】。\n`;
    const supplement = (options.layoutSupplement ?? '').trim();
    const supplementSection = supplement
        ? `\n\n【方位补充表】（最高优先依据：先完全按它落点，再用下面的世界观资料校验合理性与补充细节）\n${supplement}\n`
        : '';
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
    const user = `${header}${supplementSection}\n\n世界观资料（校验与补充用）：\n${chunks.join('')}\n\n请输出 JSON。`;
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
/** 调一次模型（OpenAI 兼容端点，不经过酒馆正文管道）；网络层失败自动重试一次 */
async function requestLayout(settings, prompt) {
    // 接口地址必须 trim：粘贴时带上的空格/换行会拼出非法 URL，fetch 直接 Failed to fetch
    const base = settings.api.url.trim().replace(/\/+$/, '');
    const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const doFetch = async () => fetch(endpoint, {
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
    let response;
    try {
        response = await doFetch();
    }
    catch (firstError) {
        // Failed to fetch = 请求没送达（网络抖动/代理抽风/DNS），不是截断：歇 1 秒重试一次
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            response = await doFetch();
        }
        catch {
            throw new Error(`连不上模型接口（${endpoint}）：网络层失败且重试仍失败。` +
                `先点「测试连接」排查：通了就是临时抖动再点一次整理；不通就检查接口地址、代理/VPN 和网络。` +
                `（原始错误：${String(firstError instanceof Error ? firstError.message : firstError)}）`);
        }
    }
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
    const prompt = buildLayoutPrompt(picked, {
        scope,
        focusPath,
        layoutSupplement: settings.layoutSupplement,
    });
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
// ── AI 整理本会话地点（聊天中途装插件的一次性补救）─────────────────────
const HISTORY_SYSTEM = `你是修仙世界的地名整理助手。输入是逐条「当前地点」原文——它们可能混着环境描述、时刻、
被拼在一起的层级、方位词，你要把每一条规范化成干净的地名层级路径。

【规则】
· 路径用「·」连接、从大到小。示例：全国·中央神州·大周神都·宣武门外官道 → 中央神州·大周仙朝·神都·宣武门外官道。
· 丢掉环境描述与时刻尾巴：「慈宁宫西暖阁,戌时铜灯将尽」→ 慈宁宫西暖阁。
· 丢掉纯方位层（东南部/西部/全国）；拆开被拼成一段的层级（大周神都 → 大周仙朝·神都）。
· 尽量套用【已知设定地点】里的既有写法；设定里确实没有的地点（客栈茶棚这类玩出来的地方）
  挂在最合理的上级或参照地之下，不要发明设定里没有的子区域。
· 输出条目与输入**一一对应、顺序不变**，不得增删。

【输出格式】只输出 JSON，不要解释：
{"items":[{"raw":"输入原文","path":"规范化路径","x":12.5,"y":-3.2}]}
x/y 只对「已知设定地点里没有的地点」给出：按原文里的方位词与相对参照（距某地若干里）估算——
1 单位=15 亿里、数字有约千倍夸张按字面换算；没有把握就省略 x/y，设定里已有的地点一律不要给。`;
function buildHistoryPrompt(raws, knownPaths, budget = 16000) {
    const known = knownPaths.slice(0, 200).join('\n');
    const list = raws.map((raw, index) => `${index + 1}. ${raw}`).join('\n');
    const user = `【已知设定地点】\n${known || '（暂无）'}\n\n【本会话原始地点串】\n${list}\n\n请输出 JSON。`;
    return { system: HISTORY_SYSTEM, user, used: Math.min(user.length, budget), total: raws.length };
}
/** 宽容解析历史整理回复；只接受 raw 能对回输入清单的条目 */
function parseHistoryReply(text, validRaws) {
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
                const items = Array.isArray(parsed?.items) ? parsed.items : [];
                const fixes = [];
                for (const item of items) {
                    const raw = String(item?.raw ?? '').trim();
                    const path = String(item?.path ?? '').trim();
                    if (!raw || !path || !validRaws.has(raw))
                        continue;
                    const x = Number(item?.x);
                    const y = Number(item?.y);
                    fixes.push({
                        raw,
                        path,
                        x: Number.isFinite(x) ? x : undefined,
                        y: Number.isFinite(y) ? y : undefined,
                    });
                }
                if (fixes.length)
                    return fixes;
            }
            catch {
                /* 试下一种 */
            }
        }
    }
    return [];
}
//# sourceMappingURL=layout-ai.js.map
return { LOCATION_CONTENT, entryTitle, isLocationEntry, collectLocationEntries, selectEntries, buildLayoutPrompt, parseLayoutReply, mergeAiLayout, requestLayout, runLayout, graphToBaseMapPatch, buildHistoryPrompt, parseHistoryReply };
});
__def("./geo-book.js", () => {
const { GEO_BOOK_MAX_ENTRIES, GEO_ENTRY_PREFIX, WORLDMAP_BOOK } = __req('./types.js');
const { PATH_ALIASES, SEGMENT_ALIASES, tierOf } = __req('./graph.js');
/**
 * 挑出要进坐标书的节点：
 *   · tier≤3（界域/地域/城池与宗级势力）全部收；
 *   · tier4 只收 includeTier4 且已确认定位（status==='ok'）的城内要点；
 *   · tier5（房间）、unplaced（待定位虚线圈）、被隐藏的一律不进 —— 虚线圈的坐标还没被人工确认，
 *     写进书里等于把猜测喂给模型。
 */
function selectCoordNodes(graph, options) {
    const hidden = new Set(options.hiddenIds ?? []);
    return graph
        .toArray()
        .filter(node => !hidden.has(node.id))
        .filter(node => node.status === 'ok')
        // 剔除轨迹地点：换新对话时不想让上一档玩出来的地名进书（人工拖过的也算轨迹地点）
        .filter(node => !(options.excludeTrail && node.source === 'trail'))
        .filter(node => {
        const tier = tierOf(node);
        if (tier <= 3)
            return true;
        return tier === 4 && options.includeTier4;
    })
        .sort((a, b) => tierOf(a) - tierOf(b) || a.depth - b.depth || a.path.localeCompare(b.path, 'zh'));
}
/** 坐标显示：保留 1 位小数（0.9 这类城内偏移），整数不带小数点 */
function fmtCoord(value) {
    return String(Math.round(value * 10) / 10);
}
/**
 * 绿灯关键词：地名本身 + 别名表里指向它的所有叫法。
 * 注意不要把父级/大区名塞进来 —— 那会让整个大区的条目在随便提及时全量注入，token 失控。
 */
function keysForNode(node) {
    const keys = new Set();
    if (node.name)
        keys.add(node.name);
    for (const [alias, target] of Object.entries(SEGMENT_ALIASES)) {
        if (target === node.name)
            keys.add(alias);
    }
    for (const entry of PATH_ALIASES) {
        const last = entry.replacement[entry.replacement.length - 1];
        if (last === node.name) {
            for (const part of entry.pattern) {
                if (part !== node.name)
                    keys.add(part);
            }
        }
    }
    return [...keys];
}
/** 蓝灯总纲：原点/轴向/换算 + tier1/2 大域锚点（从底图现算，不写死任何作品专名） */
function buildOverviewDraft(graph) {
    const anchors = selectCoordNodes(graph, { includeTier4: false })
        .filter(node => tierOf(node) <= 2)
        .slice(0, 24)
        .map(node => `${node.name}(${fmtCoord(node.xy[0])},${fmtCoord(node.xy[1])})`);
    const originCandidates = graph
        .toArray()
        .filter(node => node.xy[0] === 0 && node.xy[1] === 0 && tierOf(node) <= 3)
        // (0,0) 上可能同时压着界域/王朝/都城 —— 取最具体的那层：tier 大者优先，同为市级则城池优先、短路径优先
        .sort((a, b) => tierOf(b) - tierOf(a) ||
        (b.kind === 'city' ? 1 : 0) - (a.kind === 'city' ? 1 : 0) ||
        a.path.length - b.path.length);
    const originName = originCandidates[0]?.name ?? '原点';
    const content = `[舆图·坐标系] 本世界以「${originName}」为原点 (0,0)：正东 +x、正南 +y，向西/向北为负，范围 -500~500；1 坐标单位 ≈ 15 亿里。\n` +
        (anchors.length ? `大域锚点：${anchors.join('｜')}\n` : '') +
        '写坐标时锚点直接采用；锚点外的地点按资料里的方位与距离换算；与上一回合同地时坐标保持不变。';
    return { name: `${GEO_ENTRY_PREFIX}坐标系总纲`, content, keys: [], constant: true, sticky: 0, depth: 4 };
}
/**
 * 生成整本坐标书的条目草稿：第 0 条是蓝灯总纲，其余是绿灯地点条目。
 * 地点条目数量受 maxEntries 限制（默认 200），超出部分按排序（tier 优先）截断。
 */
function buildCoordDrafts(graph, options = {}) {
    const includeTier4 = options.includeTier4 !== false;
    const maxEntries = Math.max(1, options.maxEntries ?? GEO_BOOK_MAX_ENTRIES);
    const drafts = [buildOverviewDraft(graph)];
    // 蓝灯规则条目：非空就紧跟总纲（距离换算/赶路方式/叙事地理约束都跟坐标系统同源）
    const movementRules = (options.movementRules ?? '').trim();
    if (movementRules) {
        drafts.push({
            name: `${GEO_ENTRY_PREFIX}人物移动规则`,
            content: movementRules,
            keys: [],
            constant: true,
            sticky: 0,
            depth: 4,
        });
    }
    const narrativeRules = (options.narrativeRules ?? '').trim();
    if (narrativeRules) {
        drafts.push({
            name: `${GEO_ENTRY_PREFIX}叙事地理规则`,
            content: narrativeRules,
            keys: [],
            constant: true,
            sticky: 0,
            depth: 4,
        });
    }
    const usedNames = new Set(drafts.map(draft => draft.name));
    const nodes = selectCoordNodes(graph, {
        includeTier4,
        hiddenIds: options.hiddenIds,
        excludeTrail: options.excludeTrailPlaces,
    }).slice(0, maxEntries);
    for (const node of nodes) {
        let name = `${GEO_ENTRY_PREFIX}${node.name}`;
        if (usedNames.has(name)) {
            const parent = node.parentId ? graph.get(node.parentId) : undefined;
            name = `${GEO_ENTRY_PREFIX}${node.name}·${parent?.name ?? node.id}`;
        }
        if (usedNames.has(name))
            name = `${GEO_ENTRY_PREFIX}${node.path}(${fmtCoord(node.xy[0])},${fmtCoord(node.xy[1])})`;
        usedNames.add(name);
        const altitude = typeof node.altitude === 'number' && node.altitude !== 0 ? `｜高度 ${node.altitude} 里` : '';
        drafts.push({
            name,
            // 内容红线：不出现「位置：/驻地：/…亿里」等会命中 layout-ai LOCATION_CONTENT 的写法
            content: `${node.path} 坐标 (${fmtCoord(node.xy[0])},${fmtCoord(node.xy[1])})${altitude}`,
            keys: keysForNode(node),
            constant: false,
            sticky: 2,
            depth: 2,
        });
    }
    return drafts;
}
/** 草稿 → 酒馆助手条目形状（蓝灯总纲 at_depth 4；绿灯地点 at_depth 2，sticky 2 防止话题延续时断档） */
function draftToEntry(draft, uid) {
    return {
        uid,
        name: draft.name,
        enabled: true,
        strategy: {
            type: draft.constant ? 'constant' : 'selective',
            keys: draft.constant ? [] : [...draft.keys],
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: draft.constant ? 'same_as_global' : 3,
        },
        position: { type: 'at_depth', role: 'system', depth: draft.depth, order: 110 + uid },
        content: draft.content,
        probability: 100,
        // 递归全关：坐标条目不激活别人的设定条目，也不被别人的条目激活
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: draft.sticky > 0 ? draft.sticky : null, cooldown: null, delay: null },
    };
}
function buildWorldbookEntries(graph, options = {}) {
    const drafts = buildCoordDrafts(graph, options);
    return { drafts, entries: drafts.map(draftToEntry) };
}
/** 已有书里的条目（取我们关心的字段）与草稿逐条比对；完全一致才允许跳过写入 */
function entriesDiffer(existing, drafts) {
    if (existing.length !== drafts.length)
        return true;
    const byName = new Map(existing.map(entry => [String(entry.name ?? ''), entry]));
    for (const draft of drafts) {
        const match = byName.get(draft.name);
        if (!match)
            return true;
        if (String(match.content ?? '') !== draft.content)
            return true;
        if (String(match.strategy?.type ?? '') !== (draft.constant ? 'constant' : 'selective'))
            return true;
        if (!draft.constant) {
            const keys = (match.strategy?.keys ?? []).map(key => String(key));
            if (keys.join('\u0001') !== draft.keys.join('\u0001'))
                return true;
        }
    }
    return false;
}
/** 转成 SillyTavern 世界书导入格式（字段形状对照《洛阳扩展》实测样本），供 release 产出手动导入的双件套 */
function toSillyTavernBook(drafts) {
    const entries = {};
    drafts.forEach((draft, index) => {
        entries[String(index)] = {
            uid: index,
            key: draft.constant ? [] : [...draft.keys],
            keysecondary: [],
            comment: draft.name,
            content: draft.content,
            constant: draft.constant,
            vectorized: false,
            selective: !draft.constant,
            selectiveLogic: 0,
            addMemo: true,
            order: 110 + index,
            position: 4,
            disable: false,
            ignoreBudget: false,
            excludeRecursion: true,
            preventRecursion: true,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            delayUntilRecursion: false,
            probability: 100,
            useProbability: true,
            depth: draft.depth,
            outletName: '',
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: draft.constant ? null : 3,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: false,
            automationId: '',
            role: 'system',
            sticky: draft.sticky,
            cooldown: 0,
            delay: 0,
            triggers: [],
            displayIndex: index,
            characterFilter: { isExclude: false, names: [], tags: [] },
        };
    });
    return { entries };
}
/** 能力探测（对齐小手机 V1.2 的 Yi()）：缺哪层就降级到哪层，绝不盲调不存在的接口 */
function detectGeoBookCapabilities() {
    const notes = [];
    const canList = typeof getWorldbookNames === 'function' && typeof getWorldbook === 'function';
    if (!canList)
        notes.push('缺少世界书读取接口');
    const canCreate = typeof createWorldbook === 'function';
    if (!canCreate)
        notes.push('缺少 createWorldbook');
    const canUpdate = typeof replaceWorldbook === 'function' || typeof updateWorldbookWith === 'function';
    if (!canUpdate)
        notes.push('缺少世界书写入接口');
    const canAttach = typeof getCharWorldbookNames === 'function' && typeof rebindCharWorldbooks === 'function';
    if (!canAttach)
        notes.push('缺少角色卡绑定接口 rebindCharWorldbooks');
    return { canList, canCreate, canUpdate, canAttach, notes };
}
/** 写完书后顺手刷新世界书编辑器（前台开着时立刻能看到新条目）；失败静默 */
function reloadWorldbookEditor() {
    try {
        // 只在世界书编辑器**本来就开着**时才原地刷新。无脑调用会把编辑器面板拉到前台
        // 重新加载 —— 撞上写入中的书就渲染成一块盖住整个酒馆的空面板，
        // 而且它不是本插件的窗口，没有关闭按钮，用户只能刷新页面（实测踩坑）。
        const parentDoc = window.parent && window.parent !== window ? window.parent.document : document;
        const editor = parentDoc.querySelector('#WorldInfo');
        if (!editor)
            return;
        const style = window.parent.getComputedStyle(editor);
        if (style.display === 'none' || style.visibility === 'hidden')
            return;
        const context = SillyTavern
            ?.getContext?.();
        context?.reloadWorldInfoEditor?.(WORLDMAP_BOOK, false);
    }
    catch {
        /* 编辑器不在前台等场景，忽略 */
    }
}
/**
 * 把当前底图同步进《世界舆图·坐标表》：
 *   · 书不存在 → createWorldbook 新建；
 *   · 书存在 → 先验证所有权（全部条目都带 [舆图] 前缀才动它），再逐条 diff，内容没变就跳过写入；
 *   · 书里有别人的条目 → 拒绝覆盖并报出条目名。
 */
async function syncCoordBook(graph, options) {
    const caps = detectGeoBookCapabilities();
    if (!caps.canList || !caps.canCreate || !caps.canUpdate) {
        return { status: 'missing-api', entryCount: 0, message: caps.notes.join('；') };
    }
    const { drafts, entries } = buildWorldbookEntries(graph, options);
    let existing = null;
    try {
        existing = (await getWorldbook(WORLDMAP_BOOK));
    }
    catch {
        existing = null;
    }
    if (!existing || !existing.length) {
        const created = await createWorldbook(WORLDMAP_BOOK, entries);
        if (!created) {
            return { status: 'failed', entryCount: 0, message: `创建「${WORLDMAP_BOOK}」失败（同名书可能刚被别人建出，刷新后再试）` };
        }
        reloadWorldbookEditor();
        return { status: 'created', entryCount: entries.length, message: `已创建「${WORLDMAP_BOOK}」（${entries.length} 条）` };
    }
    const foreign = existing.filter(entry => !String(entry.name ?? '').startsWith(GEO_ENTRY_PREFIX));
    if (foreign.length) {
        const names = foreign
            .slice(0, 3)
            .map(entry => String(entry.name ?? ''))
            .join('、');
        return {
            status: 'refused',
            entryCount: existing.length,
            message: `「${WORLDMAP_BOOK}」里有 ${foreign.length} 条非 [舆图] 条目（${names}…），拒绝覆盖。请换名或先手动清理。`,
        };
    }
    if (!entriesDiffer(existing, drafts)) {
        return { status: 'unchanged', entryCount: existing.length, message: `内容未变化，跳过写入（${existing.length} 条）` };
    }
    await replaceWorldbook(WORLDMAP_BOOK, entries);
    reloadWorldbookEditor();
    return { status: 'synced', entryCount: entries.length, message: `已同步 ${entries.length} 条进「${WORLDMAP_BOOK}」` };
}
/** 当前挂载状态（设置页状态徽章的数据源） */
function readCoordMountState() {
    const caps = detectGeoBookCapabilities();
    if (!caps.canAttach) {
        return { mounted: false, isPrimary: false, mountedNames: [], caps };
    }
    try {
        const names = getCharWorldbookNames('current');
        const all = [names.primary, ...(names.additional ?? [])].filter(Boolean);
        return {
            mounted: all.includes(WORLDMAP_BOOK),
            isPrimary: names.primary === WORLDMAP_BOOK,
            mountedNames: all,
            caps,
        };
    }
    catch {
        return { mounted: false, isPrimary: false, mountedNames: [], caps };
    }
}
/**
 * 挂载：追加到角色卡 additional（去重、不碰 primary），写完**读回校验（复读）**，
 * 不一致就抛错 —— 绑定必须确认落地才算成功（对齐小手机的 attach 语义）。
 */
async function attachCoordBook() {
    const current = getCharWorldbookNames('current');
    const primary = current.primary ?? null;
    const additional = [...new Set([...(current.additional ?? []), WORLDMAP_BOOK])].filter(name => name && name !== primary);
    await rebindCharWorldbooks('current', { primary, additional });
    const back = getCharWorldbookNames('current');
    const missing = additional.filter(name => !(back.additional ?? []).includes(name));
    if ((back.primary ?? null) !== primary || missing.length) {
        throw new Error(`挂载复读失败：${missing.join('、') || '主世界书发生变化'}（请到世界书管理器手动核对）`);
    }
}
/** 卸载：从 additional 移除本名；绝不动主世界书。 */
async function detachCoordBook() {
    const current = getCharWorldbookNames('current');
    const primary = current.primary ?? null;
    if (primary === WORLDMAP_BOOK) {
        throw new Error(`「${WORLDMAP_BOOK}」是当前主世界书，不能自动卸载`);
    }
    const additional = (current.additional ?? []).filter(name => name !== WORLDMAP_BOOK);
    await rebindCharWorldbooks('current', { primary, additional });
    const back = getCharWorldbookNames('current');
    const lingering = (back.additional ?? []).filter(name => name === WORLDMAP_BOOK);
    if ((back.primary ?? null) !== primary || lingering.length) {
        throw new Error('卸载复读失败：绑定没有按预期移除');
    }
}
/** 删除坐标书：先尝试解绑（没挂载/缺接口都继续），再删书。两步确认在 UI 层做。 */
async function deleteCoordBook() {
    try {
        await detachCoordBook();
    }
    catch {
        /* 没挂载或缺绑定接口时直接删书 */
    }
    const ok = await deleteWorldbook(WORLDMAP_BOOK);
    if (!ok)
        throw new Error(`删除「${WORLDMAP_BOOK}」失败（书可能不存在）`);
    return `已删除「${WORLDMAP_BOOK}」（绑定已一并解除）`;
}
//# sourceMappingURL=geo-book.js.map
return { selectCoordNodes, keysForNode, buildCoordDrafts, draftToEntry, buildWorldbookEntries, entriesDiffer, toSillyTavernBook, detectGeoBookCapabilities, syncCoordBook, readCoordMountState, attachCoordBook, detachCoordBook, deleteCoordBook };
});
__def("./geo-context.js", () => {
const { tierOf } = __req('./graph.js');
const { distance } = __req('./trail.js');
/** 射线法：点是否在多边形内（shape 顶点是世界坐标，首尾不必闭合） */
function pointInPolygon(point, shape) {
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
function findTerritory(graph, node, xy) {
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
function buildGeoContext(input) {
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
return { pointInPolygon, findTerritory, buildGeoContext };
});
__def("./ui/theme.js", () => {
const STYLE_ID = 'worldmap-style';
const CSS = `
.worldmap-root, .worldmap-root * { box-sizing: border-box; }
.worldmap-root {
  /* ── 设计令牌（深色暖炭壳 × 米黄亚麻强调）───────────────────────── */
  --dym-bg: #16130f;              /* 窗框/标题栏/导航轨/时间轴 */
  --dym-panel: #1f1c17;           /* 抽屉面板 */
  --dym-card: #2a2520;            /* 卡片 */
  --dym-field: #1d1a15;           /* 输入类控件底（比卡片深的"凹陷井"） */
  --dym-hover: rgba(255,255,255,.05);
  --dym-line: rgba(255,255,255,.08);
  --dym-line-strong: rgba(255,255,255,.14);
  --dym-text: #ece7db;
  --dym-muted: #a89f8e;
  --dym-faint: #7d7666;
  --dym-accent: #d9c08c;          /* 亚麻米金 */
  --dym-accent-strong: #ecd9ab;
  --dym-accent-deep: #b99e66;
  --dym-accent-dim: rgba(217,192,140,.13);
  --dym-danger: #e2725f;
  --dym-radius: 12px;
  --dym-font: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC",
    "HarmonyOS Sans SC", "MiSans", system-ui, -apple-system, sans-serif;
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
  min-width: 340px; min-height: 240px;
  font-family: var(--dym-font);
  font-size: 13px; line-height: 1.65;
  color: var(--dym-text);
  background: var(--dym-panel);
  border: 1px solid rgba(222, 200, 156, .38);   /* 浅色描边：在深色酒馆页面上勾出窗缘 */
  border-radius: var(--dym-radius);
  box-shadow: 0 24px 64px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35);
  overflow: hidden;
  transition: width .22s ease, box-shadow .22s ease;
}
.worldmap-root > * { position: relative; z-index: 1; }
.worldmap-root.dym-collapsed { min-height: 0; height: auto !important; }
.worldmap-root.dym-collapsed .dym-body,
.worldmap-root.dym-collapsed .dym-timeline { display: none; }

/* ── 贴边窄条：暖炭底小书签，贴在页面边缘 ─────────────────────────── */
.worldmap-root.dym-rail {
  width: 30px !important; min-width: 30px; min-height: 0;
  border-radius: 10px 0 0 10px;
  border-right: none;
  background: linear-gradient(180deg, #37302a 0%, #2a251f 55%, #221e19 100%);
  border-left: 1px solid rgba(217,192,140,.28);
  box-shadow: -6px 8px 20px rgba(0,0,0,.45);
  transition: width .2s ease;
}
.worldmap-root.dym-rail.dym-rail-left {
  border-radius: 0 10px 10px 0;
  border-right: 1px solid rgba(217,192,140,.28);
  border-left: none;
  box-shadow: 6px 8px 20px rgba(0,0,0,.45);
}
.worldmap-root.dym-rail .dym-body,
.worldmap-root.dym-rail .dym-timeline,
.worldmap-root.dym-rail .dym-resize { display: none !important; }
.worldmap-root.dym-rail .dym-titlebar {
  flex-direction: column; height: 100%; padding: 10px 0; gap: 8px;
  background: transparent; box-shadow: none; cursor: pointer;
}
.worldmap-root.dym-rail .dym-title {
  writing-mode: vertical-rl; font-size: 12px; letter-spacing: .3em; color: var(--dym-accent-strong);
}
.worldmap-root.dym-rail .dym-badge,
.worldmap-root.dym-rail .dym-spacer,
.worldmap-root.dym-rail .dym-actions { display: none; }
.dym-rail-hint { display: none; }
.worldmap-root.dym-rail .dym-rail-hint {
  display: block; writing-mode: vertical-rl; font-size: 9.5px; letter-spacing: .18em;
  color: rgba(236,217,171,.55);
}

/* ── 区域轮廓：界域/地域用虚线多边形围出范围（宣纸上的墨线，保持原画法）── */
.dym-region {
  stroke-dasharray: 6 4.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-width: 1.3;
  stroke: rgba(120, 100, 60, .55);
  fill: rgba(120, 100, 60, .04);
  pointer-events: none;
}
.dym-region-realm {
  stroke: rgba(146, 104, 42, .72);
  fill: rgba(146, 104, 42, .05);
  stroke-width: 1.7;
}
.dym-region-region {
  stroke: rgba(111, 125, 69, .72);
  fill: rgba(111, 125, 69, .045);
  stroke-width: 1.3;
}

/* ── 标题栏：扁平深色，细发丝线分隔 ─────────────────────────────────── */
.dym-titlebar {
  display: flex; align-items: center; gap: 9px; padding: 0 8px 0 14px; height: 44px; flex: 0 0 auto;
  background: var(--dym-bg); color: var(--dym-text); cursor: move; user-select: none;
  border-bottom: 1px solid var(--dym-line);
}
.dym-title {
  font-size: 13.5px; font-weight: 700; letter-spacing: .18em; color: var(--dym-text);
  /* 产品名用衬线：与无衬线 UI 拉开品牌感，呼应宣纸画布 */
  font-family: "Songti SC", "STSong", "SimSun", serif;
}
.dym-logo { display: flex; color: var(--dym-accent); opacity: .95; }
.dym-badge {
  font-size: 11.5px; padding: 2px 10px; border-radius: 999px; max-width: 48%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--dym-accent-dim); border: 1px solid rgba(217,192,140,.26); color: var(--dym-accent-strong);
}
.dym-spacer { flex: 1 1 auto; }
.dym-actions { display: flex; gap: 2px; }
.dym-actions button {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #b6afa0;
  border-radius: 8px; cursor: pointer; line-height: 1; font-family: inherit; padding: 0;
  transition: background .14s ease, color .14s ease;
}
.dym-actions button:hover { background: rgba(255,255,255,.07); color: var(--dym-text); }
.dym-actions button:active { background: rgba(255,255,255,.11); }
.dym-actions button.dym-on { background: var(--dym-accent-dim); color: var(--dym-accent-strong); }
/* 关闭按钮悬停红：主流窗口的惯例 */
.dym-actions button[data-act="close"]:hover { background: #d9483f; color: #fff; }

/* ── 通用按钮：深色升起面 + 亚麻主按钮 ─────────────────────────────── */
.dym-btn {
  border: 1px solid var(--dym-line-strong);
  background: #2e2a24; color: var(--dym-text);
  border-radius: 8px; cursor: pointer; font-size: 12.5px; padding: 5px 12px;
  line-height: 1.55; font-family: inherit;
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, transform .06s ease;
}
.dym-btn:hover { background: #383329; border-color: rgba(255,255,255,.2); }
.dym-btn:active { transform: translateY(.5px); }
.dym-btn:disabled { opacity: .38; cursor: not-allowed; box-shadow: none; background: #282520; }
.dym-btn.dym-primary {
  background: linear-gradient(180deg, #e6d1a2, #d2b678); border-color: #c3a76c; color: #2c2113;
  font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 1px 0 rgba(255,255,255,.18) inset;
}
.dym-btn.dym-primary:hover { background: linear-gradient(180deg, #eeddb4, #dcc287); border-color: #cfae70; }
.dym-btn.dym-danger { color: #ef8d7c; border-color: rgba(226,114,95,.34); background: rgba(226,114,95,.07); }
.dym-btn.dym-danger:hover { background: rgba(226,114,95,.14); border-color: rgba(226,114,95,.55); }
.dym-btn.dym-danger[data-armed="1"] { background: #c05544; border-color: #d4685a; color: #fff; }

.dym-body { display: flex; flex: 1 1 auto; min-height: 0; }
/* 画布区：宣纸底保留在这里（深色外壳中间嵌一张古地图） */
.dym-canvas-wrap {
  position: relative; flex: 1 1 auto; min-width: 120px; overflow: hidden;
  background:
    radial-gradient(135% 105% at 16% -4%, #fdf6e2 0%, #f6ead0 38%, #ecdcb8 68%, #ddc79c 100%);
}
.dym-canvas-wrap::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    repeating-linear-gradient(0deg, rgba(124,96,54,.055) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(124,96,54,.042) 0 1px, transparent 1px 4px),
    radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(120,92,50,.13) 100%);
}
.dym-canvas-wrap > * { position: relative; z-index: 1; }
/* 顶部中间的坐标条：当前选中点的名称 + 坐标（没选中时由脚本隐藏）。
   它浮在宣纸画布上，保持浅色羊皮纸小票风格。 */
.dym-hud {
  position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
  max-width: 72%; padding: 3px 12px; border-radius: 999px; z-index: 3;
  background: rgba(255,252,244,.94);
  border: 1px solid rgba(110,84,46,.32);
  box-shadow: 0 2px 8px rgba(90,66,30,.22);
  font-size: 12.5px; letter-spacing: .02em; color: #3a2c16;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none;
}
.dym-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.dym-svg.dym-panning { cursor: grabbing; }
.dym-svg.dym-editing { cursor: crosshair; }

.dym-breadcrumb {
  position: absolute; left: 9px; top: 9px; display: flex; flex-wrap: wrap; gap: 2px; align-items: center;
  font-size: 12px; background: rgba(255,251,238,.92); border: 1px solid rgba(122,96,58,.3);
  border-radius: 999px; padding: 3px 10px; max-width: calc(100% - 18px);
  box-shadow: 0 1px 5px rgba(90,66,30,.18); color: #4a3c26;
}
.dym-breadcrumb span { cursor: pointer; color: #7a5321; }
.dym-breadcrumb span:hover { color: #a3462a; text-decoration: underline; }
.dym-breadcrumb i { color: #b09772; font-style: normal; margin: 0 1px; }
.dym-breadcrumb b { color: #3a2c17; }

.dym-zoomctl { position: absolute; right: 9px; bottom: 9px; display: flex; flex-direction: column; gap: 5px; }
.dym-zoomctl button {
  width: 28px; height: 28px; border-radius: 9px; cursor: pointer; line-height: 1;
  display: flex; align-items: center; justify-content: center; padding: 0;
  background: rgba(255,251,238,.94); border: 1px solid rgba(122,96,58,.35); color: #4a3418;
  box-shadow: 0 1px 4px rgba(90,66,30,.22);
  transition: background .14s ease;
}
.dym-zoomctl button:hover { background: #fffdf6; }

.dym-legend {
  position: absolute; left: 9px; bottom: 9px; font-size: 11px; color: #5c4a2c;
  background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.26); border-radius: 10px;
  padding: 4px 9px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 46%;
}
.dym-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
.dym-status {
  position: absolute; right: 9px; top: 9px; font-size: 11.5px; color: #5c4a2c;
  background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.26); border-radius: 999px; padding: 3px 10px;
  max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 抽屉（右栏）：导航轨 + 内容面板 ────────────────────────────────── */
/* 用比例而不是固定像素：设置页控件多，固定 250px 会被挤成一团；
   min-width:0 是关键 —— 否则侧栏会被内容的 min-content 宽度顶大。 */
.dym-drawer {
  flex: 0 0 46%; min-width: 0; max-width: 520px;
  display: flex; flex-direction: row; min-height: 0;
  border-left: 1px solid var(--dym-line); background: var(--dym-panel);
}
.worldmap-root.dym-narrow .dym-drawer { flex-basis: 232px; }

/* 收起右栏：画布占满，把手留在右沿 */
.worldmap-root.dym-drawer-off .dym-drawer { display: none; }
.dym-drawer-toggle {
  flex: 0 0 15px; width: 15px; padding: 0; cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  color: #857e6f; border: none; background: var(--dym-bg);
  border-left: 1px solid var(--dym-line);
  transition: color .14s ease, background .14s ease;
}
.dym-drawer-toggle:hover { color: var(--dym-accent-strong); background: #24211c; }
.worldmap-root.dym-drawer-off .dym-drawer-toggle { border-left-color: var(--dym-line-strong); }
.worldmap-root.dym-rail .dym-drawer-toggle { display: none; }

/* 导航轨：QQ/ZCode 设置页那种左侧竖排导航（图标 + 小字） */
.dym-tabs {
  display: flex; flex-direction: column; gap: 3px; padding: 8px 6px; flex: 0 0 52px;
  background: var(--dym-bg); border-right: 1px solid var(--dym-line);
}
.dym-tabs button {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 7px 0 5px; cursor: pointer; font-family: inherit;
  background: transparent; border: none; border-radius: 9px; color: #998f7c;
  font-size: 10.5px; letter-spacing: .02em; line-height: 1;
  transition: background .14s ease, color .14s ease;
}
.dym-tabs button:hover { color: var(--dym-text); background: var(--dym-hover); }
.dym-tabs button.dym-active {
  color: var(--dym-accent-strong); background: var(--dym-accent-dim); font-weight: 600;
}
/* 窄窗：导航轨只留图标，省出内容宽度 */
.worldmap-root.dym-narrow .dym-tabs { flex-basis: 44px; padding: 8px 4px; }
.worldmap-root.dym-narrow .dym-tabs button span { display: none; }
.worldmap-root.dym-narrow .dym-tabs button { padding: 9px 0; }
.dym-panes { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 12px; font-size: 13px; color: var(--dym-text); }
.dym-panes::-webkit-scrollbar { width: 10px; }
.dym-panes::-webkit-scrollbar-thumb { background: rgba(255,255,255,.13); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }
.dym-panes::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); border: 3px solid transparent; background-clip: padding-box; }
.dym-panes::-webkit-scrollbar-track { background: transparent; }
.dym-pane { display: none; }
.dym-pane.dym-active { display: block; }

/* ── 表单 ──────────────────────────────────────────────────────────── */
.dym-field { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.dym-field label { flex: 0 0 62px; color: var(--dym-muted); font-size: 12.5px; }
.dym-field input[type=text], .dym-field input[type=number], .dym-field input[type=password], .dym-field select, .dym-field textarea {
  flex: 1 1 auto; min-width: 0; font-family: inherit; font-size: 12.5px; padding: 5px 9px;
  border: 1px solid var(--dym-line-strong); border-radius: 8px; background: var(--dym-field); color: var(--dym-text);
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.dym-field input::placeholder, .dym-field textarea::placeholder { color: var(--dym-faint); }
.dym-field select { cursor: pointer; }
.dym-field select option { background: #1d1a15; color: var(--dym-text); }
.dym-field input:hover, .dym-field select:hover { border-color: rgba(255,255,255,.22); }
.dym-field input:focus, .dym-field select:focus, .dym-field textarea:focus {
  outline: none; border-color: var(--dym-accent-deep); box-shadow: 0 0 0 3px rgba(217,192,140,.16);
}
.dym-field textarea { font-family: inherit; line-height: 1.6; resize: vertical; }
/* 纵排字段：标签在上、控件通栏（长标签/大文本框用） */
.dym-field.dym-col { flex-direction: column; align-items: stretch; gap: 5px; }
.dym-field.dym-col label { flex: none; width: auto; }
.dym-row { display: flex; gap: 6px; margin-bottom: 9px; flex-wrap: wrap; }
.dym-hint {
  font-size: 11.8px; color: var(--dym-muted); line-height: 1.7; margin: 7px 0 10px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.045);
  border-radius: 10px; padding: 8px 11px;
}
.dym-hint b { color: var(--dym-text); font-weight: 600; }
.dym-hint code {
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11px;
  background: rgba(255,255,255,.07); border-radius: 4px; padding: 1px 5px; color: var(--dym-accent-strong);
}
.dym-sect { font-size: 11.5px; color: var(--dym-faint); letter-spacing: .08em; margin: 14px 0 6px; }
/* AI 功能标记：用了模型的小金标 */
.dym-ai {
  display: inline-flex; align-items: center; margin-left: 7px; padding: 0 5px;
  border-radius: 5px; font-size: 9.5px; font-weight: 700; letter-spacing: .08em; line-height: 16px;
  color: #2c2113; background: linear-gradient(180deg, #e6d1a2, #d2b678);
}
.dym-sec > summary .dym-ai { margin-left: 8px; }

/* 设置页：分块折叠，一叠深色卡片 */
.dym-sec {
  border: 1px solid var(--dym-line); border-radius: var(--dym-radius); margin: 0 0 10px;
  background: var(--dym-card);
  overflow: hidden;
}
.dym-sec > summary {
  cursor: pointer; padding: 11px 13px; font-size: 13px; font-weight: 600; color: var(--dym-text);
  list-style: none; display: flex; align-items: center; gap: 8px; letter-spacing: .01em;
  transition: background .14s ease;
}
.dym-sec > summary::-webkit-details-marker { display: none; }
.dym-sec > summary::before {
  content: ''; width: 5px; height: 5px; flex: 0 0 auto; border-radius: 1px;
  border-right: 1.6px solid #8d8574; border-bottom: 1.6px solid #8d8574;
  transform: rotate(-45deg); transition: transform .16s ease; margin-top: -2px;
}
.dym-sec[open] > summary::before { transform: rotate(45deg); margin-top: 2px; }
.dym-sec > summary:hover { background: rgba(255,255,255,.028); }
.dym-sec[open] > summary { border-bottom: 1px solid var(--dym-line); }
.dym-sec > *:not(summary) { margin-left: 13px; margin-right: 13px; }
.dym-sec > *:not(summary):first-of-type { margin-top: 12px; }
.dym-sec > *:not(summary):last-child { margin-bottom: 12px; }
.dym-sec .dym-field label { flex: 0 0 66px; }
.dym-sec .dym-field.dym-col label { flex: none; width: auto; }
.dym-pw { position: relative; flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
.dym-pw input { flex: 1 1 auto; min-width: 0; }
.dym-pw button {
  flex: 0 0 auto; margin-left: 6px; width: 30px; height: 29px; padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--dym-line-strong); border-radius: 8px; background: var(--dym-field); color: #9d9585;
  transition: color .14s ease, border-color .14s ease;
}
.dym-pw button:hover { color: var(--dym-accent-strong); border-color: rgba(255,255,255,.22); }
.dym-field .dym-tip { flex: 0 0 auto; font-size: 11px; color: var(--dym-faint); cursor: help; border-bottom: 1px dotted rgba(255,255,255,.3); }
.dym-report {
  margin: 8px 0 0; padding: 9px 11px; border-radius: 10px; max-height: 168px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: #181510; border: 1px solid var(--dym-line); color: #d5cec0; white-space: pre-wrap;
}
.dym-report:empty { display: none; }
/* 轻操作的就地结果条：贴在触发按钮下面，不滚动页面、不抢视线 */
.dym-api-result {
  margin: 2px 0 8px; padding: 7px 10px; border-radius: 10px; max-height: 150px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: var(--dym-field); border: 1px solid var(--dym-line); color: #d5cec0; white-space: pre-wrap;
}
.dym-api-result:empty { display: none; }
/* 分组卡片：设置页折叠块之外，普通控件分组也用它（编辑页等） */
.dym-card {
  background: var(--dym-card); border: 1px solid var(--dym-line); border-radius: var(--dym-radius);
  padding: 11px 13px; margin-bottom: 10px;
}
.dym-card .dym-sect { margin: 0 0 8px; }
.dym-list {
  list-style: none; margin: 0 0 10px; padding: 5px;
  background: var(--dym-card); border: 1px solid var(--dym-line); border-radius: var(--dym-radius);
}
.dym-list li {
  padding: 6px 9px; border-radius: 8px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; font-size: 13px;
  transition: background .13s ease;
}
.dym-list li:hover { background: var(--dym-hover); }
.dym-list li.dym-selected { background: var(--dym-accent-dim); }
.dym-list .dym-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; transform: translateY(-1px); box-shadow: 0 0 0 1px rgba(255,255,255,.12); }
.dym-list .dym-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dym-list .dym-tag { font-size: 11px; color: var(--dym-faint); flex: 0 0 auto; }
.dym-list .dym-unplaced { color: var(--dym-accent); font-style: italic; }
.dym-list .dym-orphan { color: #a9b56d; }

/* ── 开关：iOS / 微信那种滑块 ────────────────────────────────────────
   胶囊画在 .dym-track（span）上、原生 checkbox 只当状态机隐藏掉：
   有些酒馆主题会给 input[type=checkbox] 配自己的开关样式，直接画在
   input 上会和宿主的叠出一个「黑影」，所以外观必须长在宿主碰不到的元素上。 */
.dym-switches {
  display: flex; flex-direction: column; margin-bottom: 10px;
  border: 1px solid var(--dym-line); border-radius: var(--dym-radius); background: var(--dym-card); overflow: hidden;
}
.dym-switches label {
  display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  gap: 12px; padding: 9px 13px; font-size: 12.8px; color: var(--dym-text); cursor: pointer;
  border-top: 1px solid var(--dym-line); line-height: 1.55;
  transition: background .13s ease;
}
.dym-switches label:first-child { border-top: none; }
.dym-switches label:hover { background: rgba(255,255,255,.022); }
.dym-switches b { font-weight: 600; }
.dym-switches input[type=checkbox] {
  position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;
}
.dym-switches .dym-track {
  position: relative; flex: 0 0 auto; width: 40px; height: 23px; border-radius: 12px;
  background: #45403a; transition: background .2s ease;
}
.dym-switches .dym-track::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 19px; height: 19px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4);
  transition: transform .2s cubic-bezier(.2,.8,.3,1);
}
.dym-switches label:hover .dym-track::after { box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.dym-switches input:checked ~ .dym-track { background: var(--dym-accent); }
.dym-switches input:checked ~ .dym-track::after { transform: translateX(17px); }
.dym-switches input:focus-visible ~ .dym-track { outline: 2px solid rgba(217,192,140,.4); outline-offset: 2px; }
/* 已经躺在卡片里时不要再套一层盒子，用发丝线分隔即可 */
.dym-sec .dym-switches { border: none; border-radius: 0; background: transparent; }
.dym-sec .dym-switches label { padding-left: 0; padding-right: 0; }

/* 导出/导入用的文本框：让用户能直接复制去发给 AI，也能把改好的粘回来 */
.dym-io {
  width: 100%; min-height: 132px; resize: vertical; margin: 2px 0 6px;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.55;
  padding: 8px 10px; border: 1px solid var(--dym-line-strong); border-radius: 10px;
  background: #181510; color: #d5cec0; white-space: pre; overflow: auto;
}
.dym-io:focus { outline: none; border-color: var(--dym-accent-deep); box-shadow: 0 0 0 3px rgba(217,192,140,.16); }

/* 状态小药丸（坐标世界书挂载状态、列表右侧的分类标注） */
.dym-tag {
  display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; padding: 2px 9px; border-radius: 999px;
  background: rgba(255,255,255,.07); border: none; color: #bdb4a2;
}

.dym-timeline {
  flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 7px 12px;
  border-top: 1px solid var(--dym-line); background: var(--dym-bg);
  font-size: 12px; color: var(--dym-muted);
}
.dym-timeline input[type=range] { flex: 1 1 auto; accent-color: var(--dym-accent); }
.dym-timeline .dym-time { flex: 0 0 auto; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dym-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; z-index: 3; }
.dym-resize::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px;
  border-right: 2px solid rgba(217,192,140,.4); border-bottom: 2px solid rgba(217,192,140,.4);
  border-radius: 1px;
}

/* ── SVG 图层（宣纸画布上的墨与朱，保持原画法）────────────────────── */
/* 连线：颜色不透明，透明度由元素上的 stroke-opacity 按层级给（越深越淡） */
.dym-link { stroke: #7a623e; fill: none; stroke-linecap: round; }
.dym-trail-glow { fill: none; stroke: rgba(196,110,70,.22); stroke-linejoin: round; stroke-linecap: round; }
.dym-trail { fill: none; stroke: #a83a1a; stroke-linejoin: round; stroke-linecap: round; }
/* 地名标签：只垫一层细描边（高德式）。注意 stroke-width 不写在 CSS 里 ——
   文字在缩放坐标系里，CSS 的 2px 会被放大成几十像素的「气泡」；
   由 canvas 按缩放倒数逐元素设置，保证永远约等于屏幕 2px。 */
.dym-label {
  paint-order: stroke; stroke: rgba(252,246,230,.85);
  fill: #33291a; pointer-events: none;
}
.dym-label-major { fill: #241c10; letter-spacing: .04em; }
.dym-node { cursor: pointer; }
.dym-node text {
  paint-order: stroke; stroke: rgba(252,246,230,.85);
  pointer-events: none; font-family: var(--dym-font); fill: #33291a;
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
/** 界面小图标（Lucide，24×24 视口）。与地点图标分开，方便按语义取用。 */
const UI = {
    layers: {
        paths: [
            'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
            'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
            'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
        ],
    },
    pin: {
        paths: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'],
        circles: [[12, 10, 3]],
    },
    pencil: {
        paths: [
            'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
            'm15 5 4 4',
        ],
    },
    route: {
        paths: ['M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15'],
        circles: [[6, 19, 3], [18, 5, 3]],
    },
    sliders: {
        paths: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
    },
    panelRight: {
        paths: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M15 3v18'],
    },
    locate: {
        paths: ['M2 12h3', 'M19 12h3', 'M12 2v3', 'M12 19v3'],
        circles: [[12, 12, 6]],
    },
    fit: { paths: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'] },
    close: { paths: ['M18 6 6 18', 'm6 6 12 12'] },
    chevLeft: { paths: ['m15 18-6-6 6-6'] },
    chevRight: { paths: ['m9 18 6-6-6-6'] },
    plus: { paths: ['M5 12h14', 'M12 5v14'] },
    minus: { paths: ['M5 12h14'] },
    eye: {
        paths: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'],
        circles: [[12, 12, 3]],
    },
};
/** 把 Lucide 路径数据渲染成内联 SVG 字符串（stroke 用 currentColor） */
function svgIcon(icon, size = 16, strokeWidth = 2) {
    const paths = icon.paths.map(d => `<path d="${d}"/>`).join('');
    const circles = (icon.circles ?? []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
    return (`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
        ` stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        paths +
        circles +
        `</svg>`);
}
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
return { STYLE_ID, CSS, ICONS, UI, svgIcon, COMPASS, KIND_COLORS, KIND_LABELS, ensureStyle, escapeHtml };
});
__def("./ui/canvas.js", () => {
const { ALTITUDE_OFFSET_PX, COLLAPSE_PX, COORD_MAX, COORD_MIN, TIER_FONT_PX, TIER_HIDE_ABOVE_SCALE, TIER_LABEL_SCALE, TIER_RADIUS_PX, TIER_VISIBLE_SCALE, tierOfKind } = __req('./types.js');
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
    /** 编辑模式下的框选集合（多选的节点 id）；Shift+拖空白框选，抓住其中一点整组移动 */
    multi = new Set();
    /** 框选模式开关：开着时空白处拖动一律是框选（不用按 Shift） */
    boxSelectMode = false;
    /** 框选橡皮筋矩形（svg 本地屏幕坐标） */
    rubber = null;
    /** 框选模式开关 */
    setBoxSelect(value) {
        this.boxSelectMode = value;
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
            // 框选多选的高亮环（加粗亮金圈，一眼能看清选了谁）
            if (this.multi.has(node.id)) {
                group.appendChild(el('circle', {
                    cx: pos[0],
                    cy: pos[1],
                    r: radius * 2,
                    fill: 'rgba(236,217,171,.14)',
                    stroke: '#ecd9ab',
                    'stroke-width': 2.2 / Math.max(0.3, this.scale),
                    'stroke-dasharray': `${5 / Math.max(0.3, this.scale)} ${3 / Math.max(0.3, this.scale)}`,
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
            const picked = new Set();
            for (const node of this.drawn) {
                const pos = this.worldPos(node);
                if (pos[0] >= wx0 && pos[0] <= wx1 && pos[1] >= wy0 && pos[1] <= wy1)
                    picked.add(node.id);
            }
            this.multi = picked;
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
            const shift = event.shiftKey;
            const node = this.hitTest(event.clientX, event.clientY);
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
                    this.svg.classList.add('dym-panning');
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
                    // 抓住多选中的点 → 整组拖动
                    const origins = new Map();
                    for (const id of this.multi) {
                        const picked = this.view.graph.get(id);
                        if (picked)
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
                    this.svg.classList.add('dym-panning');
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
                    this.svg.classList.add('dym-panning');
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
            this.svg.classList.remove('dym-panning');
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
        const tier = node.tier ? `${tierOf(node)}（手动）` : String(tierOf(node));
        return `层级 ${tier}｜${KIND_LABELS[node.kind] ?? '地点'}｜(${node.xy[0].toFixed(1)}, ${node.xy[1].toFixed(1)})${altitude}${status}`;
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
const { COMPASS, KIND_COLORS, KIND_LABELS, UI, escapeHtml, ensureStyle, svgIcon } = __req('./ui/theme.js');
const TABS = [
    { key: 'layers', label: '图层', icon: UI.layers },
    { key: 'places', label: '地点', icon: UI.pin },
    { key: 'edit', label: '编辑', icon: UI.pencil },
    { key: 'trail', label: '轨迹', icon: UI.route },
    { key: 'settings', label: '设置', icon: UI.sliders },
];
/** 轻提示：走宿主的 toastr（酒馆页面右上角），没有就落控制台 */
function toast(kind, message) {
    try {
        const host = window.parent && window.parent !== window ? window.parent : window;
        const fn = host.toastr?.[kind];
        if (typeof fn === 'function')
            fn(message, '世界舆图');
        else
            window.console.log('[世界舆图]', kind, message);
    }
    catch {
        window.console.log('[世界舆图]', message);
    }
}
class MapWindow {
    doc;
    actions;
    canvasWrap;
    root;
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
        this.build();
        this.applyLayout(data.layout);
        this.bindChrome();
    }
    build() {
        const doc = this.doc;
        // 标题栏
        const bar = doc.createElement('div');
        bar.className = 'dym-titlebar';
        bar.innerHTML = `<span class="dym-logo">${svgIcon(COMPASS, 15, 1.8)}</span><span class="dym-title">世界舆图</span><span class="dym-badge" data-role="badge">—</span>
      <span class="dym-rail-hint">点开</span>
      <span class="dym-spacer"></span>
      <div class="dym-actions">
        <button data-act="drawer" title="收起 / 展开右侧栏">${svgIcon(UI.panelRight, 15)}</button>
        <button data-act="locate" title="定位到当前地点">${svgIcon(UI.locate, 15)}</button>
        <button data-act="fit" title="全图">${svgIcon(UI.fit, 14)}</button>
        <button data-act="close" title="关闭（点脚本按钮可重新打开）">${svgIcon(UI.close, 15)}</button>
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
        zoomCtl.innerHTML = `<button data-act="zoom-in" title="放大">${svgIcon(UI.plus, 14)}</button><button data-act="zoom-out" title="缩小">${svgIcon(UI.minus, 14)}</button>`;
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
        this.drawerHandle.innerHTML = svgIcon(UI.chevRight, 12);
        this.drawerHandle.addEventListener('click', () => this.toggleDrawer());
        const tabs = doc.createElement('div');
        tabs.className = 'dym-tabs';
        const panes = doc.createElement('div');
        panes.className = 'dym-panes';
        for (const tab of TABS) {
            const button = doc.createElement('button');
            button.innerHTML = `${svgIcon(tab.icon, 17)}<span>${tab.label}</span>`;
            button.title = tab.label;
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
        <label><input type="checkbox" data-layer="showTrail"><span>显示轨迹</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="trailCityOnly"><span>轨迹只连到市级（去掉城内蜘蛛网）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showLinks"><span>显示层级连线</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showRegions"><span>显示区域轮廓（州/域用虚线围范围）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showUnplaced"><span>显示待定位节点</span><span class="dym-track" aria-hidden="true"></span></label>
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
      <div class="dym-switches">
        <label><input type="checkbox" data-role="edit-mode"><span>编辑模式（拖动节点改位置）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-role="box-select"><span>框选模式（空白处拖动框选多点，Shift 点单点加减）</span><span class="dym-track" aria-hidden="true"></span></label>
      </div>
      <div class="dym-row">
        <button class="dym-btn" data-act="undo">撤销</button>
        <button class="dym-btn" data-act="redo">重做</button>
      </div>
      <div class="dym-card">
        <div class="dym-sect">选中节点</div>
        <div class="dym-hint" data-role="selected-info">未选中节点。</div>
        <div class="dym-field"><label>名称</label><input type="text" data-role="node-name"></div>
        <div class="dym-field"><label>X</label><input type="number" step="0.1" data-role="node-x"></div>
        <div class="dym-field"><label>Y</label><input type="number" step="0.1" data-role="node-y"></div>
        <div class="dym-field"><label>显示层级</label>
          <select data-role="node-tier">
            <option value="">自动（按类型推导）</option>
            <option value="1">1 · 界域 / 大域</option>
            <option value="2">2 · 地域 / 地貌</option>
            <option value="3">3 · 城池 / 宗级势力</option>
            <option value="4">4 · 具体地点</option>
            <option value="5">5 · 房间</option>
          </select>
        </div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="apply-xy">应用坐标</button></div>
      </div>
      <div class="dym-card">
        <div class="dym-sect">新增地点</div>
        <div class="dym-field"><label>名称</label><input type="text" data-role="child-name" placeholder="新子地点名称"></div>
        <div class="dym-row">
          <button class="dym-btn" data-act="add-child">加子节点</button>
          <button class="dym-btn" data-act="add-sibling">加同级</button>
          <button class="dym-btn" data-act="add-free">在视图中心新增</button>
        </div>
      </div>
      <div class="dym-row">
        <button class="dym-btn" data-act="toggle-lock">锁定 / 解锁</button>
        <button class="dym-btn dym-danger" data-act="delete-node">删除节点</button>
      </div>
      <div class="dym-hint">
        增点：<b>开启编辑模式后，在画布空白处右键或双击</b>即可在那里新增一个地点（会挂在当前下钻的节点下）。<br>
        批量：<b>Shift + 拖空白处框选</b>多个点（Shift 点单点可加减），抓住其中一点拖动整组移动。<br>
        删点：选中后点上面的「删除节点」，或按 <b>Delete</b> 键（子节点会一起删）。<br>
        锁定后的节点不会被地图布局 AI 覆盖；人工拖动会自动标记为「人工」。
      </div>`;
        edit.querySelector('[data-role=edit-mode]')?.addEventListener('change', event => {
            this.actions.onSetEditMode(event.target.checked);
        });
        edit.querySelector('[data-role=box-select]')?.addEventListener('change', event => {
            this.data.canvas.setBoxSelect(event.target.checked);
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
        edit.querySelector('[data-role=node-tier]')?.addEventListener('change', event => {
            if (!this.data.selectedId)
                return;
            const raw = event.target.value;
            this.actions.onSetNodeTier(this.data.selectedId, raw === '' ? null : Number(raw));
        });
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
            // 真按「当前画面中心」的世界坐标落点 —— 之前落在父节点旁边，用户根本找不到新生成的点
            const size = this.data.canvas.size();
            const center = this.data.canvas.screenToWorld(size.w / 2, size.h / 2);
            this.actions.onAddChild(this.data.focusId ?? this.data.selectedId, name, [
                Math.round(center[0] * 100) / 100,
                Math.round(center[1] * 100) / 100,
            ]);
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
        <button class="dym-btn" data-act="rebuild" title="清空当前轨迹层（含拖过的位置、隐藏列表）并按聊天记录全量重建；配合「AI 整理」可清除历史污点">从聊天记录重算</button>
        <button class="dym-btn" data-act="clear-hidden" title="取消隐藏所有轨迹点">恢复全部显示</button>
      </div>
      <div class="dym-row">
        <button class="dym-btn dym-primary" data-act="ai-fix-history">AI 整理本会话地点<span class="dym-ai">AI</span></button>
      </div>
      <div class="dym-api-result" data-role="trail-result"></div>
      <div class="dym-hint">聊天中途才装插件、或 AI 写的地点串太脏（混描述/时刻/拼层级）？点它把本会话出现过的
        原始地点串发给模型规范化成干净路径，玩出来的非设定地点顺带按方位给相对坐标。
        从头开始玩的新档不需要；整理结果存在本会话的轨迹数据里，重算时自动套用。<br>
        清污两步：<b>先「从聊天记录重算」（全量重建，会清掉拖过的轨迹点位置）→ 再「AI 整理」</b>。</div>
      <div class="dym-hint" data-role="trail-hint"></div>
      <ul class="dym-list" data-role="trail-list"></ul>`;
        trail.querySelector('[data-act=rebuild]')?.addEventListener('click', () => this.actions.onRebuildTrail());
        trail.querySelector('[data-act=clear-hidden]')?.addEventListener('click', () => this.actions.onClearHiddenPoints());
        trail.querySelector('[data-act=ai-fix-history]')?.addEventListener('click', () => this.actions.onAiFixHistory());
        // ── 设置 ──
        const settings = this.panes.get('settings');
        settings.innerHTML = `
      <details class="dym-sec"><summary>地图布局 AI（接口与模型）</summary>
        <div class="dym-hint">读世界书的地点条目、一次性给出坐标。与正文用的模型分开配置，默认沿用 MVU 的本地端点。</div>
        <div class="dym-field"><label>接口</label><input type="text" data-set="url" placeholder="http://localhost:1234/v1"></div>
        <div class="dym-field"><label>密钥</label>
          <span class="dym-pw">
            <input type="password" data-set="key" placeholder="留空表示接口不需要密钥" autocomplete="off">
            <button type="button" data-act="toggle-key" title="显示 / 隐藏密钥">${svgIcon(UI.eye, 14)}</button>
          </span>
        </div>
        <div class="dym-field"><label>模型</label>
          <select data-role="model-select"><option value="">（先点下面的「获取模型列表」）</option></select>
        </div>
        <div class="dym-field"><label>自定义</label><input type="text" data-set="model" placeholder="也可以直接手填模型名"></div>
        <div class="dym-row"><button class="dym-btn" data-act="fetch-models">获取模型列表</button>
          <button class="dym-btn" data-act="test-api">测试连接</button></div>
        <div class="dym-api-result" data-role="api-result"></div>
        <div class="dym-field"><label>上限</label><input type="number" data-set="maxTokens" step="1024"></div>
        <div class="dym-hint">上限 = <b>一次最多让模型写多少 token</b>（只是输出长度，不影响读进去的世界书）。
          生成底图正常十来条资料，<b>16384 够用</b>；要是哪天一次喂 100 多条（比如从控制台跑 <code>__worldMap.runLayout('all')</code>），
          就调到 <b>32768~65535</b>。<b>填太小会看到「模型返回为空」或 JSON 解析失败</b>——那就是被截断了，不是模型不行。
          有些服务端上限就是 65535，填更大反而会被拒。</div>
        <div class="dym-field"><label>温度</label><input type="number" data-set="temperature" step="0.1"></div>
        <div class="dym-hint">温度 = 随机性。<b>0.2~0.4</b> 最稳；调高会让它"发挥"，坐标就开始乱编。</div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="save-settings">保存设置</button></div>
      </details>

      <details class="dym-sec"><summary>生成底图（按世界书铺点）<span class="dym-ai">AI</span></summary>
        <div class="dym-hint">
          读世界书里的<b>地点类条目</b>（《玄天界介绍》《地点：X》这类总纲），一次性给出大域、主要势力、
          主要城池的坐标；已经人工拖过的点会跳过，不会覆盖。<br>
          定位顺序：<b>方位补充表（主）→ 坐标骨架 → 世界书条目（校验与补漏）</b>；
          条目与补充表冲突时以补充表为准，冲突会写进节点的备注。<br>
          想要更细的城内地点，在地图上双击下钻后<b>手动加</b>更稳（AI 细化很容易编出无意义的小点）。
        </div>
        <div class="dym-field dym-col"><label>方位补充表（先按它落点；格式：地名-方位-距离(亿里)，可写相对线索）</label>
          <textarea data-set="layoutSupplement" rows="9" placeholder="留空 = 不用补充表，纯按世界书条目定位"></textarea>
        </div>
        <div class="dym-hint">改完记得点「保存设置」再生成。示例见 <code>docs/底图补充.txt</code>；
          相对线索的写法：<code>距某地N</code>、<code>向某方向N到某地</code>、<code>正上/正下方</code>、<code>宽N</code>。</div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="layout-world">生成底图<span class="dym-ai">AI</span></button></div>
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

      <details class="dym-sec"><summary>坐标世界书与地理态势</summary>
        <div class="dym-hint">
          把底图同步成插件<b>自建</b>的世界书《世界舆图·坐标表》并挂到角色卡：<b>原世界书一个字不动</b>。
          正文提到某地才注入该地坐标（绿灯，不提不花 token）；每回合另注入一段「当前位置 + 周边 + 地界规则」。
          同步是<b>单向</b>的（底图 → 世界书）：在世界书里手改的坐标会被下次同步覆盖。
        </div>
        <div class="dym-row"><span class="dym-tag" data-role="geo-mount">…</span></div>
        <div class="dym-row">
          <button class="dym-btn dym-primary" data-act="geo-mount">生成并挂载坐标世界书</button>
          <button class="dym-btn" data-act="geo-sync">立即同步</button>
        </div>
        <div class="dym-api-result" data-role="geo-result"></div>
        <div class="dym-hint">「立即同步」= 按当前底图与设置**整体重写**《世界舆图·坐标表》：
          蓝灯的总纲/移动规则/叙事规则 3 条 + 当前已确认的地点条目（待定位的虚线圈本来就不进书）。
          切换会话后条目数量变化，多半是新会话的轨迹产生了新地点 —— 想清掉旧档地名就点下面的清理按钮。</div>
        <div class="dym-row">
          <button class="dym-btn" data-act="geo-remount">修复挂载（重新挂）</button>
          <button class="dym-btn" data-act="geo-unmount">卸载（解除绑定）</button>
          <button class="dym-btn dym-danger" data-act="geo-delete">删除坐标世界书</button>
        </div>
        <div class="dym-hint">「修复挂载」不碰书内容，只把角色卡上的绑定重写一遍并读回校验——
          状态显示「未挂载」或正文读不到坐标条目时点它（挂载接口报错、被别的脚本改了绑定都靠它恢复）。</div>
        <div class="dym-hint">挂载对齐成熟 DLC 的做法：追加为角色卡<b>附加世界书</b>（不碰主书），写完读回校验；
          卸载只解绑不删书。「删除」才是连书一起删（两步确认）。</div>
        <div class="dym-switches">
          <label><input type="checkbox" data-gset="coordEnabled"><span>底图变更后自动同步进世界书</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="coordTier4"><span>收录城内要点（tier 4：某宫某阁这类）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoEnabled"><span>每回合注入「地理态势」（关闭 = 只靠世界书条目）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoBounds"><span>注入地界规则（非本地势力需有理由才能生事）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoJump"><span>位移超限时附「远行提示」</span><span class="dym-track" aria-hidden="true"></span></label>
        </div>
        <div class="dym-hint">坐标书里只有「设定里的地方」和确认过的城内要点；轨迹自动产生的待定位虚线圈本来就不进书。</div>
        <div class="dym-row">
          <button class="dym-btn" data-act="geo-preview">预览本回合态势（写入下方文本框）</button>
        </div>
        <div class="dym-field dym-col"><label>人物移动规则（蓝灯条目，随坐标书常驻注入）</label>
          <textarea data-gset-text="movementRules" rows="7" placeholder="各境界日行速度与移动方式…（保存后会作为 [舆图]人物移动规则 写进坐标书）"></textarea>
        </div>
        <div class="dym-switches"><label><input type="checkbox" data-gset="coordMovementOn"><span>把人物移动规则写进坐标书</span><span class="dym-track" aria-hidden="true"></span></label></div>
        <div class="dym-field dym-col"><label>叙事地理规则（蓝灯条目：坐标权威 + 远方事件隔离）</label>
          <textarea data-gset-text="narrativeRules" rows="7" placeholder="远方事件不串场、坐标数据优先于世界书条目方位…（保存后会作为 [舆图]叙事地理规则 写进坐标书）"></textarea>
        </div>
        <div class="dym-switches"><label><input type="checkbox" data-gset="coordNarrativeOn"><span>把叙事地理规则写进坐标书</span><span class="dym-track" aria-hidden="true"></span></label></div>
        <div class="dym-hint">两段文本都<b>已预填默认内容</b>，直接在框里改即可（失焦即保存，改完点「立即同步」写进书）。
          距离换算以总纲为准（1 坐标格 ≈ 15 亿里）；它们放蓝灯是为了「写剧情时一定在场」，
          且生效范围恰好等于坐标书本身：卸载坐标书，规则随之消失，不会变成死条目。</div>
        <div class="dym-hint" data-role="geo-hint"></div>
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
        // ── 坐标世界书与地理态势 ──
        settings.querySelector('[data-act=geo-mount]')?.addEventListener('click', () => this.actions.onMountCoordBook());
        settings.querySelector('[data-act=geo-sync]')?.addEventListener('click', () => this.actions.onSyncCoordBook());
        settings.querySelector('[data-act=geo-remount]')?.addEventListener('click', () => this.actions.onRemountCoordBook());
        settings.querySelector('[data-act=geo-unmount]')?.addEventListener('click', () => this.actions.onUnmountCoordBook());
        // 删书是破坏性动作：两步确认（隐藏 iframe 里弹不了 confirm）
        const geoDelete = settings.querySelector('[data-act=geo-delete]');
        geoDelete.addEventListener('click', () => {
            if (geoDelete.dataset.armed === '1') {
                geoDelete.dataset.armed = '';
                geoDelete.textContent = '删除坐标世界书';
                this.actions.onDeleteCoordBook();
                return;
            }
            geoDelete.dataset.armed = '1';
            geoDelete.textContent = '再点一次确认删除（解绑 + 删书）';
            setTimeout(() => {
                if (geoDelete.dataset.armed === '1') {
                    geoDelete.dataset.armed = '';
                    geoDelete.textContent = '删除坐标世界书';
                }
            }, 4000);
        });
        settings.querySelector('[data-act=geo-preview]')?.addEventListener('click', () => {
            const text = this.actions.onGeoPreview();
            this.setIo(text, '这是「地理态势」注入的原文（每回合按当前坐标现算，只在下一轮生成时进入模型上下文）。');
        });
        settings.querySelectorAll('[data-gset]').forEach(input => {
            input.addEventListener('change', () => this.collectGeoSettings());
        });
        // 规则文本框：失焦即保存（读当前 coordBook 全量、只覆盖对应字段，两个框互不覆盖）
        const movementInput = settings.querySelector('[data-gset-text=movementRules]');
        movementInput.addEventListener('change', () => {
            this.saveCoordBookField('movementRules', movementInput.value, '移动规则已保存。下次同步（挂载后自动 / 点「立即同步」）会写进坐标书蓝灯条目。');
        });
        const narrativeInput = settings.querySelector('[data-gset-text=narrativeRules]');
        narrativeInput.addEventListener('change', () => {
            this.saveCoordBookField('narrativeRules', narrativeInput.value, '叙事规则已保存。下次同步（挂载后自动 / 点「立即同步」）会写进坐标书蓝灯条目。');
        });
        this.fillSettings();
        this.fillGeoSettings();
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
    /** 轻操作（获取模型/测试连接）的就地结果：写在按钮下面的小结果条里，不滚动、不跳页签 */
    showApiResult(text, role = 'api-result') {
        const box = this.ioPane().querySelector(`[data-role=${role}]`);
        if (box) {
            box.textContent = text;
            box.scrollTop = 0;
        }
    }
    /** 坐标世界书操作（挂载/同步/修复/删除）的就地结果：显示在本节按钮下方 */
    showGeoResult(text) {
        this.showApiResult(text, 'geo-result');
    }
    /** AI 整理本会话地点的就地结果：显示在轨迹页按钮下方 */
    showTrailResult(text) {
        this.showApiResult(text, 'trail-result');
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
            layoutSupplement: this.data.settings?.layoutSupplement ?? '',
        };
        pane.querySelectorAll('[data-set]').forEach(input => {
            if (document.activeElement === input)
                return;
            const value = map[input.dataset.set];
            input.value = value === undefined || value === null ? '' : String(value);
        });
    }
    /** 坐标世界书 / 态势注入的开关回填 */
    fillGeoSettings() {
        const pane = this.panes.get('settings');
        const geo = this.data.settings?.geoContext;
        const book = this.data.settings?.coordBook;
        const values = {
            coordEnabled: Boolean(book?.enabled),
            coordTier4: book?.includeTier4 !== false,
            coordMovementOn: book?.movementRulesEnabled !== false,
            coordNarrativeOn: book?.narrativeRulesEnabled !== false,
            geoEnabled: geo?.enabled !== false,
            geoBounds: geo?.enforceBounds !== false,
            geoJump: geo?.jumpNotice !== false,
        };
        pane.querySelectorAll('[data-gset]').forEach(input => {
            const value = values[input.dataset.gset];
            if (typeof value === 'boolean')
                input.checked = value;
        });
        const movement = pane.querySelector('[data-gset-text=movementRules]');
        if (movement && document.activeElement !== movement)
            movement.value = book?.movementRules ?? '';
        const narrative = pane.querySelector('[data-gset-text=narrativeRules]');
        if (narrative && document.activeElement !== narrative)
            narrative.value = book?.narrativeRules ?? '';
    }
    /** 规则文本框保存：读当前 coordBook 全量、只覆盖指定字段（两个文本框互不覆盖、不冲掉复选框） */
    saveCoordBookField(field, value, savedHint) {
        const book = this.data.settings?.coordBook;
        this.actions.onSaveSettings({
            coordBook: {
                enabled: Boolean(book?.enabled),
                includeTier4: book?.includeTier4 !== false,
                excludeTrailPlaces: book?.excludeTrailPlaces === true,
                maxEntries: book?.maxEntries ?? 200,
                movementRulesEnabled: book?.movementRulesEnabled !== false,
                narrativeRulesEnabled: book?.narrativeRulesEnabled !== false,
                movementRules: book?.movementRules ?? '',
                narrativeRules: book?.narrativeRules ?? '',
                [field]: value,
            },
        });
        const hint = this.panes.get('settings').querySelector('[data-role=geo-hint]');
        if (hint) {
            hint.textContent = value.trim() ? `已保存。${savedHint}` : '已保存为空文本：下次同步会移除对应的规则条目（想保留文本只停用，请取消上面那个勾）。';
        }
    }
    /** 开关即时保存（不用再去点「保存设置」）；数量类参数沿用当前值 */
    collectGeoSettings() {
        const pane = this.panes.get('settings');
        const checked = (key) => Boolean(pane.querySelector(`[data-gset=${key}]`)?.checked);
        const text = (key) => pane.querySelector(`[data-gset-text=${key}]`)?.value ?? this.data.settings?.coordBook?.[key] ?? '';
        this.actions.onSaveSettings({
            coordBook: {
                enabled: checked('coordEnabled'),
                includeTier4: checked('coordTier4'),
                excludeTrailPlaces: this.data.settings?.coordBook?.excludeTrailPlaces === true,
                maxEntries: this.data.settings?.coordBook?.maxEntries ?? 200,
                movementRulesEnabled: checked('coordMovementOn'),
                narrativeRulesEnabled: checked('coordNarrativeOn'),
                movementRules: text('movementRules'),
                narrativeRules: text('narrativeRules'),
            },
            geoContext: {
                enabled: checked('geoEnabled'),
                depth: this.data.settings?.geoContext?.depth ?? 1,
                role: this.data.settings?.geoContext?.role ?? 'system',
                nearbyCount: this.data.settings?.geoContext?.nearbyCount ?? 6,
                enforceBounds: checked('geoBounds'),
                jumpNotice: checked('geoJump'),
            },
        });
        const hint = pane.querySelector('[data-role=geo-hint]');
        if (hint)
            hint.textContent = '已保存。挂载状态下底图变更会自动同步进世界书；态势开关下一轮生成生效。';
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
            this.showApiResult(`【获取模型列表】成功\n接口：${base}\n共 ${models.length} 个：\n` +
                models.map(id => `  · ${id}`).join('\n') +
                `\n\n选一个（下拉框或「自定义」框）再点「保存设置」。`);
            toast('success', `已获取 ${models.length} 个模型，结果在按钮下方`);
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
            this.showApiResult(`【获取模型列表】失败\n接口：${base || '(未填写)'}\n密钥：${key ? '已填写' : '(空)'}\n原因：${message}${detail}\n`);
            toast('error', `获取模型列表失败：${message.slice(0, 60)}${detail}`);
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
            layoutSupplement: read('layoutSupplement'),
        });
    }
    bindChrome() {
        const bar = this.root.querySelector('.dym-titlebar');
        // 标题栏按钮里是 SVG 图标：点击目标可能是 <svg>/<path>，必须用 closest 找到带 data-act 的按钮
        const actOf = (target) => target?.closest?.('[data-act]')?.dataset?.act;
        bar.addEventListener('click', event => {
            const act = actOf(event.target);
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
        // 拖动标题栏（贴边窄条状态下拖动 = 从边上拖出来）
        let dragging = null;
        bar.addEventListener('pointerdown', event => {
            // 点在按钮（含其内部 SVG）上时不启动拖拽，否则 setPointerCapture 会把 click 吃掉
            if (actOf(event.target))
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
        // 键名与 store.ts 的 LOCAL_PREFIX + 'layout' 对齐：之前写成 worldmap_local_layout，
        // 读的却是 worldmap_map_local_layout，布局（位置/尺寸/页签）从来没被真正恢复过。
        try {
            localStorage.setItem('worldmap_map_local_layout', JSON.stringify(this.data.layout));
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
        this.drawerHandle.innerHTML = svgIcon(off ? UI.chevLeft : UI.chevRight, 12);
        this.drawerHandle.title = off ? '展开右侧栏' : '收起右侧栏';
        const barButton = this.root.querySelector('[data-act=drawer]');
        if (barButton) {
            barButton.innerHTML = svgIcon(UI.panelRight, 15);
            barButton.classList.toggle('dym-on', off);
            barButton.title = off ? '展开右侧栏' : '收起右侧栏';
        }
        this.persistLayout();
        requestAnimationFrame(() => this.data.canvas.render());
    }
    close() {
        this.exitRail();
        this.root.style.display = 'none';
        // 不做悬浮球：关掉就是关掉，重新打开走快捷回复栏的「世界舆图」按钮
        this.data.layout = { ...this.data.layout, collapsed: false };
    }
    open() {
        this.root.style.display = 'flex';
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
        const tierSelect = edit.querySelector('[data-role=node-tier]');
        if (document.activeElement !== nameInput)
            nameInput.value = selected?.name ?? '';
        if (document.activeElement !== xInput)
            xInput.value = selected ? String(selected.xy[0]) : '';
        if (document.activeElement !== yInput)
            yInput.value = selected ? String(selected.xy[1]) : '';
        if (tierSelect && document.activeElement !== tierSelect)
            tierSelect.value = selected?.tier ? String(selected.tier) : '';
        tierSelect.disabled = !selected;
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
        const graphView = this.data.canvas.getView().graph;
        const ordered = this.data.trail.slice().sort((a, b) => (a.seq ?? a.messageId) - (b.seq ?? b.messageId));
        trailList.innerHTML = ordered
            .reverse()
            .map(point => {
            const hidden = this.data.hiddenPointIds.has(point.id);
            const orphan = point.orphan ? '<span class="dym-tag dym-orphan" title="这一楼已不在聊天里，但轨迹保留">留</span>' : '';
            // 节点失联：底图里已经找不到这个地点（被清空/重建/换会话 id 对不上）
            const dead = !graphView.get(point.nodeId) && !(point.path && graphView.byPath.get(point.path))
                ? '<span class="dym-tag dym-orphan" title="底图里已找不到该地点，轨迹线在此断开；重新生成底图或手补该地点即可接回">失</span>'
                : '';
            return `<li data-point="${escapeHtml(point.id)}" style="opacity:${hidden ? 0.45 : 1}">
          <span class="dym-dot" style="background:#a3462a"></span>
          <span class="dym-name">楼${point.messageId}·${escapeHtml(point.path.split('·').slice(-2).join('·'))}</span>
          <span class="dym-tag">${escapeHtml(point.kind)}</span>${orphan}${dead}
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
        const geoMount = this.panes.get('settings').querySelector('[data-role=geo-mount]');
        if (geoMount) {
            geoMount.textContent = this.data.geoStatus ?? '…';
            geoMount.title = this.data.geoStatus ?? '';
        }
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
    }
}
//# sourceMappingURL=window.js.map
return { MapWindow };
});
__def("./index.js", () => {
const { GEO_INJECT_ID, ID_PREFIX, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } = __req('./types.js');
const { MapGraph, sanitizeNodes, tierOf, toBaseMap } = __req('./graph.js');
const { rebuildTrail, collectRawLocations } = __req('./trail.js');
const { normalize } = __req('./path.js');
const { isBaseMapNode, isTrailLayerNode, loadBaseMap, loadLayout, loadSettings, loadTrail, saveBaseMap, saveSettings, saveTrail } = __req('./store.js');
const { resolveInitialBaseMap, fetchPresetMap, mergeBaseMaps, seedBaseMap } = __req('./preset.js');
const { runLayout, buildHistoryPrompt, parseHistoryReply, requestLayout } = __req('./layout-ai.js');
const { attachCoordBook, deleteCoordBook, detachCoordBook, readCoordMountState, syncCoordBook } = __req('./geo-book.js');
const { buildGeoContext } = __req('./geo-context.js');
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
// ── 坐标世界书 / 地理态势（二期）状态 ──
let geoStatus = '未挂载';
let geoSyncTimer = null;
let geoBookBusy = false;
let geoInjected = false;
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
    // 撤销快照按层分开存：底图点与轨迹点各自回到当时的位置（两层边界以 isBaseMapNode 为准）
    return JSON.stringify({
        base: graph.toArray().filter(isBaseMapNode),
        trail: graph.toArray().filter(isTrailLayerNode),
        hidden: base.hiddenIds,
    });
}
function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 20)
        undoStack.shift();
    redoStack.length = 0;
}
function restore(json) {
    const parsed = JSON.parse(json);
    // 兼容旧版快照（只有 nodes 一个数组的形状）
    const baseNodes = parsed.base ?? (parsed.nodes ?? []).filter(isBaseMapNode);
    const trailNodes = parsed.trail ?? (parsed.base ? [] : (parsed.nodes ?? []).filter(isTrailLayerNode));
    graph = new MapGraph([...baseNodes, ...trailNodes]);
    base.hiddenIds = parsed.hidden ?? [];
    syncSelection();
    persistBaseMap();
    persistTrail();
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
    if (report.removedJunk)
        parts.push(`清掉 ${report.removedJunk} 个垃圾名节点`);
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
    // 底图只存「设定 + 人工确认」层；轨迹层节点由 persistTrail 存进聊天变量
    base.nodes = graph.toArray().filter(isBaseMapNode).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path, 'zh'));
    base.updatedAt = new Date().toISOString();
    if (saveTimer)
        window.clearTimeout(saveTimer);
    if (immediate) {
        saveTimer = null;
        saveBaseMap(base);
        writeBackup();
        scheduleGeoSync();
        return;
    }
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        saveBaseMap(base);
        writeBackup();
        scheduleGeoSync();
    }, 600);
}
let lastTrailJson = '';
let trailSaveTimer = null;
/**
 * 轨迹写聊天变量有三道闸：**内容去重**（没变化不写）→ **节流**（800ms 合并连续写）→ 才真正落库。
 * 聊天变量每次写都会触发酒馆的存档管线，重建又跑得勤 —— 曾经把酒馆的
 * 「保存文件时聊天完整性检查失败」弹窗刷出来过（就是那个要求键入 OVERWRITE 的）。
 */
function persistTrail(immediate = false) {
    trail.nodes = graph.toArray().filter(isTrailLayerNode);
    const json = JSON.stringify(trail);
    if (json === lastTrailJson)
        return;
    lastTrailJson = json;
    if (immediate) {
        if (trailSaveTimer) {
            window.clearTimeout(trailSaveTimer);
            trailSaveTimer = null;
        }
        saveTrail(trail);
        return;
    }
    if (trailSaveTimer)
        return;
    trailSaveTimer = window.setTimeout(() => {
        trailSaveTimer = null;
        saveTrail(trail);
    }, 800);
}
/** 用「底图层 + 当前轨迹层」重建合成树（换会话 / 导入 / 恢复骨架后调用） */
function recomposeGraph() {
    graph = new MapGraph([...base.nodes.filter(isBaseMapNode), ...(trail.nodes ?? [])]);
    syncSelection();
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
function refreshTrail(options = {}) {
    try {
        const lastId = getLastMessageId();
        if (lastId < 0) {
            trail = {
                schemaVersion: 1,
                points: [],
                hiddenPointIds: trail?.hiddenPointIds ?? [],
                nodes: [],
                pathFixes: trail?.pathFixes,
            };
            persistTrail();
            render();
            return;
        }
        if (options.fullReset) {
            // 全量重建（「从聊天记录重算」按钮）：轨迹层整个丢弃 —— 旧解析规则留下的、
            // 不再被引用的节点、拖过的位置、隐藏列表全部清掉，按当前聊天记录重新长出来。
            // pathFixes（AI 整理结果）保留，重建时自动套用。
            const stale = new Set(graph.toArray().filter(isTrailLayerNode).map(node => node.id));
            graph = new MapGraph(graph.toArray().filter(node => !stale.has(node.id)));
            timelineIndex = null;
            trail = { schemaVersion: 1, points: [], hiddenPointIds: [], nodes: [], pathFixes: trail?.pathFixes };
            lastTrailJson = '';
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
            previous: options.fullReset ? null : trail,
            pathFixes: trail?.pathFixes,
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
        pruneTrailNodes();
        if (dirty)
            persistBaseMap();
        persistTrail();
        status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点${result.orphanCount ? `（含 ${result.orphanCount} 个存档已删楼层）` : ''}`;
        render();
        // 位置变了 → 态势块内容跟着变（uninject + inject 覆盖式重注）
        refreshGeoInjection();
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
/**
 * 轨迹层剪枝：重算后，轨迹来源且**没有任何存活点引用**、也没锁定的节点一律清掉。
 * 没有这一步，旧解析规则建出来的节点会永远躺在轨迹层里越积越多（实测 173 个点里一大半是残渣）。
 * 保留：被存活点引用的节点、它们的祖先链（路径中转站）、锁定的（人工拖过）。
 */
function pruneTrailNodes() {
    const referenced = new Set();
    for (const point of trail.points) {
        if (point.orphan)
            continue;
        referenced.add(point.nodeId);
    }
    const keep = new Set();
    for (const id of referenced) {
        for (const ancestor of graph.ancestors(id))
            keep.add(ancestor.id);
        if (id)
            keep.add(id);
    }
    const doomed = graph
        .toArray()
        .filter(node => isTrailLayerNode(node) && !node.locked && !keep.has(node.id))
        .map(node => node.id);
    if (!doomed.length)
        return;
    const doomedSet = new Set(doomed);
    graph = new MapGraph(graph.toArray().filter(node => !doomedSet.has(node.id)));
    window.console.info(`[世界舆图] 轨迹层剪枝：清掉 ${doomed.length} 个不再引用的节点`);
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
        geoStatus,
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
// ── 坐标世界书与地理态势（二期）─────────────────────────────────────────
function describeGeoMount() {
    const state = readCoordMountState();
    if (state.isPrimary)
        return '异常：坐标书成了主世界书';
    // 只报告《世界舆图·坐标表》自己的挂载状态 —— 别的 DLC 挂了几本附加书与玩家无关，
    // 之前写「附加书 N 本」会把别人的书数进来，让人误以为本书已挂载（或没挂上）。
    if (state.mounted)
        return '已挂载';
    return '未挂载';
}
function geoSyncOptions() {
    return {
        includeTier4: settings.coordBook.includeTier4,
        maxEntries: settings.coordBook.maxEntries,
        hiddenIds: [...base.hiddenIds],
        excludeTrailPlaces: settings.coordBook.excludeTrailPlaces === true,
        // 关掉开关 = 保留文本但不写进书（传空串，geo-book 侧非空才生成条目）
        movementRules: settings.coordBook.movementRulesEnabled === false ? '' : settings.coordBook.movementRules ?? '',
        narrativeRules: settings.coordBook.narrativeRulesEnabled === false ? '' : settings.coordBook.narrativeRules ?? '',
    };
}
/** 底图 → 世界书 的单向同步。manual=false 时（自动）只写控制台与状态栏，不弹报告 */
async function runGeoSync(manual) {
    if (geoBookBusy)
        return;
    geoBookBusy = true;
    if (manual) {
        busy = '正在同步坐标世界书…';
        render();
    }
    try {
        const report = await syncCoordBook(graph, geoSyncOptions());
        geoStatus = `${describeGeoMount()}｜${report.message}`;
        const failed = report.status === 'refused' || report.status === 'failed' || report.status === 'missing-api';
        if (manual) {
            toast(failed ? 'warning' : 'success', `坐标世界书：${report.message}`);
            mapWindow?.showGeoResult(`【坐标世界书同步】${report.status}\n${report.message}\n条目数：${report.entryCount}\n挂载状态：${describeGeoMount()}`);
        }
        else {
            window.console.info('[世界舆图] 坐标世界书自动同步：', report.message);
        }
    }
    catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        geoStatus = `${describeGeoMount()}｜同步失败`;
        if (manual) {
            toast('error', `同步坐标世界书失败：${message}`);
            mapWindow?.showGeoResult(`【坐标世界书同步】失败\n${message}\n`);
        }
        else {
            window.console.warn('[世界舆图] 坐标世界书自动同步失败', error);
        }
    }
    finally {
        geoBookBusy = false;
        if (manual)
            busy = null;
        render();
    }
}
/** 底图变更后 2 秒去抖同步（设置里开了才生效；挂载与否则不影响内容同步） */
function scheduleGeoSync() {
    if (!settings?.coordBook?.enabled)
        return;
    if (geoSyncTimer)
        window.clearTimeout(geoSyncTimer);
    geoSyncTimer = window.setTimeout(() => {
        geoSyncTimer = null;
        void runGeoSync(false);
    }, 2000);
}
/** [地理态势] 注入：uninject + inject 覆盖式重注，内容每次现算；失败只记日志，绝不影响正文生成 */
function refreshGeoInjection() {
    try {
        const enabled = Boolean(settings?.geoContext?.enabled);
        const result = enabled
            ? buildGeoContext({
                graph,
                points: trail.points,
                nearbyCount: settings.geoContext.nearbyCount,
                enforceBounds: settings.geoContext.enforceBounds,
                jumpNotice: settings.geoContext.jumpNotice,
                hiddenIds: [...base.hiddenIds],
            })
            : null;
        if (!result) {
            if (geoInjected) {
                uninjectPrompts([GEO_INJECT_ID]);
                geoInjected = false;
            }
            return;
        }
        const depth = Math.max(0, Math.min(8, Math.round(settings.geoContext.depth || 0)));
        uninjectPrompts([GEO_INJECT_ID]);
        injectPrompts([{ id: GEO_INJECT_ID, position: 'in_chat', depth, role: settings.geoContext.role, content: result.content }], { once: false });
        geoInjected = true;
    }
    catch (error) {
        window.console.warn('[世界舆图] 注入地理态势失败', error);
    }
}
/** 生成前事件：注入只对当前聊天有效，所以每次生成前重注一遍（顺带保证内容最新） */
function onGenerationAfterCommands(_type, _option, dryRun) {
    if (dryRun)
        return;
    refreshGeoInjection();
}
// ── 动作 ────────────────────────────────────────────────────────────────
const actions = {
    onToggleLayer(key, value) {
        canvas?.setView({ [key]: value });
        render();
    },
    onSelectNode(id) {
        selectedId = id;
        canvas?.clearMulti();
        render();
    },
    onFocusNode(id) {
        focusId = id;
        canvas?.clearMulti();
        canvas?.focusOn(id);
        render();
    },
    onFit() {
        focusId = null;
        canvas?.clearMulti();
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
        // 只改坐标，不改来源：轨迹点拖完仍是轨迹点（留在聊天作用域），
        // 不会被当成设定点写进底图、进而混进坐标书（用户明确要求的语义）
        graph.setPosition(selectedId, xy, { force: true });
        const node = graph.get(selectedId);
        if (node) {
            node.locked = true;
            node.status = 'ok';
        }
        persistBaseMap();
        persistTrail();
        render();
    },
    /** 框选批量拖动：一次撤销快照，逐点落坐标；来源保持不变（轨迹点仍是轨迹点） */
    onMoveNodes(items) {
        if (!items.length)
            return;
        pushUndo();
        let moved = 0;
        for (const item of items) {
            if (!graph.setPosition(item.id, item.xy, { force: true }))
                continue;
            const node = graph.get(item.id);
            if (node) {
                node.locked = true;
                node.status = 'ok';
            }
            moved++;
        }
        if (!moved) {
            redoStack.length = 0;
            undoStack.pop();
            return;
        }
        persistBaseMap();
        persistTrail();
        render();
        toast('success', `已批量移动 ${moved} 个地点`);
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
    onAddChild(id, name, at) {
        pushUndo();
        const parent = id ? graph.get(id) : null;
        const node = graph.ensurePath([...(parent ? parent.path.split('·') : []), name], 'manual');
        if (node) {
            node.locked = true;
            node.source = 'manual';
            node.status = 'ok';
            if (at) {
                // 显式给了落点（在视图中心新增）：直接用，不再贴着父节点
                node.xy = [at[0], at[1]];
            }
            else if (parent) {
                const cell = graph.cellRadius(parent);
                node.xy = [parent.xy[0] + cell * 0.32, parent.xy[1] + cell * 0.32];
            }
            selectedId = node.id;
        }
        persistBaseMap();
        persistTrail();
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
    /** 手动指定显示层级（1~5）；null = 恢复按类型自动推导。影响显示分级与坐标书收录范围 */
    onSetNodeTier(id, tier) {
        const node = graph.get(id);
        if (!node)
            return;
        pushUndo();
        const mutable = node;
        if (tier == null) {
            delete mutable.tier;
            toast('info', '已恢复按类型自动分层');
        }
        else {
            mutable.tier = Math.max(1, Math.min(5, Math.round(tier)));
            if (node.status === 'unplaced')
                node.status = 'ok';
            toast('info', `「${node.name}」已设为层级 ${mutable.tier}`);
        }
        persistBaseMap();
        render();
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
        refreshTrail({ fullReset: true });
        toast('success', `轨迹层已清空并全量重建：${trail.points.length} 个轨迹点`);
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
        // 态势开关即时生效：关掉就撤掉已注入的块；打开（或改参数）立刻按新参数重算
        if (patch.geoContext)
            refreshGeoInjection();
        // 打开自动同步后立刻补一次（若此前书没建，这次会建出来；挂载仍需手动点）
        if (patch.coordBook?.enabled)
            scheduleGeoSync();
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
            mapWindow?.showApiResult(`【测试连接】成功\n接口：${base}\n耗时：${ms}ms\n模型：${models.length} 个\n` +
                models.map(id => `  · ${id}`).join('\n') +
                `\n当前选用：${settings.api.model || '(未设置)'}`);
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            toast('error', `连接失败：${message}`);
            mapWindow?.showApiResult(`【测试连接】失败\n接口：${settings.api.url || '(未填写)'}\n密钥：${settings.api.key ? '已填写' : '(空)'}\n原因：${message}\n`);
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
            recomposeGraph();
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
        // 只重置底图层；当前会话的轨迹层原样保留（轨迹数据不受影响）
        recomposeGraph();
        selectedId = null;
        focusId = null;
        persistBaseMap(true);
        persistTrail();
        syncStatus('已恢复内置骨架');
        render();
        toast('success', '已恢复内置世界骨架');
    },
    /** 清空底图层（轨迹层随后按聊天记录重建），两步确认 + 可撤销 */
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
        // 当前会话的轨迹层马上按聊天记录重建回来 —— 轨迹线不断，清理的只有设定层
        refreshTrail();
        toast('success', `已清空 ${count} 个地点（可撤销）。设定层已清；当前会话的轨迹点已重建。`);
    },
    onExportBaseMap() {
        persistBaseMap(true);
        return JSON.stringify(base, null, 2);
    },
    /** 导出「地名(坐标)｜…」锚点文本：可以直接替换提示词里的固定锚点段 */
    onExportAnchorText() {
        return buildAnchorText(graph);
    },
    /** 生成并挂载坐标世界书（用户显式点击 = 显式授权动绑定） */
    async onMountCoordBook() {
        if (busy)
            return;
        busy = '正在生成并挂载坐标世界书…';
        render();
        try {
            const report = await syncCoordBook(graph, geoSyncOptions());
            if (report.status === 'refused' || report.status === 'failed' || report.status === 'missing-api') {
                throw new Error(report.message);
            }
            const mount = readCoordMountState();
            if (mount.isPrimary)
                throw new Error('「世界舆图·坐标表」是主世界书，不能作为附加书挂载');
            if (!mount.caps.canAttach) {
                geoStatus = `未挂载｜${report.message}`;
                throw new Error(`世界书已生成（${report.entryCount} 条），但缺少绑定接口：${mount.caps.notes.join('；')}`);
            }
            if (!mount.mounted)
                await attachCoordBook();
            geoStatus = `${describeGeoMount()}｜${report.message}`;
            toast('success', `坐标世界书已就绪并挂载（${report.entryCount} 条）`);
            mapWindow?.showGeoResult(`【挂载坐标世界书】完成\n${report.message}\n挂载状态：${describeGeoMount()}\n\n` +
                '· 绿灯条目：正文提到地名才注入该地坐标（不提不花 token）\n' +
                '· 每回合另有「地理态势」注入（本页可关）\n' +
                '· 之后拖动/生成底图会自动同步进世界书（单向：底图 → 世界书）');
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            geoStatus = `${describeGeoMount()}｜挂载失败`;
            toast('error', `挂载坐标世界书失败：${message}`);
            mapWindow?.showGeoResult(`【挂载坐标世界书】失败\n${message}\n`);
            busy = null;
            render();
        }
    },
    /** 修复挂载（重新挂）：不碰书内容，只把绑定重写一遍并读回校验 —— 书已同步却显示「未挂载」时点它 */
    async onRemountCoordBook() {
        if (busy)
            return;
        busy = '正在修复挂载…';
        render();
        try {
            const before = readCoordMountState();
            if (before.isPrimary)
                throw new Error('「世界舆图·坐标表」是主世界书，不能作为附加书挂载');
            if (!before.caps.canAttach)
                throw new Error(`缺少角色卡绑定接口：${before.caps.notes.join('；')}`);
            const wasMounted = before.mounted;
            await attachCoordBook();
            geoStatus = `${describeGeoMount()}｜${wasMounted ? '绑定已重写并校验通过' : '已补挂'}`;
            toast('success', wasMounted ? '挂载状态已修复（绑定重写并读回校验）' : '已重新挂载坐标世界书');
            mapWindow?.showGeoResult(`【修复挂载】完成\n${wasMounted ? '原绑定已存在，已重写并读回校验' : '此前未挂载，现已补挂'}\n` +
                `挂载状态：${describeGeoMount()}\n`);
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            geoStatus = `${describeGeoMount()}｜修复挂载失败`;
            toast('error', `修复挂载失败：${message}`);
            mapWindow?.showGeoResult(`【修复挂载】失败\n${message}\n`);
            busy = null;
            render();
        }
    },
    /** 卸载 = 只解除绑定，书文件保留（可再次挂载） */
    onUnmountCoordBook() {
        detachCoordBook()
            .then(() => {
            geoStatus = `${describeGeoMount()}｜已解除绑定（书仍保留）`;
            toast('success', '已卸载坐标世界书（书文件保留，可再次挂载）');
            render();
        })
            .catch((error) => {
            toast('error', `卸载失败：${String(error instanceof Error ? error.message : error)}`);
        });
    },
    /** 删除 = 解绑 + 删书（两步确认在设置页按钮上） */
    async onDeleteCoordBook() {
        if (busy)
            return;
        busy = '正在删除坐标世界书…';
        render();
        try {
            const message = await deleteCoordBook();
            geoStatus = describeGeoMount();
            toast('success', message);
            mapWindow?.showGeoResult(`【删除坐标世界书】${message}\n`);
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            toast('error', `删除失败：${message}`);
            mapWindow?.showGeoResult(`【删除坐标世界书】失败\n${message}\n`);
            busy = null;
            render();
        }
    },
    onSyncCoordBook() {
        void runGeoSync(true);
    },
    /**
     * AI 整理本会话地点（聊天中途装插件的一次性补救）：
     * 把本会话出现过的原始地点串（混描述/时刻/拼层级的那种）发给模型，
     * 规范化成干净层级路径（非设定地点顺带给相对坐标），写进 trail.pathFixes 并重建轨迹。
     */
    async onAiFixHistory() {
        if (busy)
            return;
        busy = '正在用 AI 整理本会话地点…';
        render();
        try {
            const lastId = getLastMessageId();
            if (lastId < 0)
                throw new Error('这个会话还没有任何消息');
            const messages = getChatMessages(`0-${lastId}`).map(message => ({
                message: String(message?.message ?? ''),
                is_user: Boolean(message?.is_user),
                swipe_id: Number(message?.swipe_id ?? 0),
            }));
            const raws = collectRawLocations(messages);
            if (!raws.length) {
                throw new Error('没有收集到任何「当前地点」记录——这个会话可能还没玩到有地点的楼层');
            }
            const knownPaths = graph.toArray().filter(isBaseMapNode).map(node => node.path);
            const prompt = buildHistoryPrompt(raws, knownPaths);
            const { text } = await requestLayout(settings, prompt);
            const fixes = parseHistoryReply(text, new Set(raws));
            if (!fixes.length) {
                throw new Error('模型返回的内容解析不出任何整理结果（可再点一次，或换个听话的模型）');
            }
            const fixesMap = {};
            for (const fix of fixes) {
                fixesMap[normalize(fix.raw)] = {
                    path: fix.path,
                    ...(Number.isFinite(fix.x) ? { x: fix.x } : {}),
                    ...(Number.isFinite(fix.y) ? { y: fix.y } : {}),
                };
            }
            trail.pathFixes = { ...(trail.pathFixes ?? {}), ...fixesMap };
            persistTrail();
            refreshTrail();
            toast('success', `已整理 ${fixes.length}/${raws.length} 条地点串，轨迹已重建`);
            mapWindow?.showTrailResult(`【AI 整理本会话地点】完成\n输入 ${raws.length} 条，整理出 ${fixes.length} 条：\n` +
                fixes
                    .map(fix => `  · ${fix.raw}\n    → ${fix.path}${Number.isFinite(fix.x) ? ` (${fix.x}, ${fix.y})` : ''}`)
                    .join('\n') +
                '\n\n整理结果已存进本会话的轨迹数据，之后每次重算都会套用；新的脏写法出现后再点一次即可。');
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            toast('error', `整理失败：${message}`);
            mapWindow?.showTrailResult(`【AI 整理本会话地点】失败\n${message}\n`);
        }
        finally {
            busy = null;
            render();
        }
    },
    /** 本回合态势预览（写进「导出/导入」文本框，方便看模型会收到什么） */
    onGeoPreview() {
        const result = buildGeoContext({
            graph,
            points: trail.points,
            nearbyCount: settings.geoContext.nearbyCount,
            enforceBounds: settings.geoContext.enforceBounds,
            jumpNotice: settings.geoContext.jumpNotice,
            hiddenIds: [...base.hiddenIds],
        });
        return result?.content ?? '（还没有可用的当前位置：先玩一回合，或点「轨迹 → 从聊天记录重算」）';
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
            recomposeGraph();
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
    trail = loadTrail() ?? { schemaVersion: 1, points: [], hiddenPointIds: [], nodes: [] };
    // 合成树 = 底图层（设定+人工确认）+ 当前会话的轨迹层
    graph = new MapGraph([...base.nodes.filter(isBaseMapNode), ...(trail.nodes ?? [])]);
    sanitizeGraph('加载底图时');
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
        onMoveNodes: items => actions.onMoveNodes(items),
        onEditNode: id => {
            const node = graph.get(id);
            if (node)
                mapWindow?.contextMenu(node);
        },
        onCreateNodeAt: (xy, parentId) => actions.onCreateNodeAt(xy, parentId),
    }, defaultView(graph));
    const windowActions = {
        ...actions,
        onAddChild: (id, name, at) => actions.onAddChild(id, name, at),
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
        geoStatus,
    }, windowActions, wrap);
    hostDocument.body.appendChild(mapWindow.root);
    status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点`;
    geoStatus = describeGeoMount();
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
            // 轨迹层（含轨迹地点节点）跟着聊天走：换会话整个切换，底图层不动
            if (trailSaveTimer) {
                window.clearTimeout(trailSaveTimer);
                trailSaveTimer = null;
            }
            lastTrailJson = '';
            trail = loadTrail() ?? { schemaVersion: 1, points: [], hiddenPointIds: [], nodes: [] };
            recomposeGraph();
            scheduleRefresh('切换聊天');
            // 注入只对当前聊天有效：切存档后旧的注入已失效，重注一次（内容按新轨迹现算）
            geoStatus = describeGeoMount();
            refreshGeoInjection();
        });
        eventOn(tavern_events.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);
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
        // 态势注入是本插件加的 prompt，卸载时必须撤掉，不能给别的脚本留脏数据
        uninjectPrompts([GEO_INJECT_ID]);
        geoInjected = false;
    }
    catch {
        /* 忽略 */
    }
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
    state: () => ({
        nodes: graph.size,
        points: trail.points.length,
        baseNodes: graph.toArray().filter(isBaseMapNode).length,
        trailNodes: graph.toArray().filter(isTrailLayerNode).length,
        pathFixes: Object.keys(trail.pathFixes ?? {}).length,
        currentPath,
        keys: [KEY_BASE_MAP, KEY_TRAIL],
    }),
    toBaseMap: () => toBaseMap(graph, base),
    /** 二期调试：坐标世界书挂载状态 / 态势预览 / 手动触发同步 */
    geoBook: () => ({ mount: readCoordMountState(), status: geoStatus }),
    geoPreview: () => actions.onGeoPreview(),
    syncGeoBook: () => runGeoSync(true),
    /** 调试：AI 整理本会话地点（轨迹页按钮走的就是它） */
    aiFixHistory: () => actions.onAiFixHistory(),
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