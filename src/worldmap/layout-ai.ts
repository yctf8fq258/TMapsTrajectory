/**
 * 地图布局 AI：读世界书的地点类条目 → 让模型在十字坐标轴上给出坐标 → 合并进底图。
 *
 * 三个原则：
 *   1. **分批**：世界书 356 条不可能一次喂进去，按「世界骨架 / 区域细分 / 单个城池」三档取条目。
 *   2. **不覆盖人工成果**：locked 或 source==='manual' 的节点坐标一律不动，只记冲突。
 *   3. **绝不半写**：回复解析失败就整体放弃，保留原图并报错。
 */
import type { BaseMap, MapNode, MapSettings, NodeKind } from './types.js';
import { COORD_MAX, COORD_MIN, GEO_ENTRY_PREFIX, WORLDMAP_BOOK } from './types.js';
import { MapGraph } from './graph.js';
import { isBearingSegment, isTrivialFacility, looksLikeDescription } from './path.js';

export interface LocationEntry {
  book: string;
  comment: string;
  content: string;
  keys: string[];
}

export type LayoutScope = 'world' | 'region' | 'all';

/**
 * 条目名以这些词开头 → 算地点类条目。
 *
 * 注意「地点」和「势力」是**裸前缀**（不要求后面跟冒号）：整理世界书时
 * `地点：X`、`地点-X`、`势力：X`、`势力X` 各种写法都出现过。之前只认带冒号的
 * `地点：`/`势力详情：`，结果一整批「势力」条目被漏掉，底图上没有这些宗门。
 */
const LOCATION_COMMENT = /^(地点|势力|秘境详情|妖族势力|设施[-—]|区域[-—])/;
/** 地点类条目正文的特征（导出给自测：坐标条目的 content 必须避开这些写法） */
export const LOCATION_CONTENT = /(驻地\s*[:：]|位置\s*[:：]|相对距离\s*[:：]|空间距离\s*[:：]|距[^，。；]{1,12}[0-9０-９]+\s*亿里)/;

/** 仙界相关条目：当前剧情舞台是玄天界，整套跳过 */
const IMMORTAL_ENTRY = /(仙界|仙域|天庭|瑶池|凌霄|界碑关)/;

/** 世界骨架档固定要取的条目名 */
const WORLD_SKELETON_NAMES = ['玄天界介绍', '玄天界周期性秘境', '秘境详情：蓬莱仙岛'];

/** 剥掉 `[MOD][xxx]` 之类的前缀，拿到真正的条目名 */
export function entryTitle(comment: string): string {
  return comment.replace(/^\[MOD\](\[[^\]]*\]){0,4}/, '').trim();
}

export function isLocationEntry(comment: string, content: string): boolean {
  const name = entryTitle(comment);
  // 自己生成的坐标条目（[舆图] 前缀）绝不是资料 —— 双保险，正常情况下书名已被剔除
  if (name.startsWith(GEO_ENTRY_PREFIX)) return false;
  if (IMMORTAL_ENTRY.test(name)) return false;
  if (LOCATION_COMMENT.test(name)) return true;
  if (comment.startsWith('[MOD]') && /(地点|设施|区域|坊|宫|城|宗|谷|岛)/.test(name)) return true;
  return LOCATION_CONTENT.test(content) && content.length > 60;
}

