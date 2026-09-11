/**
 * 内置世界骨架种子（作者预设的源头）。
 *
 * 数据来源：世界书 `《道渊》v5.4.2.json` 的 uid 23《玄天界介绍》、uid 27《地点：中央神州》、
 * uid 89/114/115/243《地点：X》、uid 78《势力详情：南梁古国》等条目里**明确的方位+距离**描述
 * （见 docs/计划书-世界舆图插件.md 的 F20 与摘录 1~6）。
 *
 * 投影约定：**1 单位 = 15 亿里**，**神都洛阳 = (0,0)**；正东 +x、正南 +y，向西/向北为负。
 *   玄天界方圆约 15000 亿里 → 1000 单位（-500..500）；中央神州边长 3000 亿里 → 200 单位；
 *   四条边界天堑宽 3000 亿里、天堑外即四方地域。
 *
 * ⚠️ 下面表格里的 x/y 写的是**图纸坐标**（0..1000，西北角为原点）—— 这样能照世界书里
 * 「东西多少亿里 / 南北多少亿里」直接量。构造节点时会统一减去 SHEET_ORIGIN，换算成世界坐标。
 * 只有世界书里写死了方位与距离的点才放进种子；其余交给地图布局 AI 或人工拖动。
 */
import type { MapNode, NodeKind, Vec2 } from './types.js';
import { nodeId } from './path.js';

/** [完整路径, x, y, kind, 高度(里), 备注] */
type SeedRow = [string, number, number, NodeKind?, number?, string?];

const DEGREE = 15; // 亿里 / 单位

/** 图纸坐标 → 世界坐标 的平移量：图纸上的 (500,500) 是神都，世界坐标里它就是 (0,0) */
const SHEET_ORIGIN = 500;

/**
 * 把「距神都 N 亿里 + 方位」换算成**图纸坐标**（与上面表格同一套，构造节点时统一平移）。
 * bearing：0 = 正北，90 = 正东，180 = 正南，270 = 正西。
 */
