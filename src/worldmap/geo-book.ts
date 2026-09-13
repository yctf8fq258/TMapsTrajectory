/**
 * 坐标世界书：把底图同步成本插件自建的世界书《世界舆图·坐标表》，并挂到角色卡 additional。
 *
 * 设计依据（docs/计划书-坐标世界书与地理态势.md）：
 *   1. **单向同步**：底图 → 世界书，绝不回写；世界书侧的手改会在下次同步被覆盖（UI 明示）。
 *   2. **两种条目**：1 条蓝灯总纲（原点/轴向/换算 + 大域锚点）常驻；
 *      每个有地理意义的地点 1 条绿灯（keys = 地名 + 别名），正文提到才注入 —— 省 token 的主力。
 *   3. **防呆对齐小手机 V1.2 的 DLC 挂载机制**：能力探测降级、install 已存在拒绝覆盖、
 *      attach/detach 走 rebindCharWorldbooks 且带「复读」读回校验、拒绝动主世界书。
 *   4. **隔离**：条目名一律 `[舆图]` 前缀，content 避开 layout-ai 的 LOCATION_CONTENT 正则，
 *      且 collectLocationEntries 直接跳过本书 —— 绝不把自己的坐标条目当成资料喂给布局 AI。
 *
 * 本模块分两层：纯函数（select/build/diff/toSillyTavernBook，可在 Node 里自测）与
 * IO 层（sync/attach/detach/delete，只在酒馆助手 iframe 里调用）。
 */
import type { MapNode } from './types.js';
import { GEO_BOOK_MAX_ENTRIES, GEO_ENTRY_PREFIX, WORLDMAP_BOOK } from './types.js';
import { MapGraph, PATH_ALIASES, SEGMENT_ALIASES, tierOf } from './graph.js';

// ── 纯函数层 ─────────────────────────────────────────────────────────────

/** 一条坐标条目的草稿（与酒馆的具体条目格式解耦，方便自测与转换） */
export interface CoordEntryDraft {
  /** 条目名，`[舆图]` 前缀 */
  name: string;
  content: string;
  /** 绿灯关键词；蓝灯总纲为空 */
  keys: string[];
  /** true = 蓝灯常量（总纲）；false = 绿灯（地点） */
  constant: boolean;
  /** 激活后跟随的楼层数；0 = 不跟随 */
  sticky: number;
  /** at_depth 插入深度 */
  depth: number;
}

/** 组装成酒馆助手 WorldbookEntry 形状的条目（只含我们关心的字段，createWorldbook 会补默认值） */
export interface CoordWorldbookEntry {
  uid: number;
  name: string;
  enabled: boolean;
  strategy: {
    type: 'constant' | 'selective';
    keys: string[];
    keys_secondary: { logic: 'and_any'; keys: string[] };
    scan_depth: 'same_as_global' | number;
  };
  position: { type: 'at_depth'; role: 'system'; depth: number; order: number };
  content: string;
  probability: number;
  recursion: { prevent_incoming: boolean; prevent_outgoing: boolean; delay_until: null };
  effect: { sticky: number | null; cooldown: null; delay: null };
}

export interface CoordBookScope {
  includeTier4: boolean;
  maxEntries: number;
  hiddenIds?: string[];
}

/**
 * 挑出要进坐标书的节点：
 *   · tier≤3（界域/地域/城池与宗级势力）全部收；
 *   · tier4 只收 includeTier4 且已确认定位（status==='ok'）的城内要点；
 *   · tier5（房间）、unplaced（待定位虚线圈）、被隐藏的一律不进 —— 虚线圈的坐标还没被人工确认，
 *     写进书里等于把猜测喂给模型。
 */
