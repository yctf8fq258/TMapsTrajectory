/**
 * 地点字符串解析：把 MVU 的 `世界.当前地点` / 世界书条目名，变成干净的层级段数组。
 *
 * 实测的难点（见计划书 F3）：
 *   · 层级分隔符统一是 `·`(U+00B7)，但中间偶尔混进 `・`/`•`/`．` 等变体；
 *   · 「地点名」与「环境描述」之间的分隔符**不统一**，`；`/`。`/`，`/`·` 都用过：
 *       中央神州·大周仙朝·神都·慈宁宫·西暖阁内殿；炭盆红亮…   （；）
 *       中央神州·大周仙朝·神都·皇宫·慈宁宫西暖阁·窗外风雪…     （·，早期楼层）
 *       中央神州·阵天宗外围·官道西段·双槐驿至西行官道。日头偏西… （。）
 *   所以这里只做「切描述 + 切段」，**不做**层级语义判断；
 *   真正的层级归属由 graph.ts 拿现有树做贪心最长匹配决定。
 */
import { DESCRIPTION_CUTS, LOC_SEP, SEP_VARIANTS } from './types.js';

/** 世界书条目名上常见的前缀（喂给 AI 时要去掉，否则会被当成地名段） */
const ENTRY_PREFIXES = [
  /^\[MOD\](\[[^\]]*\]){0,4}/,
  /^地点[：:]/,
  /^秘境详情[：:]/,
  /^仙界地点详情[：:]/,
  /^势力详情[：:]/,
  /^势力详细[：:]/,
  /^妖族势力[：:]/,
  /^仙界势力详情[：:]/,
  /^地点[-—]/,
  /^设施[-—]/,
  /^区域[-—]/,
];

