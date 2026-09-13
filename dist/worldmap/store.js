import { DEFAULT_COORD_BOOK, DEFAULT_GEO_CONTEXT, DEFAULT_LAYOUT, DEFAULT_MOVEMENT_RULES, DEFAULT_NARRATIVE_RULES, DEFAULT_SETTINGS, KEY_BASE_MAP, KEY_TRAIL, LAYOUT_SUPPLEMENT_DEFAULT, migrateBaseMap } from './types.js';
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
export function readScope(key, scope) {
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
export function writeScope(key, value, scope) {
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
export function isBaseMapNode(node) {
    return node.source !== 'trail';
}
/** 轨迹层节点（与 isBaseMapNode 互补） */
export function isTrailLayerNode(node) {
    return node.source === 'trail';
}
export function loadBaseMap() {
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
export function saveBaseMap(map) {
    const cleaned = { ...map, nodes: (map.nodes ?? []).filter(isBaseMapNode) };
    const ok = writeScope(KEY_BASE_MAP, cleaned, 'character');
    if (!ok)
        writeScope(KEY_BASE_MAP, cleaned, 'chat');
    return ok;
}
export function loadTrail() {
    const trail = readScope(KEY_TRAIL, 'chat') ?? readScope(LEGACY_KEY_TRAIL, 'chat');
    if (!trail || !Array.isArray(trail.points))
        return null;
    return { ...trail, nodes: Array.isArray(trail.nodes) ? trail.nodes : [] };
}
export function saveTrail(trail) {
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
export function loadSettings() {
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
export function saveSettings(settings) {
    writeScope('settings', settings, 'script');
    // 同步一份到 localStorage：脚本作用域在插件更新/重装后可能清空，KEY 不能跟着丢
    writeLocal(LOCAL_SETTINGS_KEY, settings);
}
export function loadLayout() {
    return { ...DEFAULT_LAYOUT, ...(readLocal('layout') ?? {}) };
}
export function saveLayout(layout) {
    writeLocal('layout', layout);
}
/** 当前聊天 / 角色的基本信息，用于日志与 UI */
export function describeContext() {
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