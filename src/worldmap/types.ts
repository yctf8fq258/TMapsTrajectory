/**
 * 角色卡地图轨迹插件 —— 全部类型与常量。
 *
 * 设计要点（详细依据见 docs/计划书-世界舆图插件.md）：
 * · 坐标是**单一全局有符号坐标系**，**神都洛阳 = (0,0) 是世界中心**：
 *   正东 +x、正南 +y，向西/向北为负，范围 -500..500（1 单位 ≈ 15 亿里）。
 * · 节点层级由解析出来的**实际深度**决定，而不是 MVU 6 段格式的字面段号——因为
 *   真实数据是「大陆·势力·城池·建筑·房间」，段数会变（例如「中州东南·百花坊·外坊茶市」只有 3 段）。
 */

/** 世界坐标（神都为原点，有符号） */
export type Vec2 = [number, number];

/** 坐标轴范围：神都为 0，四方各 500 单位（≈7500 亿里） */
export const COORD_MIN = -500;
export const COORD_MAX = 500;

/** 原点 = 神都洛阳 */
export const COORD_CENTER: Vec2 = [0, 0];

/** 当前底图数据结构版本；1 → 2 是「原点从西北角搬到神都」的平移 */
export const BASE_MAP_SCHEMA = 2;
/** v1 → v2 的平移量：旧坐标 - 500 */
export const ORIGIN_SHIFT = -500;

/** 地点层级分隔符（U+00B7 MIDDLE DOT） */
export const LOC_SEP = '·';

/** 会出现在「地点名」与「环境描述」之间的分隔符（实测五种都用过，空格也算——AI 爱用空格隔描述） */
export const DESCRIPTION_CUTS = ['；', ';', '。', '，', ',', '！', '？', '!', '?', '\n', ' '];

/** 文案里偶尔混进来的其它中点变体，解析前统一成 LOC_SEP */
export const SEP_VARIANTS = ['·', '・', '•', '‧', '∙', '．', '﻿·'];

export type NodeKind = 'realm' | 'region' | 'power' | 'city' | 'site' | 'room' | 'poi';

/**
 * 显示层级（高德式分级）：数字越小越大。
 *   1 界域/大域  2 地域  3 城池与宗级势力  4 具体地点/秘境  5 房间
 * 「宗级势力按市级处理」——kind 仍是 power（图标区分），但显示层级与城池相同。
 */
export type NodeTier = 1 | 2 | 3 | 4 | 5;

