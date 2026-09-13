/**
 * 坐标世界书 + 地理态势 纯逻辑自测（合成数据，不需要酒馆，可公开入库）：
 *   · 收录范围：tier 过滤 / status 过滤 / 隐藏过滤 / 上限截断
 *   · 绿灯 keys：地名 + 别名表反查（神都 ← 洛阳 / 神都洛阳）
 *   · 内容红线：坐标条目 content 绝不命中 layout-ai 的 LOCATION_CONTENT（防止自产自销进布局 AI）
 *   · 条目组装：蓝灯/绿灯 strategy、at_depth、递归全关
 *   · diff：内容一致跳过写入
 *   · ST 导入格式：双件套产物字段
 *   · geo-context：地界归属（shape 射线法）、周边排序、位移异常提示
 * 用法：node tools/geo-book-test.mjs
 */
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileDir } from './transpile.mjs';

const root = process.cwd();
transpileDir(nodePath.join(root, 'src'), nodePath.join(root, 'dist'));
const dist = nodePath.join(root, 'dist', 'worldmap');

const { MapGraph } = await import(pathToFileURL(nodePath.join(dist, 'graph.js')).href);
const geoBook = await import(pathToFileURL(nodePath.join(dist, 'geo-book.js')).href);
const geoContext = await import(pathToFileURL(nodePath.join(dist, 'geo-context.js')).href);
const layoutAi = await import(pathToFileURL(nodePath.join(dist, 'layout-ai.js')).href);
const types = await import(pathToFileURL(nodePath.join(dist, 'types.js')).href);

const checks = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);

// ── 合成底图 ─────────────────────────────────────────────────────────────
const mk = (path, x, y, kind, extra = {}) => {
  const segments = path.split('·');
  return {
    id: 'x' + path,
    name: segments[segments.length - 1],
    path,
    parentId: null,
    depth: segments.length - 1,
    xy: [x, y],
    kind,
    locked: false,
    source: 'seed',
    status: 'ok',
    ...extra,
  };
};
const rows = [
  mk('中央神州', 0, 0, 'realm'),
  mk('中央神州·神都', 0, 0, 'city'),
  mk('中央神州·蜀山剑门', -47, 0, 'city'),
  mk('中央神州·青崖镇', -41, 3, 'city'),
  mk('中央神州·昆仑道门', -67, 0, 'city'),
  // 一片带轮廓的大区：罩住蜀山/青崖/昆仑一带
  mk('西漠佛国', -155, 0, 'region', { shape: [[-300, -100], [-10, -100], [-10, 100], [-300, 100]] }),
  mk('中央神州·神都·慈宁宫', 0.9, 0.5, 'site'),
  mk('中央神州·神都·慈宁宫·西暖阁', 0.9, 0.6, 'room'),
  mk('中央神州·待定坊', 12, 12, 'city', { status: 'unplaced' }),
  mk('中央神州·黑塔', -5, 5, 'site'),
];
const byPath = new Map(rows.map(row => [row.path, row]));
for (const row of rows) {
  const segments = row.path.split('·');
  if (segments.length > 1) row.parentId = byPath.get(segments.slice(0, -1).join('·'))?.id ?? null;
}
const graph = new MapGraph(rows);
const hiddenIds = [byPath.get('中央神州·黑塔').id];

// ── 收录范围 ─────────────────────────────────────────────────────────────
const picked = geoBook.selectCoordNodes(graph, { includeTier4: true, hiddenIds });
const pickedPaths = picked.map(node => node.path);
check('收录 tier≤3 已确认节点', pickedPaths.includes('中央神州·蜀山剑门') && pickedPaths.includes('中央神州·神都'));
check('tier4 收录已确认城内要点', pickedPaths.includes('中央神州·神都·慈宁宫'));
check('tier5 房间不收录', !pickedPaths.includes('中央神州·神都·慈宁宫·西暖阁'));
check('unplaced 虚线圈不收录', !pickedPaths.includes('中央神州·待定坊'));
check('隐藏节点不收录', !pickedPaths.includes('中央神州·黑塔'));
const narrow = geoBook.selectCoordNodes(graph, { includeTier4: false, hiddenIds });
check('includeTier4=false 时不收城内要点', !narrow.map(n => n.path).includes('中央神州·神都·慈宁宫'));