const BRACKET_PAIRS: [string, string][] = [
  ['【', '】'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
  ['[', ']'],
  ['（', '）'],
  ['(', ')'],
];

/** 把各种中点变体统一成 `·`，去首尾空白，折叠重复分隔符 */
export function normalize(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  for (const variant of SEP_VARIANTS) {
    if (variant !== LOC_SEP) text = text.split(variant).join(LOC_SEP);
  }
  text = text.replace(/[\u3000\u00a0]/g, ' ').trim();
  text = text.replace(new RegExp(`(${LOC_SEP})\\s*${LOC_SEP}`, 'g'), LOC_SEP);
  text = text.replace(new RegExp(`^${LOC_SEP}+|${LOC_SEP}+$`, 'g'), '');
  return text.trim();
}

/** 去掉世界书条目前缀与包裹括号，得到纯地名 */
export function stripEntryPrefix(raw: string): string {
  let text = normalize(raw);
  for (const pattern of ENTRY_PREFIXES) text = text.replace(pattern, '');
  text = text.trim();
  for (const [open, close] of BRACKET_PAIRS) {
    while (text.startsWith(open) && text.endsWith(close) && text.length > 2) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

/**
 * 切掉环境描述，只留地点名部分。
 * 实测有楼层用 `·` 分隔描述，那种情况这里切不掉，交给 graph 的贪心匹配兜底。
 */
export function cutDescription(raw: string): string {
  const text = normalize(raw);
  let cut = text.length;
  for (const mark of DESCRIPTION_CUTS) {
    const index = text.indexOf(mark);
    if (index >= 0 && index < cut) cut = index;
  }
  return text.slice(0, cut).trim();
}

/** 按 `·` 切段，去空、去重相邻重复 */
export function splitSegments(raw: string): string[] {
  const head = cutDescription(raw);
  const segments = head
    .split(LOC_SEP)
    .map(part => part.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const segment of segments) {
    if (merged.length && merged[merged.length - 1] === segment) continue;
    merged.push(segment);
  }
  return merged;
}

/** 段数组拼回路径 */
export function joinSegments(segments: string[]): string {
  return segments.join(LOC_SEP);
}

/** 稳定的节点 id：按父 id + 段名做 FNV-1a 哈希，跨存档可复现 */
export function nodeId(parentId: string | null, name: string): string {
  const text = `${parentId ?? '^'}/${name}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 'n' + hash.toString(36).padStart(7, '0');
}

/** 纯方位/分区词：「东南部」「极西」「中域腹地」这类只表示方向，不该在地图上变成点 */
const BEARING_NAMES = new Set([
  '东', '南', '西', '北', '中',
  '东部', '南部', '西部', '北部', '中部',
  '东南', '西南', '东北', '西北',
  '东南部', '西南部', '东北部', '西北部',
  '东南方', '西南方', '东北方', '西北方',
  '极东', '极南', '极西', '极北',
  '中域', '中域腹地', '腹地', '内陆', '沿海', '边境', '外围',
  '北地', '南疆', '东荒', '西域',
  '中州东南', '中州西北', '中州东部', '中州西部', '中州南部', '中州北部',
  '北部与极北', '东部与极东', '南部与极南', '西部与极西',
]);

/** 判断一个段是不是「纯方位词」——是的话解析时直接跳过这一层，不建节点 */
export function isBearingSegment(segment: string): boolean {
  const text = segment.trim();
  if (!text) return false;
  if (BEARING_NAMES.has(text)) return true;
  if (/^(东|南|西|北|中)(部|侧|面|方|域|境|隅)$/.test(text)) return true;
  // 「东南方半空」「高空」「地底深处」这类方位+泛指位置的词，不是具体地点
  if (/^((东南|西南|西北|东北|正东|正南|正西|正北|东|南|西|北|中)(部|方|侧)?(的)?)?(半空|上空|高空|深处|地底|水底|地底深处)$/.test(text)) return true;
  return false;
}

/** 仙界相关名字：当前剧情舞台是玄天界，默认不把仙界铺进底图 */
const IMMORTAL_REALM = /(仙域|仙界|天庭|凌霄|界碑关|时空乱流)/;

export function isImmortalRealmName(name: string): boolean {
  return IMMORTAL_REALM.test(name);
}

/**
 * 「不明意义的小点」黑名单：马厩、柴房、水井、某某客房……
 * 这类东西在建筑内部到处都是，画到地图上只会变成蜘蛛网，所以**只对自动新建的节点**生效
 * （种子 / 作者预设 / 人工拖动过的节点一律不动）。
 */
const TRIVIAL_FACILITY = new RegExp(
  '^(' +
    [
      '马厩', '马棚', '牲口棚', '牲畜棚', '鸡舍', '猪圈', '柴房', '柴堆', '灶房', '厨房', '伙房',
      '水井', '井台', '水缸', '水房', '茅房', '茅厕', '净房', '浴房', '澡堂', '汤池',
      '库房', '仓库', '储物间', '储酒间', '杂物间', '账房', '门房', '院门', '大门', '侧门', '角门', '后门',
      '后院', '前院', '跨院', '天井', '回廊', '走廊', '过道', '影壁', '照壁', '围墙', '院墙',
      '菜园', '花园', '花圃', '演武场', '校场', '马道', '石阶', '台阶',
    ].join('|') +
    ')$',
);

/** 后缀型的小点：某某客房 / 某某客舍 / 某某铺子 */
const TRIVIAL_SUFFIX = /(客房|客舍|厢房|耳房|偏房|卧房|寝室|铺子|摊子|小摊|店铺|门脸)$/;

export function isTrivialFacility(name: string): boolean {
  const text = name.trim();
  if (!text) return false;
  if (TRIVIAL_FACILITY.test(text)) return true;
  // 「天字号客房」这种：名字里带房/间/室 且不长，且不是某某宫/殿/阁这类正经建筑
  if (text.length <= 5 && TRIVIAL_SUFFIX.test(text)) return true;
  return false;
}

/** 描述性词素：出现在地点名里基本可以断定这一段是环境描写而不是地名 */
const DESCRIPTION_MARKERS = [
  '的',
  '拍打',
  '明灭',
  '斜落',
  '低垂',
  '半垂',
  '透过',
  '映亮',
  '流转',
  '垂落',
  '氤氲',
  '热气',
  '风声',
  '暮光',
  '晨光',
  '雪停',
  '映着',
  '泛着',
  '漫开',
  '萦绕',
  '拍得',
];

/** 环境描写常见的起首字（窗外/榻上/案头…） */
const DESCRIPTION_HEADS = /^(窗|榻|案|灯|雪|晨|暮|夜|雨|风|云|炉|香|帐|纱|帘|光|影|殿内|屋内|院中|门外)/;

/**
 * 判断一个段是否更像「环境描述」而不是地名（用于贪心建树的止损）。
 * 依据实测样本：合法的深层地名（松烟阁外长巷口/西街尽头/观河桥头）都不含 `的`、
 * 不长于 8 字；而误入的描述段（榻上纱帐半垂/朱红阵纹沿檐角明灭/地火阵烘暖的内寝宫）
 * 都能被下面几条规则命中。
 */
export function looksLikeDescription(segment: string): boolean {
  if (segment.length >= 9) return true;
  if (/[，。；！？、]/.test(segment)) return true;
  if (isTimeLikeName(segment)) return true;
  for (const marker of DESCRIPTION_MARKERS) {
    if (segment.includes(marker)) return true;
  }
  if (DESCRIPTION_HEADS.test(segment)) return true;
  if (/^(有|无|见|听|闻|但|而|却|且|因|遂|乃|则|其|此|那|这)/.test(segment)) return true;
  return false;
}

/** 「戌时铜灯将尽」「23点」这类时刻/更点，AI 偶尔会把它当成当前地点写进来 */
export function isTimeLikeName(name: string): boolean {
  return /^(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)时/.test(name) || /^[0-9０-９]{1,3}(点|时)(半|整)?/.test(name);
}

/**
 * 「整个名字就是垃圾」的强判定（供底图自动清洗用，比 looksLikeDescription 更保守）：
 *   · 名字里带逗号/顿号 —— 地点与描述没切开（慈宁宫西暖阁,戌时铜灯将尽）；
 *   · 空格后面跟着描述（官道西段浅谷至缓坡 官道石面阵纹稀疏）；
 *   · 整串是个时刻（戌时铜灯已燃）；
 *   · 名字长得离谱（≥12 字）或含典型描写词。
 * 只对自动生成的节点清理，种子/预设/人工/锁定一律不碰。
 */
export function isJunkLocationName(name: string): boolean {
  const text = (name ?? '').trim();
  if (!text) return true;
  if (/[，,、;；]/.test(text)) return true;
  const spaceParts = text.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2 && looksLikeDescription(spaceParts[spaceParts.length - 1])) return true;
  if (isTimeLikeName(text)) return true;
  if (/(之后|以前|以后)$/.test(text)) return true;
  if (text.length >= 12) return true;
  for (const marker of ['明灭', '流转', '氤氲', '萦绕', '斜落', '映亮', '低垂', '漫开', '泛着', '拍打', '热气', '褪色']) {
    if (text.includes(marker)) return true;
  }
  return false;
}

/** 从「距神都七百亿里」这类文本里抽方向与距离，供 AI 布局时做提示（不直接决定坐标） */
export function parseBearing(text: string): { dirs: string[]; distance?: number } {
  const dirs: string[] = [];
  const dirPattern = /(正东|正南|正西|正北|东侧|西侧|南侧|北侧|东南|东北|西南|西北|东部|西部|南部|北部|以东|以西|以南|以北|向东|向西|向南|向北|正上方|正下方|地底|地下|高空|深处|湖心|后山|山脚|山顶)/g;
  let match: RegExpExecArray | null;
  while ((match = dirPattern.exec(text))) dirs.push(match[1]);
  const distanceMatch = text.match(/([0-9０-９]+(?:\.[0-9]+)?)\s*(亿里|万里|千里|里)/);
  return { dirs, distance: distanceMatch ? Number(distanceMatch[1]) : undefined };
}
