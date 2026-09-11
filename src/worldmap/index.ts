/**
 * 角色卡地图轨迹插件 —— 入口 / 控制器。
 *
 * 运行环境：酒馆助手脚本 iframe（隐藏、同源、无 sandbox）。
 *   · `$` 是**酒馆主页面的 jQuery**，所以 $('body') 就是酒馆页面；
 *   · 但裸 `document` 是本 iframe 的文档，界面必须建在 `window.parent.document` 上；
 *   · 卸载要自己清理 DOM —— 见 $(window).on('pagehide', …)。
 */
import type { BaseMap, MapNode, MapSettings, Trail, TrailPoint, Vec2 } from './types.js';
import { ID_PREFIX, KEY_BASE_MAP, KEY_TRAIL, migrateBaseMap } from './types.js';
import { MapGraph, sanitizeNodes, tierOf, toBaseMap } from './graph.js';
import { rebuildTrail } from './trail.js';
import { loadBaseMap, loadLayout, loadSettings, loadTrail, saveBaseMap, saveLayout, saveSettings, saveTrail } from './store.js';
import { resolveInitialBaseMap, fetchPresetMap, mergeBaseMaps, seedBaseMap } from './preset.js';
import { runLayout, type LayoutResult, type LayoutScope, type LocationEntry } from './layout-ai.js';
import { MapCanvas, defaultView } from './ui/canvas.js';
import { MapWindow } from './ui/window.js';

const BUTTON_NAME = '世界舆图';

const hostWindow: Window = (window.parent && window.parent !== window ? window.parent : window) as Window;
const hostDocument: Document = hostWindow.document ?? document;

let graph: MapGraph;
let base: BaseMap;
let trail: Trail;
let settings: MapSettings;
let canvas: MapCanvas | null = null;
let mapWindow: MapWindow | null = null;
let editMode = false;
let busy: string | null = null;
let status = '';
let presetError: string | undefined;
let selectedId: string | null = null;
let focusId: string | null = null;
let timelineIndex: number | null = null;
let currentPath: string | null = null;
let refreshTimer: number | null = null;
let saveTimer: number | null = null;
const undoStack: string[] = [];
const redoStack: string[] = [];

// ── 工具 ────────────────────────────────────────────────────────────────
function toast(kind: 'success' | 'info' | 'warning' | 'error', message: string): void {
  try {
    const fn = (hostWindow as any).toastr?.[kind];
    if (typeof fn === 'function') fn(message, '世界舆图');
    else window.console.log('[世界舆图]', kind, message);
  } catch {
    window.console.log('[世界舆图]', message);
  }
}

function snapshot(): string {
  return JSON.stringify({ nodes: graph.toArray(), hidden: base.hiddenIds });
}

function pushUndo(): void {
  undoStack.push(snapshot());
  if (undoStack.length > 20) undoStack.shift();
  redoStack.length = 0;
}

function restore(json: string): void {
  const parsed = JSON.parse(json) as { nodes: MapNode[]; hidden: string[] };
  graph = new MapGraph(parsed.nodes);
  base.hiddenIds = parsed.hidden ?? [];
  syncSelection();
  persistBaseMap();
  render();
}

function syncSelection(): void {
  if (selectedId && !graph.get(selectedId)) selectedId = null;
  if (focusId && !graph.get(focusId)) focusId = null;
}

/**
 * 底图清洗：剔除方位词节点、剔除仙界子树、合并重复点。
 * 老版本存下来的底图靠它自动迁移，不需要用户手动清理。
 */
function sanitizeGraph(reason: string): boolean {
  const { nodes, report } = sanitizeNodes(graph.toArray());
  if (!report.removedBearing && !report.removedImmortal && !report.merged) return false;
  graph = new MapGraph(nodes);
  syncSelection();
  const parts: string[] = [];
  if (report.removedBearing) parts.push(`去掉 ${report.removedBearing} 个方位节点`);
  if (report.removedImmortal) parts.push(`去掉 ${report.removedImmortal} 个仙界节点`);
  if (report.merged) parts.push(`合并 ${report.merged} 个重复点`);
  status = `底图已清理：${parts.join('、')}`;
  window.console.info('[世界舆图] 底图清洗', reason, report);
  return true;
}

function writeBackup(): void {
  try {
    localStorage.setItem('worldmap_local_backup', JSON.stringify(base));
  } catch {
    /* 忽略 */
  }
}