// ── 条目草稿 ─────────────────────────────────────────────────────────────
const drafts = geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds });
const overview = drafts[0];
check('第 0 条是蓝灯总纲', overview.constant && overview.name === '[舆图]坐标系总纲');
check('总纲原点取 (0,0) 上最具体的节点（神都）', overview.content.includes('「神都」'));
check('总纲含大域锚点', overview.content.includes('中央神州(0,0)') && overview.content.includes('西漠佛国(-155,0)'));
const shushan = drafts.find(draft => draft.name === '[舆图]蜀山剑门');
check('绿灯条目存在', Boolean(shushan));
check('绿灯 keys 含别名（洛阳/神都洛阳 → 神都）', (() => {
  const shendu = drafts.find(draft => draft.name === '[舆图]神都');
  return Boolean(shendu) && shendu.keys.includes('洛阳') && shendu.keys.includes('神都洛阳');
})());
check('绿灯条目有 sticky 跟随', shushan.sticky === 2);
check('坐标条目内容含坐标', shushan.content.includes('中央神州·蜀山剑门 坐标 (-47,0)'));

// 内容红线：绝不能命中 layout-ai 的 LOCATION_CONTENT（否则布局 AI 会把自己的条目当资料）
const redLineOk = drafts.every(draft => !layoutAi.LOCATION_CONTENT.test(draft.content));
check('content 避开 LOCATION_CONTENT 全部命中', redLineOk);
const prefixOk = drafts.every(draft => draft.name.startsWith('[舆图]'));
check('条目名全部带 [舆图] 前缀', prefixOk);
// isLocationEntry 也要拒认自己的条目
check('isLocationEntry 拒认 [舆图] 条目', !layoutAi.isLocationEntry('[舆图]蜀山剑门', shushan.content));

// 上限截断（maxEntries 按契约是「地点条目上限」，总纲另算：2 = 总纲 + 2 个地点）
const capped = geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 2, hiddenIds });
check('maxEntries 截断地点条目（2 = 地点数上限，另有总纲）', capped.length === 3 && capped.slice(1).every(draft => draft.name !== capped[0].name));

// ── 人物移动规则（蓝灯条目，文本存设置）─────────────────────────────────
const rulesText = '[人物移动规则]\n· 各境界日行速度：金丹以下御剑日行数百万里；大乘数秒横跨大陆（2500 亿里 ≈ 170 格）。';
const withRules = geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds, movementRules: rulesText });
const rulesDraft = withRules.find(draft => draft.name === '[舆图]人物移动规则');
check('移动规则：非空时生成蓝灯条目且紧跟总纲', Boolean(rulesDraft) && withRules[1].name === '[舆图]人物移动规则' && rulesDraft.constant);
check('移动规则：内容原样写入', rulesDraft.content === rulesText);
check('移动规则：空文本不生成', !geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds, movementRules: '   ' }).some(draft => draft.name === '[舆图]人物移动规则'));
const withoutRules = geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds });
const existingWithRules = withRules.map(draft => ({ name: draft.name, content: draft.content, strategy: { type: draft.constant ? 'constant' : 'selective', keys: draft.keys } }));
const changedRules = withRules.map(draft =>
  draft.name === '[舆图]人物移动规则' ? { ...draft, content: draft.content + '（用户改过）' } : draft,
);
check('移动规则文本被改 → diff 判定需要写', geoBook.entriesDiffer(existingWithRules, changedRules));
check('移动规则被清空 → diff 判定需要写（条目应移除）', geoBook.entriesDiffer(existingWithRules, withoutRules));