/** 读当前聊天挂着的所有世界书（角色主书 + 扩展书 + 全局书） */
export async function collectLocationEntries(): Promise<{ entries: LocationEntry[]; books: string[]; total: number }> {
  const names = new Set<string>();
  try {
    const charBooks = getCharWorldbookNames('current') as { primary?: string; additional?: string[] } | undefined;
    if (charBooks?.primary) names.add(charBooks.primary);
    for (const name of charBooks?.additional ?? []) names.add(name);
  } catch (error) {
    window.console.warn('[世界舆图] 读取角色世界书名失败', error);
  }
  try {
    for (const name of getGlobalWorldbookNames()) names.add(name);
  } catch (error) {
    window.console.warn('[世界舆图] 读取全局世界书名失败', error);
  }
  // 关键隔离：插件自建的《世界舆图·坐标表》绝不能当成资料 ——
  // 否则布局 AI 会把自己的坐标条目当输入，自我循环、越铺越歪。
  names.delete(WORLDMAP_BOOK);

  const entries: LocationEntry[] = [];
  let total = 0;
  for (const book of names) {
    try {
      const list = (await getWorldbook(book)) as unknown[];
      total += list.length;
      for (const raw of list) {
        // 注意：JSR 的 WorldbookEntry 用的是 `name`（不是原始 JSON 里的 `comment`），
        // 关键字在 `strategy.keys`（不是 `key`）。这里两种形状都兼容。
        const entry = raw as {
          name?: string;
          comment?: string;
          content?: string;
          key?: string[];
          strategy?: { keys?: (string | RegExp)[] };
        };
        const comment = String(entry?.name ?? entry?.comment ?? '');
        const content = String(entry?.content ?? '');
        if (!content.trim()) continue;
        if (!isLocationEntry(comment, content)) continue;
        const keys = Array.isArray(entry?.strategy?.keys)
          ? entry.strategy.keys.map(String)
          : Array.isArray(entry?.key)
            ? entry.key.map(String)
            : [];
        entries.push({ book, comment, content, keys });
      }
    } catch (error) {
      window.console.warn(`[世界舆图] 读取世界书「${book}」失败`, error);
    }
  }
  entries.sort((a, b) => a.comment.localeCompare(b.comment, 'zh'));
  window.console.info(`[世界舆图] 世界书 ${names.size} 本 / 条目 ${total} 条 / 命中地点类 ${entries.length} 条`);
  return { entries, books: [...names], total };
}