function persistBaseMap(immediate = false): void {
  base.nodes = graph.toArray().sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path, 'zh'));
  base.updatedAt = new Date().toISOString();
  if (saveTimer) window.clearTimeout(saveTimer);
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

function persistTrail(): void {
  saveTrail(trail);
}

function download(filename: string, content: string): void {
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
  } catch (error) {
    toast('error', `导出失败：${String(error)}`);
  }
}

// ── 数据刷新 ────────────────────────────────────────────────────────────
function readCurrentLocation(): string | null {
  const sources: any[] = [(hostWindow as any).Mvu, (window as any).Mvu];
  for (const Mvu of sources) {
    try {
      if (Mvu?.getMvuData) {
        const value = Mvu.getMvuData({ type: 'chat' })?.stat_data?.世界?.当前地点;
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    } catch {
      /* 换下一个来源 */
    }
  }
  try {
    const value = (getVariables({ type: 'chat' }) as any)?.stat_data?.世界?.当前地点;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    /* 忽略 */
  }
  return null;
}

function refreshTrail(): void {
  try {
    const lastId = getLastMessageId();
    if (lastId < 0) {
      trail = { schemaVersion: 1, points: [], hiddenPointIds: trail?.hiddenPointIds ?? [] };
      render();
      return;
    }
    const messages = getChatMessages(`0-${lastId}`) as unknown as { message: string; is_user?: boolean; swipe_id?: number }[];
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
        if (resolved.created) dirty = true;
      }
    } else if (trail.points.length) {
      currentPath = trail.points[trail.points.length - 1].path;
    }
    if (dirty && sanitizeGraph('轨迹新建节点后')) dirty = true;
    if (dirty) persistBaseMap();
    persistTrail();
    status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点${result.orphanCount ? `（含 ${result.orphanCount} 个存档已删楼层）` : ''}`;
    render();
  } catch (error) {
    toast('error', `重建轨迹失败：${String(error)}`);
  }
}

// 状态栏那行字：底图/轨迹数量变了就调一次（清空、生成、导入、恢复骨架都会用到）
function syncStatus(note?: string): void {
  const base = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点`;
  status = note ? `${note}｜${base}` : base;
}

function scheduleRefresh(reason: string): void {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    window.console.info('[世界舆图] 刷新：', reason);
    refreshTrail();
  }, 300);
}