export function tierOfKind(kind: NodeKind): NodeTier {
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
export const TIER_VISIBLE_SCALE = [0, 0.1, 0.32, 0.85, 2.6, 6.5];
/**
 * 高于该缩放倍率就隐藏这个层级的点（索引 = tier；Infinity = 不隐藏）。
 * 高德式：放大到街区级别时，「中州」「大域」这种洲级粒度只剩噪音，自动退场。
 */
export const TIER_HIDE_ABOVE_SCALE = [Number.POSITIVE_INFINITY, 8, 25, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
/** 低于该缩放倍率就不画这个层级的文字标签 */
export const TIER_LABEL_SCALE = [0, 0.1, 0.32, 1.15, 3.6, 8.5];
/** 屏幕像素半径（索引 = tier） */
export const TIER_RADIUS_PX = [0, 12, 9.5, 8, 6, 4.6];
/** 屏幕像素字号（索引 = tier） */
export const TIER_FONT_PX = [0, 15, 13.5, 12.5, 11.5, 10.5];
/** 两个点在屏幕上的距离小于它就算重叠，只画优先级最高的那个 */
export const COLLAPSE_PX = 26;
/** 高度偏移的基准像素距离（屏幕像素） */
export const ALTITUDE_OFFSET_PX = 44;

export type NodeStatus = 'ok' | 'unplaced';

export type NodeSource = 'seed' | 'preset' | 'ai' | 'manual' | 'trail';

/** 地图节点 */
export interface MapNode {
  id: string;
  /** 段名，如「神都」 */
  name: string;
  /** 全路径，如「中央神州·大周仙朝·神都」 */
  path: string;
  parentId: string | null;
  /** 树深度，0 = 顶层（大陆/大域） */
  depth: number;
  xy: Vec2;
  kind: NodeKind;
  /** 高度，单位「里」，正为上（黑渊为负、摘星悬岛为正）；0 表示同层 */
  altitude?: number;
  /** true = 人工确定，AI 与自动落点都不许覆盖 */
  locked: boolean;
  source: NodeSource;
  /** unplaced = 由轨迹自动落点、等待人工确认 */
  status: NodeStatus;
  /**
   * 区域轮廓（世界坐标顶点，至少 3 个，首尾自动闭合）。
   *
   * 只有 realm / region 这种「一片地方」才有意义 —— 用来回答
   * 「中央神州到底占多大、和东极青木域在哪分界」。
   * 城市/宗门这类「一个点」的地方不要写它。
   * 缺省时渲染端会自动用该节点的后代位置算一个凸包兜底。
   */
  shape?: Vec2[];
  /**
   * 人工指定的显示层级（1 界域 ~ 5 房间），编辑页下拉可调。
   * 缺省按 kind 推导（tierOfKind）；一旦手设，显示/收录范围/坐标书都以它为准。
   * 设回「自动」时删除该字段。
   */
  tier?: NodeTier;
  note?: string;
}

/** 作者预设 / 本地底图的来源信息 */
export interface PresetSourceRef {
  repo: string;
  ref: string;
  url: string;
}

/** 底图（存角色卡变量，跨存档共享） */
export interface BaseMap {
  /** 1 = 旧原点（画布西北角）；2 = 神都为原点。读到 1 会自动平移迁移 */
  schemaVersion: 1 | 2;
  name: string;
  sourceRef?: PresetSourceRef;
  updatedAt: string;
  nodes: MapNode[];
  /** 手动隐藏的节点 id */
  hiddenIds: string[];
}

/**
 * 底图迁移：v1 的坐标原点是画布西北角（0,0），v2 搬到了**神都洛阳**。
 * 读到的旧底图整体平移 (-500,-500)，区域轮廓顶点一起搬。
 */
export function migrateBaseMap(base: BaseMap): BaseMap {
  const version = Number(base.schemaVersion ?? 1);
  if (version >= BASE_MAP_SCHEMA) return { ...base, schemaVersion: BASE_MAP_SCHEMA };
  const shift = (point: Vec2): Vec2 => [point[0] + ORIGIN_SHIFT, point[1] + ORIGIN_SHIFT];
  const nodes = (base.nodes ?? []).map(node => {
    const xy: Vec2 = Array.isArray(node.xy) && node.xy.length >= 2 ? shift(node.xy) : node.xy;
    const shape = Array.isArray(node.shape) ? node.shape.map(shift) : node.shape;
    return { ...node, xy, shape };
  });
  return { ...base, schemaVersion: BASE_MAP_SCHEMA, nodes };
}

export type TrailPosSource = 'ai' | 'lookup' | 'auto';
export type TrailKind = 'move' | 'stay' | 'travel';

/** 轨迹点 */
export interface TrailPoint {
  /** `${messageId}-${swipeId}` */
  id: string;
  messageId: number;
  swipeId: number;
  /** 世界.当前时间 原文 */
  t: string;
  nodeId: string;
  path: string;
  xy: Vec2;
  posSrc: TrailPosSource;
  kind: TrailKind;
  /**
   * 单调递增的顺序号：跨"楼层被大总结删掉/重 roll"保持轨迹顺序稳定。
   * 重建时按「时间+地点」复用旧序号，新点取 max+1。
   */
  seq?: number;
  /** true = 这一楼已经不在聊天里了（被删/被总结覆盖），但仍然保留在轨迹上 */
  orphan?: boolean;
}

/**
 * 轨迹（存聊天变量，每个会档独立）。
 * nodes = **轨迹地点层**：聊天里自动落点产生的地点节点也跟聊天走，
 * 不混进角色卡底图 —— 换会话整个切换，底图永远是纯设定。
 * pathFixes = 「AI 整理本会话地点」的规范化结果（原始地点串 → 干净路径 [+ 相对坐标]）。
 */
export interface Trail {
  schemaVersion: 1;
  points: TrailPoint[];
  /** 手动隐藏的点 id */
  hiddenPointIds: string[];
  /** 本会话的轨迹地点节点（source='trail' 且未锁定的那部分；锁定/人工的转正进底图） */
  nodes?: MapNode[];
  pathFixes?: Record<string, { path: string; x?: number; y?: number }>;
}

/** 地图布局 AI 的连接配置（默认继承 MVU 的额外模型解析） */
export interface MapApiConfig {
  url: string;
  key: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface MapSettings {
  schemaVersion: 1;
  api: MapApiConfig;
  presetUrl: string;
  autoPlaceRadius: number;
  defaultOpen: boolean;
  showEventLayer: boolean;
  showUnplaced: boolean;
  /** [地理态势] 动态注入 */
  geoContext: GeoContextSettings;
  /** 坐标世界书（自建《世界舆图·坐标表》） */
  coordBook: CoordBookSettings;
  /** 生成底图的方位补充表（最高优先依据）；清空 = 不用补充表，纯按世界书条目定位 */
  layoutSupplement: string;
}

/** 悬浮窗布局（存 localStorage，纯 UI 状态） */
export interface LayoutState {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  drawerOpen: boolean;
  tab: DrawerTab;
  /** 贴到哪一侧：贴边后会缩成一条窄条，悬停/点击再展开 */
  docked: 'left' | 'right' | null;
  /** 贴边窄条的宽度 */
  railWidth: number;
}

export type DrawerTab = 'layers' | 'places' | 'edit' | 'trail' | 'settings';

/** MVU 变量 `地图` 的结构（AI 每回合写入） */
export interface MapVar {
  /** [x, y]，0..1000 */
  坐标?: number[];
  高度?: number;
  层级?: string;
  时间?: string;
}

/** 从一条 assistant 消息里抽出来的地图相关信息 */
export interface MessageMapInfo {
  mapVar?: MapVar;
  /** `/世界/当前地点` 的 replace 值 */
  location?: string;
  /** `/世界/当前时间` 的 replace 值 */
  time?: string;
}

/** 存储键名（避免与"卡内手机脚本"的 phone_data 冲突） */
export const KEY_BASE_MAP = 'worldmap_v1';
export const KEY_TRAIL = 'worldmap_trail_v1';

// ── 坐标世界书（二期）────────────────────────────────────────────────
/**
 * 插件自建坐标世界书的书名。挂到角色卡 additional（原世界书零改动），
 * 由 `geo-book.ts` 负责创建/同步/挂载/卸载；底图永远是唯一真源（单向同步）。
 */
export const WORLDMAP_BOOK = '世界舆图·坐标表';
/** 坐标世界书里条目名的统一前缀 —— 布局 AI 与其他脚本靠它隔离我们的条目 */
export const GEO_ENTRY_PREFIX = '[舆图]';
/** 坐标世界书条目上限：防绿灯扫描性能劣化；超过时只收 tier≤3 */
export const GEO_BOOK_MAX_ENTRIES = 200;
/** [地理态势] 注入提示词的 id（覆盖式重注与 pagehide 卸载都靠它） */
export const GEO_INJECT_ID = 'worldmap-geo-context';
/** 态势块与坐标条目的坐标换算说明（跟底图一致：1 单位 ≈ 15 亿里） */
export const GEO_UNIT_HINT = '1 坐标单位 ≈ 15 亿里';

/**
 * [地理态势] 动态注入的设置（叙事强度 L1：事实 + 地界规则）。
 * 内容每回合按当前坐标现算，经 injectPrompts 注入，绝不落世界书。
 */
export interface GeoContextSettings {
  enabled: boolean;
  /** 注入到聊天的深度（0 = 紧贴最新消息；实测可调） */
  depth: number;
  role: 'system' | 'user' | 'assistant';
  /** 周边地点数量（按直线距离取最近 N 个） */
  nearbyCount: number;
  /** 附「地界规则」：非本地势力公开活动需有理由 */
  enforceBounds: boolean;
  /** 位移超限时附「远行提示」；正常回合零成本 */
  jumpNotice: boolean;
}

/**
 * 人物移动规则的默认文本（设置页文本框预填，可在框里直接改）。
 * 与 `docs/提示词-地图坐标.md` 第八节保持一致。
 */
export const DEFAULT_MOVEMENT_RULES = `[人物移动规则]
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
export const DEFAULT_NARRATIVE_RULES = `[叙事地理规则]
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

/** 坐标世界书（插件自建《世界舆图·坐标表》）的设置 */
export interface CoordBookSettings {
  /** 总开关：开启后底图变更自动同步进书（挂载本身仍需在设置页显式点击） */
  enabled: boolean;
  /** 是否收录 tier4 城内要点（慈宁宫这类有独立地理意义的） */
  includeTier4: boolean;
  /** 地点条目上限（总纲另算） */
  maxEntries: number;
  /**
   * 剔除轨迹地点：玩家轨迹自动产生的地点（`source === 'trail'`，含人工拖动过的）不进坐标书。
   * 换新对话时想让模型只看到「设定里的地方」而不是上一档玩出来的地名，就打开它。
   */
  excludeTrailPlaces: boolean;
  /**
   * 人物移动规则（境界 → 日行速度/移动方式）。非空且启用时，作为一条**蓝灯条目**
   * `[舆图]人物移动规则` 一起写进坐标书 —— 距离换算与赶路方式跟坐标系统同源，随书分发。
   */
  movementRules: string;
  /** 是否把移动规则写进坐标书（关掉 = 保留文本但不生成条目） */
  movementRulesEnabled: boolean;
  /**
   * 叙事地理规则（坐标权威 + 远方事件隔离）。生效范围恰好等于坐标书的作用域，
   * 所以随书注入而不是放预设。
   */
  narrativeRules: string;
  /** 是否把叙事规则写进坐标书 */
  narrativeRulesEnabled: boolean;
}

/** 所有自己注入到父页面的 DOM id 前缀（pagehide 与热重载靠它清理） */
export const ID_PREFIX = 'worldmap-';

export const DEFAULT_API: MapApiConfig = {
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

export const DEFAULT_PRESET_URL = '';

/**
 * 生成底图的「方位补充表」默认内容（与 docs/底图补充.txt 保持一致，可在设置页编辑）。
 *
 * 用法（三层优先级）：**补充表为主**先落点 → 坐标骨架（原点/四域）定框架 → 世界书条目做校验与补漏。
 * 格式：`地名-方位-距离(亿里)`，括号里是相对线索（距某地 N、向某方向 N 到边界、正上/正下方、宽度）。
 */
export const LAYOUT_SUPPLEMENT_DEFAULT = `-以神都洛阳为中州中心：地点-在洛阳的XX方向-直线距离（亿里）

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

export const DEFAULT_GEO_CONTEXT: GeoContextSettings = {
  enabled: true,
  depth: 1,
  role: 'system',
  nearbyCount: 6,
  enforceBounds: true,
  jumpNotice: true,
};

export const DEFAULT_COORD_BOOK: CoordBookSettings = {
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

export const DEFAULT_SETTINGS: MapSettings = {
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

export const DEFAULT_LAYOUT: LayoutState = {
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
export const LAYER_RADIUS = [0, 420, 140, 48, 16, 5.5, 2];