/** 按批次挡位挑选条目 */
export function selectEntries(entries: LocationEntry[], scope: LayoutScope, focusPath?: string): LocationEntry[] {
  if (scope === 'all') return entries;
  if (scope === 'world') {
    return entries.filter(entry => {
      const name = entryTitle(entry.comment);
      if (WORLD_SKELETON_NAMES.some(fixed => name === fixed || name.endsWith(fixed))) return true;
      // 「地点」和「势力」开头的全都要 —— 只收地点会把所有宗门/门派漏掉
      return /^(地点|势力)/.test(name);
    });
  }
  // region：挑与该路径有关联的条目
  const focusSegments = (focusPath ?? '').split('·').filter(Boolean);
  const focusName = focusSegments[focusSegments.length - 1] ?? '';
  return entries.filter(entry => {
    const name = entryTitle(entry.comment);
    if (focusName && (name.includes(focusName) || entry.content.includes(focusName))) return true;
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

export interface AiLayoutNode {
  path: string;
  x: number;
  y: number;
  kind?: NodeKind;
  /** 大区（realm / region）的边界多边形顶点，世界坐标；点状节点不该有 */
  shape?: [number, number][];
  note?: string;
}

/** 宽容地读 shape：只接受 [x,y] 数组，至少 3 个点，坐标落在画布内 */
function sanitizeShape(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const points: [number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const x = Number(item[0]);
    const y = Number(item[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < COORD_MIN - 50 || x > COORD_MAX + 50 || y < COORD_MIN - 50 || y > COORD_MAX + 50) continue;
    points.push([x, y]);
  }
  return points.length >= 3 ? points : undefined;
}

/** 允许 AI 输出的层级：界域/地域/城池/势力/具体地点（不要 room，会糊成一团） */
const ALLOWED_AI_KINDS: NodeKind[] = ['realm', 'region', 'city', 'power', 'site'];

export function buildLayoutPrompt(
  entries: LocationEntry[],
  options: { scope: LayoutScope; focusPath?: string; budget?: number; layoutSupplement?: string },
): { system: string; user: string; used: number; total: number } {
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
  const chunks: string[] = [];
  for (const entry of entries) {
    const body = entry.content.length > 1200 ? entry.content.slice(0, 1200) + '…' : entry.content;
    const chunk = `\n### ${entry.comment}\n${body}\n`;
    if (used + chunk.length > budget) break;
    used += chunk.length;
    chunks.push(chunk);
  }
  const user = `${header}${supplementSection}\n\n世界观资料（校验与补充用）：\n${chunks.join('')}\n\n请输出 JSON。`;
  return { system: SYSTEM_PROMPT, user, used, total: entries.length };
}

/** 宽容解析：剥围栏 → 直接 parse → 修复后再 parse */
export function parseLayoutReply(text: string): AiLayoutNode[] {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) candidates.push(text.slice(firstBrace));

  for (const candidate of candidates) {
    const body = candidate.trim();
    for (const attempt of [body, repairJsonLoose(body)]) {
      try {
        const parsed = JSON.parse(attempt);
        const nodes = Array.isArray(parsed) ? parsed : parsed?.nodes;
        if (!Array.isArray(nodes)) continue;
        const result: AiLayoutNode[] = [];
        for (const node of nodes) {
          const path = String(node?.path ?? '').trim();
          const x = Number(node?.x ?? node?.xy?.[0]);
          const y = Number(node?.y ?? node?.xy?.[1]);
          if (!path || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          result.push({ path, x, y, kind: node?.kind, shape: sanitizeShape(node?.shape), note: node?.note });
        }
        if (result.length) return result;
      } catch {
        /* 试下一种 */
      }
    }
  }
  return [];
}

function repairJsonLoose(text: string): string {
  let body = text.trim();
  const start = body.indexOf('{');
  if (start > 0) body = body.slice(start);
  const lastBrace = body.lastIndexOf('}');
  if (lastBrace >= 0) body = body.slice(0, lastBrace + 1);
  return body.replace(/,\s*([\]}])/g, '$1');
}

export interface LayoutResult {
  added: number;
  moved: number;
  skippedLocked: number;
  skippedBad: number;
  /** 因为"是零碎设施"被丢掉的（马厩/客房之类） */
  skippedTrivial: number;
  conflicts: { path: string; kept: [number, number]; dropped: [number, number] }[];
}

/** 把 AI 给的节点合并进图（就地修改 graph） */
export function mergeAiLayout(graph: MapGraph, nodes: AiLayoutNode[]): LayoutResult {
  const result: LayoutResult = { added: 0, moved: 0, skippedLocked: 0, skippedBad: 0, skippedTrivial: 0, conflicts: [] };
  const sorted = [...nodes].sort((a, b) => a.path.split('·').length - b.path.split('·').length);
  for (const item of sorted) {
    const x = Number(item.x);
    const y = Number(item.y);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < COORD_MIN - 50 ||
      x > COORD_MAX + 50 ||
      y < COORD_MIN - 50 ||
      y > COORD_MAX + 50
    ) {
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
      if (moved) result.conflicts.push({ path: node.path, kept: node.xy, dropped: [x, y] });
      result.skippedLocked++;
      continue;
    }
    const wasNew = resolved.created;
    node.xy = [x, y];
    node.source = 'ai';
    node.status = 'ok';
    if (item.kind) node.kind = item.kind;
    // shape 只对「一片地方」有意义：大区留下，点状节点一律清掉
    const isArea = node.kind === 'realm' || node.kind === 'region';
    node.shape = isArea ? item.shape ?? node.shape : undefined;
    if (item.note) node.note = item.note;
    if (wasNew) result.added++;
    else result.moved++;
  }
  return result;
}

/** 调一次模型（OpenAI 兼容端点，不经过酒馆正文管道）；网络层失败自动重试一次 */
export async function requestLayout(
  settings: MapSettings,
  prompt: { system: string; user: string },
): Promise<{ text: string; usage?: unknown }> {
  // 接口地址必须 trim：粘贴时带上的空格/换行会拼出非法 URL，fetch 直接 Failed to fetch
  const base = settings.api.url.trim().replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const doFetch = async (): Promise<Response> =>
    fetch(endpoint, {
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

  let response: Response;
  try {
    response = await doFetch();
  } catch (firstError) {
    // Failed to fetch = 请求没送达（网络抖动/代理抽风/DNS），不是截断：歇 1 秒重试一次
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      response = await doFetch();
    } catch {
      throw new Error(
        `连不上模型接口（${endpoint}）：网络层失败且重试仍失败。` +
          `先点「测试连接」排查：通了就是临时抖动再点一次整理；不通就检查接口地址、代理/VPN 和网络。` +
          `（原始错误：${String(firstError instanceof Error ? firstError.message : firstError)}）`,
      );
    }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
    usage?: { completion_tokens?: number };
  };
  const choice = data?.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (!text) {
    // 「空回复」几乎都是输出被 max_tokens 掐掉了：有的服务端这时 content 直接是空串，
    // 有的会把已生成的一半塞进 content、finish_reason 是 length。两种都要说清楚。
    const limit = settings.api.maxTokens;
    const used = data?.usage?.completion_tokens;
    if (choice?.finish_reason === 'length') {
      throw new Error(
        `模型输出被「上限」截断（上限 ${limit}${used ? `，已用 ${used}` : ''}）。` +
          `资料太多时模型要吐很长的 JSON，把设置里的「上限」调大到 16384 以上再试。`,
      );
    }
    if (choice?.message?.reasoning_content) {
      throw new Error(
        `模型只返回了思考过程、没有返回 JSON（上限 ${limit}）。` +
          `换一个直接输出答案的模型（名称里带 nothinking / non-thinking 的），或把上限调大。`,
      );
    }
    throw new Error(
      `模型返回为空（上限 ${limit}）。常见原因：上限太小被截断、模型不支持该端点、或服务端把回复放进了别的字段。` +
        `把「上限」调到 16384 以上再试；仍为空就换个模型。`,
    );
  }
  if (choice?.finish_reason === 'length') {
    // 有内容但被截断：多半解析不出完整 JSON，提前给出可操作的提示
    window.console.warn(`[世界舆图] 模型输出被上限截断（${settings.api.maxTokens}），可能解析失败`);
  }
  return { text, usage: data.usage };
}

/** 一次性走完：收集 → 挑选 → 请求 → 合并 */
export async function runLayout(
  graph: MapGraph,
  settings: MapSettings,
  scope: LayoutScope,
  focusPath?: string,
  onProgress?: (message: string) => void,
): Promise<{ result: LayoutResult; used: number; total: number; picked: LocationEntry[]; rawReply: string }> {
  onProgress?.('正在读取世界书…');
  const { entries, books, total } = await collectLocationEntries();
  if (!entries.length) {
    throw new Error(
      `没有读到任何地点类世界书条目（共检查 ${books.length} 本世界书 / ${total} 条条目：` +
        `${books.join('、') || '没读到书名'}）。请确认当前角色卡绑定了世界书。`,
    );
  }
  const picked = selectEntries(entries, scope, focusPath);
  if (!picked.length) {
    throw new Error(
      `世界书里读到了 ${entries.length} 条地点类条目，但这一档（${scope === 'world' ? '世界骨架' : scope === 'region' ? '当前区域' : '全部'}）没筛出可用的。` +
        `换个档位试试，或先用「全部地点」。`,
    );
  }
  const prompt = buildLayoutPrompt(picked, {
    scope,
    focusPath,
    layoutSupplement: settings.layoutSupplement,
  });
  onProgress?.(`已选 ${prompt.total} 条资料（约 ${Math.round(prompt.used / 1000)}k 字符），正在请求模型…`);
  const { text } = await requestLayout(settings, prompt);
  const nodes = parseLayoutReply(text);
  if (!nodes.length) throw new Error('模型返回的内容无法解析出任何节点，已放弃本次生成');
  onProgress?.(`模型返回 ${nodes.length} 个节点，正在合并…`);
  const result = mergeAiLayout(graph, nodes);
  return { result, used: prompt.used, total: prompt.total, picked, rawReply: text };
}

export function graphToBaseMapPatch(graph: MapGraph, base: BaseMap): BaseMap {
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

export function buildHistoryPrompt(
  raws: string[],
  knownPaths: string[],
  budget = 16000,
): { system: string; user: string; used: number; total: number } {
  const known = knownPaths.slice(0, 200).join('\n');
  const list = raws.map((raw, index) => `${index + 1}. ${raw}`).join('\n');
  const user =
    `【已知设定地点】\n${known || '（暂无）'}\n\n【本会话原始地点串】\n${list}\n\n请输出 JSON。`;
  return { system: HISTORY_SYSTEM, user, used: Math.min(user.length, budget), total: raws.length };
}

export interface HistoryFix {
  raw: string;
  path: string;
  x?: number;
  y?: number;
}

/** 宽容解析历史整理回复；只接受 raw 能对回输入清单的条目 */
export function parseHistoryReply(text: string, validRaws: Set<string>): HistoryFix[] {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) candidates.push(text.slice(firstBrace));

  for (const candidate of candidates) {
    const body = candidate.trim();
    for (const attempt of [body, repairJsonLoose(body)]) {
      try {
        const parsed = JSON.parse(attempt) as { items?: { raw?: string; path?: string; x?: number; y?: number }[] };
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        const fixes: HistoryFix[] = [];
        for (const item of items) {
          const raw = String(item?.raw ?? '').trim();
          const path = String(item?.path ?? '').trim();
          if (!raw || !path || !validRaws.has(raw)) continue;
          const x = Number(item?.x);
          const y = Number(item?.y);
          fixes.push({
            raw,
            path,
            x: Number.isFinite(x) ? x : undefined,
            y: Number.isFinite(y) ? y : undefined,
          });
        }
        if (fixes.length) return fixes;
      } catch {
        /* 试下一种 */
      }
    }
  }
  return [];
}
