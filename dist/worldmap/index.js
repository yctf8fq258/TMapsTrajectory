import { GEO_INJECT_ID, ID_PREFIX, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } from './types.js';
import { MapGraph, sanitizeNodes, tierOf, toBaseMap } from './graph.js';
import { rebuildTrail, collectRawLocations } from './trail.js';
import { normalize } from './path.js';
import { isBaseMapNode, isTrailLayerNode, loadBaseMap, loadLayout, loadSettings, loadTrail, saveBaseMap, saveSettings, saveTrail } from './store.js';
import { resolveInitialBaseMap, fetchPresetMap, mergeBaseMaps, seedBaseMap } from './preset.js';
import { runLayout, buildHistoryPrompt, parseHistoryReply, requestLayout } from './layout-ai.js';
import { attachCoordBook, deleteCoordBook, detachCoordBook, readCoordMountState, syncCoordBook } from './geo-book.js';
import { buildGeoContext } from './geo-context.js';
import { MapCanvas, defaultView } from './ui/canvas.js';
import { MapWindow } from './ui/window.js';
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
function persistTrail() {
    // 轨迹层节点（聊天里自动落点的地点）跟着轨迹存进聊天变量
    trail.nodes = graph.toArray().filter(isTrailLayerNode);
    saveTrail(trail);
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
function refreshTrail() {
    try {
        const lastId = getLastMessageId();
        if (lastId < 0) {
            trail = { schemaVersion: 1, points: [], hiddenPointIds: trail?.hiddenPointIds ?? [], nodes: [] };
            persistTrail();
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