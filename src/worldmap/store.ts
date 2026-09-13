/**
 * 四层存储：
 *   chat      —— 轨迹（每个存档独立）
 *   character —— 底图（跨存档共享，跟着角色卡走）
 *   script    —— 插件设置（跟着脚本走）
 *   localStorage —— 悬浮窗布局等纯 UI 状态
 *
 * 为什么不直接用 replaceVariables：它是**整体替换**，会把「卡内手机脚本」写在
 * 角色卡变量里的 phone_data 一起抹掉。所以一律走 insertOrAssignVariables。
 */
import type { BaseMap, CoordBookSettings, LayoutState, MapNode, MapSettings, Trail } from './types.js';
import { DEFAULT_COORD_BOOK, DEFAULT_GEO_CONTEXT, DEFAULT_LAYOUT, DEFAULT_MOVEMENT_RULES, DEFAULT_NARRATIVE_RULES, DEFAULT_SETTINGS, KEY_BASE_MAP, KEY_TRAIL, LAYOUT_SUPPLEMENT_DEFAULT, migrateBaseMap } from './types.js';

export type StoreScope = 'chat' | 'character' | 'script' | 'global';

const LOCAL_PREFIX = 'worldmap_map_local_';

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}

/** 读某个作用域下自己那一份数据 */
export function readScope<T>(key: string, scope: StoreScope): T | null {
  try {
    const variables = getVariables({ type: scope } as VariableOption) as Record<string, unknown>;
    const value = variables?.[key];
    return value === undefined || value === null ? null : (value as T);
  } catch {
    return readLocal<T>(`${scope}_${key}`);
  }
}

/** 写某个作用域下自己那一份数据（深合并，不动别人的键） */
export function writeScope(key: string, value: unknown, scope: StoreScope): boolean {
  try {
    insertOrAssignVariables({ [key]: value } as Record<string, unknown>, { type: scope } as VariableOption);
    return true;
  } catch (error) {
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
 * 两层分界：底图（角色卡变量，跨会话）只存「设定 + 人工确认」的节点；
 * 轨迹来源且未锁定的节点属于**轨迹层**，随聊天变量走（trail.nodes）。
 * 内存里两者合成一棵树，持久化时按这条线劈开。
 */
export function isBaseMapNode(node: MapNode): boolean {
  return node.source !== 'trail' || node.locked === true;
}

/** 轨迹层节点（与 isBaseMapNode 互补） */
export function isTrailLayerNode(node: MapNode): boolean {
  return !isBaseMapNode(node);
}

export function loadBaseMap(): BaseMap | null {
  const map =
    readScope<BaseMap>(KEY_BASE_MAP, 'character') ??
    readScope<BaseMap>(KEY_BASE_MAP, 'chat') ??
    readScope<BaseMap>(LEGACY_KEY_BASE_MAP, 'character') ??
    readScope<BaseMap>(LEGACY_KEY_BASE_MAP, 'chat');
  if (!map || !Array.isArray(map.nodes)) return null;
  // 底图里不允许混轨迹层节点：老版本存进来的轨迹点在读取时直接丢弃（按新架构用「从聊天记录重算」重建）
  const cleaned = { ...map, nodes: map.nodes.filter(isBaseMapNode) };
  return migrateBaseMap(cleaned);
}

export function saveBaseMap(map: BaseMap): boolean {
  const cleaned = { ...map, nodes: (map.nodes ?? []).filter(isBaseMapNode) };
  const ok = writeScope(KEY_BASE_MAP, cleaned, 'character');
  if (!ok) writeScope(KEY_BASE_MAP, cleaned, 'chat');
  return ok;
}

export function loadTrail(): Trail | null {
  const trail = readScope<Trail>(KEY_TRAIL, 'chat') ?? readScope<Trail>(LEGACY_KEY_TRAIL, 'chat');
  if (!trail || !Array.isArray(trail.points)) return null;
  return { ...trail, nodes: Array.isArray(trail.nodes) ? trail.nodes : [] };
}

export function saveTrail(trail: Trail): void {
  writeScope(KEY_TRAIL, trail, 'chat');
}

/**
 * 坐标书设置合并：老存档缺字段、或规则文本框是空串时，一律回退到**内置默认规则文本**——
 * 用户打开设置就能看到两段规则，不需要再去文档里手动复制。
 */
function mergeCoordBook(stored?: Partial<CoordBookSettings> | null): CoordBookSettings {
  const merged: CoordBookSettings = { ...DEFAULT_COORD_BOOK, ...(stored ?? {}) };
  if (!merged.movementRules) merged.movementRules = DEFAULT_MOVEMENT_RULES;
  if (!merged.narrativeRules) merged.narrativeRules = DEFAULT_NARRATIVE_RULES;
  return merged;
}

export function loadSettings(): MapSettings {
  const stored = readScope<Partial<MapSettings>>('settings', 'script') ?? readScope<Partial<MapSettings>>('settings', 'global');
  if (!stored) return { ...DEFAULT_SETTINGS, api: { ...DEFAULT_SETTINGS.api }, geoContext: { ...DEFAULT_GEO_CONTEXT }, coordBook: mergeCoordBook(null) };
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

export function saveSettings(settings: MapSettings): void {
  writeScope('settings', settings, 'script');
}

export function loadLayout(): LayoutState {
  return { ...DEFAULT_LAYOUT, ...(readLocal<Partial<LayoutState>>('layout') ?? {}) };
}

export function saveLayout(layout: LayoutState): void {
  writeLocal('layout', layout);
}

/** 当前聊天 / 角色的基本信息，用于日志与 UI */
export function describeContext(): { chat: string; character: string } {
  let character = '';
  try {
    character = getCurrentCharacterName() ?? '';
  } catch {
    /* 忽略 */
  }
  let chat = '';
  try {
    chat = String((SillyTavern as any)?.getCurrentChatId?.() ?? '');
  } catch {
    /* 忽略 */
  }
  return { chat, character };
}