// ── 叙事地理规则（蓝灯条目：坐标权威 + 远方事件隔离）────────────────────
const narrText = '[叙事地理规则]\n· 远处正在发生的事不得在相距遥远的另一处直接上演；坐标数据优先于世界书条目方位。';
const withNarr = geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds, movementRules: rulesText, narrativeRules: narrText });
check('叙事规则：非空时生成蓝灯条目，排在移动规则之后', withNarr[1].name === '[舆图]人物移动规则' && withNarr[2].name === '[舆图]叙事地理规则' && withNarr[2].constant);
check('叙事规则：两个蓝灯条目互不覆盖（都在）', withNarr.some(d => d.name === '[舆图]人物移动规则') && withNarr.some(d => d.name === '[舆图]叙事地理规则'));
check('叙事规则：空文本不生成', !geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds, narrativeRules: '' }).some(d => d.name === '[舆图]叙事地理规则'));
const narrChanged = withNarr.map(draft =>
  draft.name === '[舆图]叙事地理规则' ? { ...draft, content: draft.content + '（用户改过）' } : draft,
);
const existingNarr = withNarr.map(draft => ({ name: draft.name, content: draft.content, strategy: { type: draft.constant ? 'constant' : 'selective', keys: draft.keys } }));
check('叙事规则文本被改 → diff 判定需要写', geoBook.entriesDiffer(existingNarr, narrChanged));

// ── 默认规则文本（设置页预填，用户不必手动复制）──────────────────────────
check('默认移动规则非空且含关键口径', types.DEFAULT_MOVEMENT_RULES.includes('1 坐标格 ≈ 15 亿里') && types.DEFAULT_MOVEMENT_RULES.includes('严禁降级移动'));
check('默认叙事规则非空且含坐标权威与事件隔离', types.DEFAULT_NARRATIVE_RULES.includes('地点权威') && types.DEFAULT_NARRATIVE_RULES.includes('不得在相距遥远的另一处直接上演'));
check('默认设置里两段规则已预填且默认启用', (() => {
  const book = types.DEFAULT_COORD_BOOK;
  return book.movementRules === types.DEFAULT_MOVEMENT_RULES && book.narrativeRules === types.DEFAULT_NARRATIVE_RULES && book.movementRulesEnabled === true && book.narrativeRulesEnabled === true;
})());
const defaultDrafts = geoBook.buildCoordDrafts(graph, {
  includeTier4: true,
  maxEntries: 200,
  hiddenIds,
  movementRules: types.DEFAULT_MOVEMENT_RULES,
  narrativeRules: types.DEFAULT_NARRATIVE_RULES,
});
check('用默认文本能生成两条蓝灯规则条目（顺序：总纲 → 移动 → 叙事）',
  defaultDrafts[0].name === '[舆图]坐标系总纲' && defaultDrafts[1].name === '[舆图]人物移动规则' && defaultDrafts[2].name === '[舆图]叙事地理规则');

// ── 轨迹来源的点一律不进书（硬规则，含锁定/手调的）────────────────────────
const trailRows = [
  mk('某域', 0, 0, 'realm'),
  mk('某域·设定城', 10, 10, 'city'),
  mk('某域·玩出来的镇', 20, 20, 'city', { source: 'trail' }),
  mk('某域·玩出来的镇·茶棚', 20.5, 20.5, 'site', { source: 'trail', locked: true }),
];
trailRows[1].parentId = trailRows[0].id;
trailRows[2].parentId = trailRows[0].id;
trailRows[3].parentId = trailRows[2].id;
const trailGraph = new MapGraph(trailRows);
const kept = geoBook.selectCoordNodes(trailGraph, { includeTier4: true });
check('轨迹地点（含锁定/手调的）一律不进书', !kept.some(node => node.source === 'trail'));
check('设定地点照旧进书', kept.some(node => node.path === '某域·设定城'));
const dropped = geoBook.buildCoordDrafts(trailGraph, { includeTier4: true, maxEntries: 200 });
check('硬规则能一路传到条目生成', !dropped.some(draft => draft.content.includes('玩出来的镇')));