export function offsetFromGodCapital(distanceYi: number, degrees: number, bearing: number): Vec2 {
  const radius = distanceYi / DEGREE;
  const radians = ((bearing - 90) * Math.PI) / 180;
  return [round(SHEET_ORIGIN + Math.cos(radians) * radius), round(SHEET_ORIGIN + Math.sin(radians) * radius)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const rows: SeedRow[] = [
  // ── 四域（十字轴，中央神州居中）──────────────────────────────────────
  ['中央神州', 500, 500, 'region', 0, '玄天界地理中心，边长约 3000 亿里，神都洛阳居中'],
  ['东极青木域', 700, 500, 'region', 0, '最东方，南北跨度 4500 亿里、东西纵深 3800 亿里'],
  ['西漠佛国', 300, 500, 'region', 0, '最西方，南北 3500 亿里、东西 2500 亿里'],
  ['南离火洲', 500, 700, 'region', 0, '最南方，东西 4000 亿里、南北 3000 亿里'],
  ['北冥雪原', 500, 300, 'region', 0, '最北方，东西 3500 亿里、南北 2800 亿里'],

  // ── 四条边界天堑 ──────────────────────────────────────────────────────
  ['中央神州·无尽山脉', 600, 500, 'region', 0, '东侧边界，南北走向 3000 亿里、宽 300 亿里'],
  ['中央神州·叹息沙海', 400, 500, 'region', 0, '西侧边界，3000 亿里长、宽 120 亿里'],
  ['中央神州·烬骨荒原', 500, 600, 'region', 0, '南侧边界，3000 亿里长、宽 80 亿里'],
  ['中央神州·绝迹冰谷', 500, 400, 'region', 0, '北侧边界，3000 亿里长、裂隙宽 35 亿里'],

  // ── 中央神州：中域腹地 ────────────────────────────────────────────────
  ['中央神州·大周仙朝', 500, 500, 'power', 0, '核心统辖，主城神都洛阳'],
  ['中央神州·大周仙朝·神都', 500, 500, 'city', 0, '大周仙朝都城，太初山上的仙都'],
  ['中央神州·阵天宗', 514, 514, 'power', 0, '距神都 300 亿里，位于千阵岭'],
  ['中央神州·万宝楼', 503, 497, 'power', 0, '商号组织，中域'],
  ['中央神州·黑金阁', 505, 495, 'power', 0, '暗市组织，中域'],
  ['中央神州·斩仙盟', 502, 506, 'power', 0, '中域同盟'],
  ['中央神州·天机阁', 498, 498, 'power', 0, '推演天机，中域'],

  // ── 中央神州：各方势力（方位词只用来算坐标，本身不建节点）────────────
  ['中央神州·蜀山剑门', ...offsetFromGodCapital(700, 0, 270), 'power', 0, '距神都向西 700 亿里'],
  ['中央神州·昆仑道门', ...offsetFromGodCapital(1000, 0, 270), 'power', 0, '距神都向西 1000 亿里，昆仑神山'],
  ['中央神州·青玉宗', 410, 545, 'power', 0, '青音湖，距蜀山 500 亿里、距百花谷 200 亿里'],
  ['中央神州·湮丹宗', ...offsetFromGodCapital(800, 0, 90), 'power', 0, '杏临谷，距神都 800 亿里'],
  ['中央神州·万法宗', ...offsetFromGodCapital(1200, 0, 135), 'power', 0, '万法天仪仙城，距神都 1200 亿里'],
  ['中央神州·灵墟宗', 584, 557, 'power', 0, '灵兽原，距万法宗 400 亿里'],
  ['中央神州·符韵门', ...offsetFromGodCapital(600, 0, 90), 'power', 0, '云符山，距神都 600 亿里'],
  ['中央神州·星道宗', 500, 460, 'power', 3_000_000_000, '云符山正上方 30 亿里高空的摘星悬岛'],
  ['中央神州·南梁古国', 520, 537, 'power', 0, '洛阳以南 550 亿里，东临无尽海、西靠云梦大泽'],
  ['中央神州·百花坊', 525, 530, 'city', 0, '百花谷外的坊市，合欢宗明线'],
  ['中央神州·合欢宗', 526, 531, 'power', 0, '明线距神都 400 亿里，位于百花谷'],

  // ── 西漠佛国 ──────────────────────────────────────────────────────────
  ['西漠佛国·须弥山·大雷音寺', 372, 500, 'power', 0, '距神都 1920 亿里，向东 300 亿里入叹息沙海'],

  // ── 北冥雪原 ──────────────────────────────────────────────────────────
  ['北冥雪原·广寒宫', 500, 320, 'power', 0, '雪原深处，向南 1500 亿里至绝迹冰谷边缘'],
  ['北冥雪原·北冥黑渊·水晶龙宫', 500, 320, 'power', -6_666_667, '广寒宫正下方地底一千万里，蛟龙一族'],
  ['北冥雪原·星辰塔', 520, 290, 'site', 0, '每三百年在上空浮现，九十九层'],

  // ── 南离火洲 ──────────────────────────────────────────────────────────
  ['南离火洲·万丈火山·太阳神宫', 520, 700, 'power', 0, '火山区域核心统辖'],
  ['南离火洲·葬仙坡·尸魔宗', 505, 660, 'power', 0, '烬骨荒原南侧边缘，向南 200 亿里为血海'],
  ['南离火洲·血神宫', 520, 680, 'power', 0, '距太阳神宫西南'],
  ['南离火洲·万魂殿', 480, 690, 'power', 0, '阴风山脉万鬼窟'],

  // ── 东极青木域 ────────────────────────────────────────────────────────
  ['东极青木域·万妖山脉·神猿族', 640, 500, 'power', 0, '向西跨 300 亿里无尽山脉至中州'],
  ['东极青木域·青丘·九尾天狐族', 760, 470, 'power', 0, '向东 1200 亿里至青丘'],
  ['东极青木域·沂云森林', 700, 470, 'region', 0, '东部'],
  ['东极青木域·落凤坡·五色孔雀族', 720, 560, 'power', 0, '南部'],
  ['东极青木域·蓬莱仙岛', 900, 500, 'site', 0, '每六十年在青木域极东出现一次'],
];

/** 神都内部（同心结构：宫城区 › 四区 › 六坊 › 环墟），坐标在同一点附近做微偏移以便观察 */
const godCapitalRows: SeedRow[] = [
  ['中央神州·大周仙朝·神都·宫城区', 500, 500, 'city', 0, '太初山顶，皇城与镇魔司'],
  ['中央神州·大周仙朝·神都·宫城区·慈宁宫', 500.9, 500.35, 'site', 0, '圣德太后寝宫'],
  ['中央神州·大周仙朝·神都·宫城区·长乐坊', 499.4, 500.6, 'site', 0, '宫外坊市'],
  ['中央神州·大周仙朝·神都·宫城区·镇魔司', 501.2, 499.7, 'power', 0, '北镇抚司档房'],
  ['中央神州·大周仙朝·神都·四区', 500.6, 501.1, 'city', 0, '山腰与内城四区'],
  ['中央神州·大周仙朝·神都·六坊', 501.4, 502, 'city', 0, '城墙内外的六坊'],
  ['中央神州·大周仙朝·神都·环墟', 502.4, 502.9, 'city', 0, '城墙外的环墟'],
];

function expand(source: SeedRow[], sourceTag: MapNode['source']): MapNode[] {
  const byPath = new Map<string, MapNode>();
  const result: MapNode[] = [];
  for (const [path, x, y, kind, altitude, note] of source) {
    const segments = path.split('·');
    let parentId: string | null = null;
    let accumulated = '';
    segments.forEach((name, index) => {
      accumulated = index === 0 ? name : `${accumulated}·${name}`;
      const isLast = index === segments.length - 1;
      const existing = byPath.get(accumulated);
      if (existing) {
        parentId = existing.id;
        if (isLast) {
          existing.xy = [x, y];
          if (kind) existing.kind = kind;
          if (typeof altitude === 'number') existing.altitude = altitude;
          if (note) existing.note = note;
          existing.locked = true;
          existing.status = 'ok';
        }
        return;
      }
      const id = nodeId(parentId, name);
      const node: MapNode = {
        id,
        name,
        path: accumulated,
        parentId,
        depth: index,
        xy: [round(x - SHEET_ORIGIN), round(y - SHEET_ORIGIN)],
        kind: isLast ? kind ?? 'poi' : index === 0 ? 'realm' : 'region',
        altitude: isLast && typeof altitude === 'number' ? altitude : undefined,
        locked: isLast,
        source: sourceTag,
        status: isLast ? 'ok' : 'ok',
        note: isLast ? note : undefined,
      };
      byPath.set(accumulated, node);
      result.push(node);
      parentId = id;
    });
  }
  return result;
}

/** 世界骨架：世界书里明确写了方位/距离的点 */
export const SEED_NODES: MapNode[] = expand(rows, 'seed');

/** 神都内部细节：世界书《洛阳扩展》里的同心四区 */
export const SEED_CAPITAL_NODES: MapNode[] = expand(godCapitalRows, 'seed');

export const SEED_ALL: MapNode[] = [...SEED_NODES, ...SEED_CAPITAL_NODES].filter(
  (node, index, list) => list.findIndex(item => item.id === node.id) === index,
);
