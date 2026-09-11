import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } from './types.js';
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
export function loadBaseMap() {
    const map = readScope(KEY_BASE_MAP, 'character') ??
        readScope(KEY_BASE_MAP, 'chat') ??
        readScope(LEGACY_KEY_BASE_MAP, 'character') ??
        readScope(LEGACY_KEY_BASE_MAP, 'chat');
    if (!map || !Array.isArray(map.nodes))
        return null;
    return migrateBaseMap(map);
}
export function saveBaseMap(map) {
    const ok = writeScope(KEY_BASE_MAP, map, 'character');
    if (!ok)
        writeScope(KEY_BASE_MAP, map, 'chat');
    return ok;
}
export function loadTrail() {
    const trail = readScope(KEY_TRAIL, 'chat') ?? readScope(LEGACY_KEY_TRAIL, 'chat');
    if (!trail || !Array.isArray(trail.points))
        return null;
    return trail;
}
export function saveTrail(trail) {
    writeScope(KEY_TRAIL, trail, 'chat');
}
export function loadSettings() {
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
export function saveSettings(settings) {
    writeScope('settings', settings, 'script');
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