export function selectCoordNodes(graph: MapGraph, options: { includeTier4: boolean; hiddenIds?: string[]; excludeTrail?: boolean }): MapNode[] {
  const hidden = new Set(options.hiddenIds ?? []);
  return graph
    .toArray()
    .filter(node => !hidden.has(node.id))
    .filter(node => node.status === 'ok')
    // 剔除轨迹地点：换新对话时不想让上一档玩出来的地名进书（人工拖过的也算轨迹地点）
    .filter(node => !(options.excludeTrail && node.source === 'trail'))
    .filter(node => {
      const tier = tierOf(node);
      if (tier <= 3) return true;
      return tier === 4 && options.includeTier4;
    })
    .sort((a, b) => tierOf(a) - tierOf(b) || a.depth - b.depth || a.path.localeCompare(b.path, 'zh'));
}

/** 坐标显示：保留 1 位小数（0.9 这类城内偏移），整数不带小数点 */
function fmtCoord(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * 绿灯关键词：地名本身 + 别名表里指向它的所有叫法。
 * 注意不要把父级/大区名塞进来 —— 那会让整个大区的条目在随便提及时全量注入，token 失控。
 */
export function keysForNode(node: MapNode): string[] {
  const keys = new Set<string>();
  if (node.name) keys.add(node.name);
  for (const [alias, target] of Object.entries(SEGMENT_ALIASES)) {
    if (target === node.name) keys.add(alias);
  }
  for (const entry of PATH_ALIASES) {
    const last = entry.replacement[entry.replacement.length - 1];
    if (last === node.name) {
      for (const part of entry.pattern) {
        if (part !== node.name) keys.add(part);
      }
    }
  }
  return [...keys];
}

/** 蓝灯总纲：原点/轴向/换算 + tier1/2 大域锚点（从底图现算，不写死任何作品专名） */
function buildOverviewDraft(graph: MapGraph): CoordEntryDraft {
  const anchors = selectCoordNodes(graph, { includeTier4: false })
    .filter(node => tierOf(node) <= 2)
    .slice(0, 24)
    .map(node => `${node.name}(${fmtCoord(node.xy[0])},${fmtCoord(node.xy[1])})`);
  const originCandidates = graph
    .toArray()
    .filter(node => node.xy[0] === 0 && node.xy[1] === 0 && tierOf(node) <= 3)
    // (0,0) 上可能同时压着界域/王朝/都城 —— 取最具体的那层：tier 大者优先，同为市级则城池优先、短路径优先
    .sort(
      (a, b) =>
        tierOf(b) - tierOf(a) ||
        (b.kind === 'city' ? 1 : 0) - (a.kind === 'city' ? 1 : 0) ||
        a.path.length - b.path.length,
    );
  const originName = originCandidates[0]?.name ?? '原点';
  const content =
    `[舆图·坐标系] 本世界以「${originName}」为原点 (0,0)：正东 +x、正南 +y，向西/向北为负，范围 -500~500；1 坐标单位 ≈ 15 亿里。\n` +
    (anchors.length ? `大域锚点：${anchors.join('｜')}\n` : '') +
    '写坐标时锚点直接采用；锚点外的地点按资料里的方位与距离换算；与上一回合同地时坐标保持不变。';
  return { name: `${GEO_ENTRY_PREFIX}坐标系总纲`, content, keys: [], constant: true, sticky: 0, depth: 4 };
}

/**
 * 生成整本坐标书的条目草稿：第 0 条是蓝灯总纲，其余是绿灯地点条目。
 * 地点条目数量受 maxEntries 限制（默认 200），超出部分按排序（tier 优先）截断。
 */
export function buildCoordDrafts(
  graph: MapGraph,
  options: {
    includeTier4?: boolean;
    maxEntries?: number;
    hiddenIds?: string[];
    movementRules?: string;
    narrativeRules?: string;
    excludeTrailPlaces?: boolean;
  } = {},
): CoordEntryDraft[] {
  const includeTier4 = options.includeTier4 !== false;
  const maxEntries = Math.max(1, options.maxEntries ?? GEO_BOOK_MAX_ENTRIES);
  const drafts: CoordEntryDraft[] = [buildOverviewDraft(graph)];
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
  const usedNames = new Set<string>(drafts.map(draft => draft.name));
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
    if (usedNames.has(name)) name = `${GEO_ENTRY_PREFIX}${node.path}(${fmtCoord(node.xy[0])},${fmtCoord(node.xy[1])})`;
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
export function draftToEntry(draft: CoordEntryDraft, uid: number): CoordWorldbookEntry {
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

export function buildWorldbookEntries(
  graph: MapGraph,
  options: {
    includeTier4?: boolean;
    maxEntries?: number;
    hiddenIds?: string[];
    movementRules?: string;
    narrativeRules?: string;
    excludeTrailPlaces?: boolean;
  } = {},
): { drafts: CoordEntryDraft[]; entries: CoordWorldbookEntry[] } {
  const drafts = buildCoordDrafts(graph, options);
  return { drafts, entries: drafts.map(draftToEntry) };
}

/** 已有书里的条目（取我们关心的字段）与草稿逐条比对；完全一致才允许跳过写入 */
export function entriesDiffer(
  existing: Array<{ name?: string; content?: string; strategy?: { type?: string; keys?: unknown[] } }>,
  drafts: CoordEntryDraft[],
): boolean {
  if (existing.length !== drafts.length) return true;
  const byName = new Map(existing.map(entry => [String(entry.name ?? ''), entry]));
  for (const draft of drafts) {
    const match = byName.get(draft.name);
    if (!match) return true;
    if (String(match.content ?? '') !== draft.content) return true;
    if (String(match.strategy?.type ?? '') !== (draft.constant ? 'constant' : 'selective')) return true;
    if (!draft.constant) {
      const keys = (match.strategy?.keys ?? []).map(key => String(key));
      if (keys.join('\u0001') !== draft.keys.join('\u0001')) return true;
    }
  }
  return false;
}

/** 转成 SillyTavern 世界书导入格式（字段形状对照《洛阳扩展》实测样本），供 release 产出手动导入的双件套 */
export function toSillyTavernBook(drafts: CoordEntryDraft[]): { entries: Record<string, Record<string, unknown>> } {
  const entries: Record<string, Record<string, unknown>> = {};
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

// ── IO 层（只在酒馆助手 iframe 里调用；Node 自测不 import 这些）───────────

export interface GeoBookCaps {
  canList: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canAttach: boolean;
  notes: string[];
}

/** 能力探测（对齐小手机 V1.2 的 Yi()）：缺哪层就降级到哪层，绝不盲调不存在的接口 */
export function detectGeoBookCapabilities(): GeoBookCaps {
  const notes: string[] = [];
  const canList = typeof getWorldbookNames === 'function' && typeof getWorldbook === 'function';
  if (!canList) notes.push('缺少世界书读取接口');
  const canCreate = typeof createWorldbook === 'function';
  if (!canCreate) notes.push('缺少 createWorldbook');
  const canUpdate = typeof replaceWorldbook === 'function' || typeof updateWorldbookWith === 'function';
  if (!canUpdate) notes.push('缺少世界书写入接口');
  const canAttach = typeof getCharWorldbookNames === 'function' && typeof rebindCharWorldbooks === 'function';
  if (!canAttach) notes.push('缺少角色卡绑定接口 rebindCharWorldbooks');
  return { canList, canCreate, canUpdate, canAttach, notes };
}

export interface CoordSyncReport {
  status: 'created' | 'synced' | 'unchanged' | 'refused' | 'missing-api' | 'failed';
  entryCount: number;
  message: string;
}

/** 写完书后顺手刷新世界书编辑器（前台开着时立刻能看到新条目）；失败静默 */
function reloadWorldbookEditor(): void {
  try {
    // 只在世界书编辑器**本来就开着**时才原地刷新。无脑调用会把编辑器面板拉到前台
    // 重新加载 —— 撞上写入中的书就渲染成一块盖住整个酒馆的空面板，
    // 而且它不是本插件的窗口，没有关闭按钮，用户只能刷新页面（实测踩坑）。
    const parentDoc = window.parent && window.parent !== window ? window.parent.document : document;
    const editor = parentDoc.querySelector('#WorldInfo');
    if (!editor) return;
    const style = window.parent.getComputedStyle(editor);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const context = (SillyTavern as { getContext?: () => { reloadWorldInfoEditor?: (file: string, loadIfNotSelected?: boolean) => void } })
      ?.getContext?.();
    context?.reloadWorldInfoEditor?.(WORLDMAP_BOOK, false);
  } catch {
    /* 编辑器不在前台等场景，忽略 */
  }
}

/**
 * 把当前底图同步进《世界舆图·坐标表》：
 *   · 书不存在 → createWorldbook 新建；
 *   · 书存在 → 先验证所有权（全部条目都带 [舆图] 前缀才动它），再逐条 diff，内容没变就跳过写入；
 *   · 书里有别人的条目 → 拒绝覆盖并报出条目名。
 */
export async function syncCoordBook(
  graph: MapGraph,
  options: {
    includeTier4: boolean;
    maxEntries: number;
    hiddenIds?: string[];
    excludeTrailPlaces?: boolean;
    movementRules?: string;
    narrativeRules?: string;
  },
): Promise<CoordSyncReport> {
  const caps = detectGeoBookCapabilities();
  if (!caps.canList || !caps.canCreate || !caps.canUpdate) {
    return { status: 'missing-api', entryCount: 0, message: caps.notes.join('；') };
  }
  const { drafts, entries } = buildWorldbookEntries(graph, options);
  let existing: Array<{ name?: string; content?: string; strategy?: { type?: string; keys?: unknown[] } }> | null = null;
  try {
    existing = (await getWorldbook(WORLDMAP_BOOK)) as unknown as Array<{
      name?: string;
      content?: string;
      strategy?: { type?: string; keys?: unknown[] };
    }>;
  } catch {
    existing = null;
  }
  if (!existing || !existing.length) {
    const created = await createWorldbook(WORLDMAP_BOOK, entries as never);
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
  await replaceWorldbook(WORLDMAP_BOOK, entries as never);
  reloadWorldbookEditor();
  return { status: 'synced', entryCount: entries.length, message: `已同步 ${entries.length} 条进「${WORLDMAP_BOOK}」` };
}

export interface CoordMountState {
  mounted: boolean;
  isPrimary: boolean;
  mountedNames: string[];
  caps: GeoBookCaps;
}

/** 当前挂载状态（设置页状态徽章的数据源） */
export function readCoordMountState(): CoordMountState {
  const caps = detectGeoBookCapabilities();
  if (!caps.canAttach) {
    return { mounted: false, isPrimary: false, mountedNames: [], caps };
  }
  try {
    const names = getCharWorldbookNames('current');
    const all = [names.primary, ...(names.additional ?? [])].filter(Boolean) as string[];
    return {
      mounted: all.includes(WORLDMAP_BOOK),
      isPrimary: names.primary === WORLDMAP_BOOK,
      mountedNames: all,
      caps,
    };
  } catch {
    return { mounted: false, isPrimary: false, mountedNames: [], caps };
  }
}

/**
 * 挂载：追加到角色卡 additional（去重、不碰 primary），写完**读回校验（复读）**，
 * 不一致就抛错 —— 绑定必须确认落地才算成功（对齐小手机的 attach 语义）。
 */
export async function attachCoordBook(): Promise<void> {
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
export async function detachCoordBook(): Promise<void> {
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
export async function deleteCoordBook(): Promise<string> {
  try {
    await detachCoordBook();
  } catch {
    /* 没挂载或缺绑定接口时直接删书 */
  }
  const ok = await deleteWorldbook(WORLDMAP_BOOK);
  if (!ok) throw new Error(`删除「${WORLDMAP_BOOK}」失败（书可能不存在）`);
  return `已删除「${WORLDMAP_BOOK}」（绑定已一并解除）`;
}