// ── 手动层级覆盖（编辑页下拉）───────────────────────────────────────────
const mkTier = (path, x, y, kind, tier) => {
  const segments = path.split('·');
  return { id: 't' + path, name: segments[segments.length - 1], path, parentId: null, depth: segments.length - 1, xy: [x, y], kind, locked: false, source: 'seed', status: 'ok', ...(tier ? { tier } : {}) };
};
const tierRows = [mkTier('界域', 0, 0, 'realm'), mkTier('界域·小城', 5, 5, 'city', 4), mkTier('界域·高塔', -5, 5, 'site', 5)];
tierRows[1].parentId = tierRows[0].id;
tierRows[2].parentId = tierRows[0].id;
const tierGraph = new MapGraph(tierRows);
const tierScope = geoBook.selectCoordNodes(tierGraph, { includeTier4: false });
check('tier 覆盖：city 被手动降为 4 后，不含 tier4 时不再收录', !tierScope.some(node => node.path === '界域·小城'));
check('tier 覆盖：手动设为 5 的地点永不收录', !geoBook.selectCoordNodes(tierGraph, { includeTier4: true }).some(node => node.path === '界域·高塔'));
check('tier 覆盖：含 tier4 时手动 4 的城池收录', geoBook.selectCoordNodes(tierGraph, { includeTier4: true }).some(node => node.path === '界域·小城'));
const noTier = geoBook.buildCoordDrafts(tierGraph, { includeTier4: false });
check('tier 覆盖：总纲锚点不受影响（界域仍在）', noTier[0].content.includes('界域(0,0)'));

// ── 生成底图提示词：方位补充表三层注入 ──────────────────────────────────
check('系统提示词写明三层优先级与冲突裁决', (() => {
  const system = layoutAi.buildLayoutPrompt([], { scope: 'world', existing: [] }).system;
  return system.includes('输入分三层') && system.includes('以补充表为准') && system.includes('相对神都的方位+距离 > 补充表内的相对关系 > 世界书条目');
})());
const promptWith = layoutAi.buildLayoutPrompt([], { scope: 'world', existing: [], layoutSupplement: '蜀山剑门-西-700' }).user;
check('用户提示词：补充表非空时整段注入且标注最高优先', promptWith.includes('【方位补充表】') && promptWith.includes('蜀山剑门-西-700') && promptWith.includes('校验合理性与补充细节'));
const promptWithout = layoutAi.buildLayoutPrompt([], { scope: 'world', existing: [], layoutSupplement: '   ' }).user;
check('用户提示词：补充表为空时不注入该段', !promptWithout.includes('【方位补充表】'));

// ── 条目组装 / diff / ST 转换 ────────────────────────────────────────────
const { entries } = geoBook.buildWorldbookEntries(graph, { includeTier4: true, maxEntries: 200, hiddenIds });
const green = entries.find(entry => entry.name === '[舆图]蜀山剑门');
const blue = entries[0];
check('绿灯 strategy.type=selective + scan_depth 3', green.strategy.type === 'selective' && green.strategy.scan_depth === 3);
check('蓝灯 strategy.type=constant + scan_depth same_as_global', blue.strategy.type === 'constant' && blue.strategy.scan_depth === 'same_as_global');
check('at_depth 插入（总纲 4 / 地点 2）', blue.position.type === 'at_depth' && blue.position.depth === 4 && green.position.depth === 2);
check('递归全关', green.recursion.prevent_incoming && green.recursion.prevent_outgoing && blue.recursion.prevent_incoming);

