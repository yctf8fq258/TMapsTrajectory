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

/** 会出现在「地点名」与「环境描述」之间的分隔符（实测四种都用过） */
export const DESCRIPTION_CUTS = ['；', ';', '。', '，', ',', '！', '？', '!', '?', '\n'];

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

/** 轨迹（存聊天变量，每个存档独立） */
export interface Trail {
  schemaVersion: 1;
  points: TrailPoint[];
  /** 手动隐藏的点 id */
  hiddenPointIds: string[];
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

export const DEFAULT_SETTINGS: MapSettings = {
  schemaVersion: 1,
  api: { ...DEFAULT_API },
  presetUrl: DEFAULT_PRESET_URL,
  autoPlaceRadius: 1,
  defaultOpen: true,
  showEventLayer: true,
  showUnplaced: true,
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