// ── 渲染 ────────────────────────────────────────────────────────────────
function render(): void {
  if (!canvas || !mapWindow) return;
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
function fmt2(xy: [number, number]): string {
  return `${Math.round(xy[0])}, ${Math.round(xy[1])}`;
}

function buildLayoutReport(
  scopeLabel: string,
  outcome: { result: LayoutResult; used: number; total: number; picked: LocationEntry[]; rawReply: string },
): string {
  const { result, used, total, picked, rawReply } = outcome;
  const lines: string[] = [];
  lines.push(`【生成${scopeLabel}】完成`);
  lines.push(
    `新增 ${result.added} 个点｜移动 ${result.moved} 个｜跳过锁定 ${result.skippedLocked} 个｜` +
      `丢弃无效 ${result.skippedBad} 个｜丢弃无意义设施 ${result.skippedTrivial} 个`,
  );
  lines.push(`送给模型的资料 ${total} 条（约 ${Math.round(used / 1000)}k 字符）；现在底图共 ${graph.size} 个节点。`);
  lines.push('');
  lines.push(`—— 选中的世界书条目（${picked.length} 条）——`);
  for (const entry of picked.slice(0, 60)) {
    lines.push(`  · [${entry.book}] ${entry.comment}`);
  }
  if (picked.length > 60) lines.push(`  … 其余 ${picked.length - 60} 条略`);
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
  onToggleLayer(key: 'showTrail' | 'showLinks' | 'showRegions' | 'showUnplaced' | 'trailCityOnly', value: boolean) {
    canvas?.setView({ [key]: value } as Partial<ReturnType<MapCanvas['getView']>>);
    render();
  },
  onSelectNode(id: string | null) {
    selectedId = id;
    render();
  },
  onFocusNode(id: string | null) {
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
  onSetEditMode(value: boolean) {
    editMode = value;
    status = value ? '编辑模式：拖动节点即可改位置' : `节点 ${graph.size} 个`;
    render();
  },
  onUndo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(snapshot());
    restore(previous);
    toast('info', '已撤销');
  },
  onRedo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(snapshot());
    restore(next);
    toast('info', '已重做');
  },
  onMoveSelected(xy: Vec2) {
    if (!selectedId) return;
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
  onRenameNode(id: string, name: string) {
    const node = graph.get(id);
    const trimmed = name.trim();
    if (!node || !trimmed || trimmed === node.name) return;
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
  onDeleteNode(id: string) {
    const node = graph.get(id);
    if (!node) return;
    pushUndo();
    const doomed = new Set([id, ...graph.descendants(id).map(child => child.id)]);
    graph = new MapGraph(graph.toArray().filter(item => !doomed.has(item.id)));
    base.hiddenIds = base.hiddenIds.filter(hidden => !doomed.has(hidden));
    selectedId = null;
    persistBaseMap();
    refreshTrail();
    toast('info', `已删除 ${doomed.size} 个节点`);
  },
  onAddChild(id: string | null, name: string) {
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
  onCreateNodeAt(xy: Vec2, parentId: string | null) {
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
  onToggleLock(id: string) {
    const node = graph.get(id);
    if (!node) return;
    node.locked = !node.locked;
    if (node.locked) node.status = 'ok';
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
  onTimeline(index: number | null) {
    timelineIndex = index;
    render();
  },
  onJumpToPoint(point: TrailPoint) {
    const node = graph.get(point.nodeId);
    if (!node) return;
    selectedId = node.id;
    focusId = node.id;
    const index = trail.points.findIndex(item => item.id === point.id);
    if (index >= 0) timelineIndex = index >= trail.points.length - 1 ? null : index;
    canvas?.focusOn(node.id);
    render();
  },
  onTogglePointHidden(id: string) {
    const set = new Set(trail.hiddenPointIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
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
  onSaveSettings(patch: Partial<MapSettings>) {
    settings = { ...settings, ...patch, api: { ...settings.api, ...(patch.api ?? {}) } };
    saveSettings(settings);
    render();
    toast('success', '设置已保存');
  },
  async onTestApi() {
    if (busy) return;
    busy = '正在测试模型连接…';
    render();
    try {
      const base = settings.api.url.trim().replace(/\/+$/, '');
      if (!base) throw new Error('还没填接口地址（形如 http://localhost:1234/v1）');
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(`${base}/models`, {
          headers: settings.api.key ? { Authorization: `Bearer ${settings.api.key}` } : {},
        });
      } catch (error) {
        // 网络层失败（拒绝连接 / CORS / https 混用）时给出可操作的提示
        throw new Error(
          `连不上 ${base}/models：${String(error)}。检查接口地址是否带 /v1、服务是否在跑、是否允许跨域。`,
        );
      }
      const ms = Date.now() - started;
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status} ${response.statusText}｜${base}/models` +
            (response.status === 401 || response.status === 403 ? '（密钥不对或没权限）' : '') +
            (body ? `｜${body.slice(0, 200)}` : ''),
        );
      }
      const data = (await response.json()) as { data?: { id?: string }[] };
      const models = (data?.data ?? []).map(item => String(item.id ?? '')).filter(Boolean);
      if (!models.length) throw new Error(`${base}/models 返回成功，但里面没有模型列表。`);
      // 顺手把下拉填好，省得再点一次「获取模型列表」
      mapWindow?.fillModels(models);
      const head = models.slice(0, 4).join('、');
      toast('success', `连接正常（${ms}ms）：共 ${models.length} 个模型，如 ${head}${models.length > 4 ? ' …' : ''}`);
      mapWindow?.showReport(
        `【测试连接】成功\n接口：${base}\n耗时：${ms}ms\n模型：${models.length} 个\n` +
          models.map(id => `  · ${id}`).join('\n') +
          `\n当前选用：${settings.api.model || '(未设置)'}`,
        '连接测试通过；模型下拉已填好，选一个再点「保存设置」即可。',
      );
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      toast('error', `连接失败：${message}`);
      mapWindow?.showReport(
        `【测试连接】失败\n接口：${settings.api.url || '(未填写)'}\n密钥：${settings.api.key ? '已填写' : '(空)'}\n原因：${message}\n`,
        `连接失败：${message}`,
      );
    } finally {
      busy = null;
      render();
    }
  },
  async onRunLayout(scope: LayoutScope) {
    if (busy) return;
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
      toast(
        'success',
        `完成：新增 ${outcome.result.added}、移动 ${outcome.result.moved}、跳过锁定 ${outcome.result.skippedLocked}、丢弃无效 ${outcome.result.skippedBad}（资料 ${outcome.total} 条 / ${Math.round(outcome.used / 1000)}k 字符）`,
      );
      mapWindow?.showReport(buildLayoutReport(scopeLabel, outcome), '生成完成；报告已留在文本框里，可直接复制留存或发给 AI 讨论。');
    } catch (error) {
      const previous = undoStack.pop();
      if (previous) restore(previous);
      const message = String(error instanceof Error ? error.message : error);
      toast('error', `生成失败，已保留原图：${message}`);
      mapWindow?.showReport(`【生成${scopeLabel}】失败\n${message}\n`, `生成失败：${message}`);
    } finally {
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
      if (!preset) throw new Error('预设为空');
      pushUndo();
      const report = mergeBaseMaps(base, preset, { source: 'preset' });
      graph = new MapGraph(base.nodes);
      presetError = undefined;
      persistBaseMap(true);
      syncStatus('作者预设已合并');
      render();
      toast('success', `作者预设已合并：新增 ${report.added}、更新 ${report.updated}、跳过锁定 ${report.skipped}`);
    } catch (error) {
      presetError = String(error);
      toast('error', `拉取失败：${String(error)}`);
    } finally {
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
  onExportBaseMap(): string {
    persistBaseMap(true);
    return JSON.stringify(base, null, 2);
  },
  /** 导出「地名(坐标)｜…」锚点文本：可以直接替换提示词里的固定锚点段 */
  onExportAnchorText(): string {
    return buildAnchorText(graph);
  },
  onExportTrail() {
    download(`世界舆图轨迹-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(trail, null, 2));
  },
  onImportBaseMapText(text: string, report: (message: string) => void) {
    try {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('内容是空的');
      // 容错：允许粘进来的是被 ```json 包起来的片段
      const cleaned = trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '');
      const parsed = JSON.parse(cleaned) as BaseMap;
      if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('缺少 nodes 数组，这看起来不是底图 JSON');
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
    } catch (error) {
      const message = `导入失败：${String(error)}`;
      report(message);
      toast('error', message);
    }
  },
};

export type MapActions = typeof actions;

/**
 * 生成"锚点速查文本"：按层级分组、只取 tier ≤ 3 的点（也就是提示词里那些固定锚点），
 * 坐标保留 1 位小数。用户可以直接把这段替换掉提示词里的「固定锚点」那几行，
 * 也可以整段发给 AI 让它调整。
 */
function buildAnchorText(target: MapGraph): string {
  const byTier = new Map<number, MapNode[]>();
  for (const node of target.toArray()) {
    const tier = tierOf(node);
    if (tier > 3) continue;
    const list = byTier.get(tier);
    if (list) list.push(node);
    else byTier.set(tier, [node]);
  }
  const one = (node: MapNode) => `${node.name}(${node.xy[0]},${node.xy[1]})`;
  const lines: string[] = [];
  lines.push('# 世界舆图 · 锚点速查（可直接替换提示词里的「固定锚点」段）');
  lines.push('# 坐标以神都洛阳为原点 (0,0)，正东 +x、正南 +y，向西/向北为负，范围 -500~500；1 单位 ≈ 15 亿里');
  const tier1 = byTier.get(1) ?? [];
  const tier2 = byTier.get(2) ?? [];
  if (tier1.length) lines.push(`\n【界域/大域】${tier1.map(one).join('｜')}`);
  if (tier2.length) lines.push(`\n【地域/地貌】${tier2.map(one).join('｜')}`);
  const tier3 = byTier.get(3) ?? [];
  const groups = new Map<string, MapNode[]>();
  for (const node of tier3) {
    const parent = node.parentId ? target.get(node.parentId) : undefined;
    const key = parent ? parent.path : '（无上级）';
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  }
  for (const [key, list] of groups) {
    lines.push(`\n【${key} 下属】${list.map(one).join('｜')}`);
  }
  lines.push(`\n# 共 ${tier1.length + tier2.length + tier3.length} 个锚点；更细的地点（tier 4/5）不列在这里。`);
  return lines.join('\n');
}

// ── 初始化 ──────────────────────────────────────────────────────────────
function readLocalBackup(): BaseMap | null {
  try {
    // 第二个键是上一版的遗留名，只读不写
    const raw =
      localStorage.getItem('worldmap_local_backup') ?? localStorage.getItem('daoyuan_map_local_backup');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BaseMap;
    return Array.isArray(parsed?.nodes) ? migrateBaseMap(parsed) : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
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

  canvas = new MapCanvas(
    wrap,
    {
      onSelect: id => actions.onSelectNode(id),
      onFocus: id => actions.onFocusNode(id),
      onMoveNode: (id, xy) => {
        selectedId = id;
        actions.onMoveSelected(xy);
      },
      onEditNode: id => {
        const node = graph.get(id);
        if (node) mapWindow?.contextMenu(node);
      },
      onCreateNodeAt: (xy, parentId) => actions.onCreateNodeAt(xy, parentId),
    },
    defaultView(graph),
  );

  const windowActions = {
    ...actions,
    onAddChild: (id: string | null, name: string) => actions.onAddChild(id, name),
    onSaveSettings: (patch: Partial<MapSettings>) => actions.onSaveSettings(patch),
  };

  mapWindow = new MapWindow(
    hostDocument,
    {
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
    },
    windowActions as never,
    wrap,
  );

  hostDocument.body.appendChild(mapWindow.root);
  hostDocument.body.appendChild(mapWindow.launcher);
  mapWindow.launcher.style.display = 'none';

  status = `节点 ${graph.size} 个｜轨迹 ${trail.points.length} 点`;
  render();
  canvas.fitStage();
  refreshTrail();
  toast('success', `世界舆图已就绪（底图来源：${resolution.source === 'local' ? '本地' : resolution.source === 'preset' ? '作者预设' : '内置骨架'}）`);
}

function bindEvents(): void {
  const onMessage = (event: string) => () => scheduleRefresh(event);
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
  } catch (error) {
    toast('error', `注册酒馆事件失败：${String(error)}`);
  }

  try {
    eventOn(getButtonEvent(BUTTON_NAME), () => {
      if (!mapWindow) return;
      if (mapWindow.isOpen()) {
        mapWindow.close();
      } else {
        mapWindow.open();
        actions.onLocateCurrent();
      }
    });
  } catch (error) {
    window.console.warn('[世界舆图] 注册脚本按钮失败', error);
  }

  void (async () => {
    try {
      await waitGlobalInitialized('Mvu');
      const Mvu = (window as any).Mvu;
      if (Mvu?.events?.VARIABLE_UPDATE_ENDED) {
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => scheduleRefresh('变量更新结束'));
      }
      scheduleRefresh('Mvu 就绪');
    } catch (error) {
      window.console.info('[世界舆图] 未检测到 MVU，改用纯 JSONPatch 扫描', error);
    }
  })();
}

function teardown(): void {
  try {
    eventClearAll();
  } catch {
    /* 忽略 */
  }
  try {
    mapWindow?.destroy();
  } catch {
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
      } catch {
        /* 某些环境不允许改按钮 */
      }
    } catch (error) {
      toast('error', `世界舆图启动失败：${String(error)}`);
      window.console.error('[世界舆图] 启动失败', error);
    }
  })();
});

$(window).on('pagehide', () => teardown());

// 便于在控制台排查：window.__worldMap
(hostWindow as any).__worldMap = {
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
  runLayout: (scope: LayoutScope = 'world') => actions.onRunLayout(scope),
  clearNodes: () => actions.onClearNodes(),
  /** 调试用：直接设定缩放倍率（试验台 ?zoom= 会用到） */
  zoomTo: (scale: number) => {
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
    const inCanvas = (selector: string) => hostDocument.querySelectorAll(`#${ID_PREFIX}canvas ${selector}`).length;
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
        const root = hostDocument.getElementById(`${ID_PREFIX}root`) as HTMLElement | null;
        if (!root) return null;
        const rect = root.getBoundingClientRect();
        const pick = (selector: string) => {
          const node = root.querySelector(selector) as HTMLElement | null;
          if (!node) return 'missing';
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
      scale: Number((hostDocument.getElementById(`${ID_PREFIX}canvas`) as HTMLElement | null)?.dataset.dymScale ?? 0),
    };
  },
};

export {};