const existingSame = entries.map(entry => ({ name: entry.name, content: entry.content, strategy: { type: entry.strategy.type, keys: entry.strategy.keys } }));
check('内容一致 → diff 判定不写入', !geoBook.entriesDiffer(existingSame, geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds })));
const changed = existingSame.map(entry => (entry.name === '[舆图]蜀山剑门' ? { ...entry, content: entry.content + '（人改过）' } : entry));
check('内容被改 → diff 判定需要写', geoBook.entriesDiffer(changed, geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds })));
check('条目数不同 → 需要写', geoBook.entriesDiffer(existingSame.slice(0, 2), geoBook.buildCoordDrafts(graph, { includeTier4: true, maxEntries: 200, hiddenIds })));

const st = geoBook.toSillyTavernBook(drafts);
const stGreen = st.entries['1'];
check('ST 格式：绿灯 constant=false selective=true key 非空', stGreen.constant === false && stGreen.selective === true && Array.isArray(stGreen.key) && stGreen.key.length > 0);
check('ST 格式：at_depth(position 4) + system + disable=false', stGreen.position === 4 && stGreen.role === 'system' && stGreen.disable === false);
check('ST 格式：递归禁用 + sticky 保留', stGreen.excludeRecursion === true && stGreen.preventRecursion === true && stGreen.sticky === 2);

// ── geo-context：地界 / 周边 / 位移 ──────────────────────────────────────
const shushanRow = byPath.get('中央神州·蜀山剑门');
const shenduRow = byPath.get('中央神州·神都');
const points = [
  { id: '0-0', messageId: 0, swipeId: 0, t: 't0', nodeId: shenduRow.id, path: shenduRow.path, xy: [0, 0], posSrc: 'ai', kind: 'move', seq: 1 },
  { id: '1-0', messageId: 1, swipeId: 0, t: 't1', nodeId: shushanRow.id, path: shushanRow.path, xy: [-45, 1], posSrc: 'ai', kind: 'move', seq: 2 },
];
const result = geoContext.buildGeoContext({
  graph,
  points,
  nearbyCount: 6,
  enforceBounds: true,
  jumpNotice: true,
  hiddenIds,
});
check('态势块存在', Boolean(result));
check('位置为蜀山剑门', result.path === '中央神州·蜀山剑门');
check('地界归属：射线法判进西漠佛国的轮廓', result.territory?.path === '西漠佛国');
check('内容含地界规则（L1）', result.content.includes('地界规则'));
check('内容含当前位置与周边', result.content.includes('当前位置：中央神州·蜀山剑门 (-45,1)') && result.content.includes('周边：'));
check('祖先链不进周边（中央神州是祖先，被排除）', !result.content.includes('中央神州(0,0)'));
check('兄弟城市进周边（神都是蜀山的兄弟，45 格）', result.content.includes('神都(0,0) 45'));
check('近距 45 格不触发位移提示', result.jump === null && !result.content.includes('位移提示'));

const farPoints = [
  points[0],
  { ...points[1], xy: [-220, 1], seq: 2 },
];
const farResult = geoContext.buildGeoContext({ graph, points: farPoints, nearbyCount: 6, enforceBounds: true, jumpNotice: true, hiddenIds });
check('跳变 220 格触发远行提示', farResult.jump !== null && farResult.content.includes('[位移提示]'));
check('跳变后仍在西漠佛国地界内', farResult.territory?.path === '西漠佛国');

check('空轨迹返回 null', geoContext.buildGeoContext({ graph, points: [], nearbyCount: 6, enforceBounds: true, jumpNotice: true }) === null);
check('射线法负例（轮廓外不算）', !geoContext.pointInPolygon([100, 100], [[-300, -100], [-10, -100], [-10, 100], [-300, 100]]));

// ── 汇总 ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} 项未通过` : `\n全部通过（${checks.length} 项）`);
process.exitCode = failed ? 1 : 0;
