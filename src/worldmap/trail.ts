/**
 * 轨迹重建：从每一楼 assistant 消息的 <JSONPatch> 里抽取地点与坐标，连成轨迹。
 *
 * 为什么从消息里重建而不是只监听 MVU 事件：
 *   消息级 variables 实测恒为 {}（没有逐楼快照），而 <UpdateVariable> 块被正则
 *   `[不发送]去除变量更新` 从**请求**里剥掉了，但**存档原文仍在**。所以扫消息是
 *   唯一能拿到"历史每一回合位置"的办法，而且天然支持编辑/删除/重 roll 后自动纠正。
 */
import type { MapNode, MessageMapInfo, Trail, TrailKind, TrailPoint, Vec2 } from './types.js';
import { COORD_MAX, COORD_MIN } from './types.js';
import { isVec2, MapGraph } from './graph.js';
import { normalize } from './path.js';

interface ChatMessageLike {
  message: string;
  is_user?: boolean;
  swipe_id?: number;
}

const PATCH_BLOCK = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/i;
const PATCH_BLOCK_OPEN = /<JSONPatch>([\s\S]*)$/i;
const UPDATE_BLOCK = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i;

/** 剥掉 ``` 围栏 */
function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  if (match) return match[1].trim();
  return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
}

/** 宽容 JSON 修复：去尾逗号、补齐未闭合的括号、去掉块内杂散文字 */
export function repairJson(text: string): string {
  let body = stripFence(text);
  const firstBracket = body.indexOf('[');
  const firstBrace = body.indexOf('{');
  const start =
    firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
  if (start > 0) body = body.slice(start);
  body = body.replace(/,\s*([\]}])/g, '$1');
  body = body.replace(/\/\/[^\n]*/g, '');
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '[' || character === '{') stack.push(character);
    else if (character === ']' || character === '}') stack.pop();
  }
  if (stack.length) {
    const tail = [...stack].reverse().map(open => (open === '[' ? ']' : '}')).join('');
    body = body.replace(/,\s*$/, '') + tail;
  }
  return body;
}

/** 解析 <JSONPatch> 里的 patch 数组；拿不到就返回 null（调用方静默跳过这一楼） */
export function parseJsonPatch(mes: string): any[] | null {
  if (!mes || mes.indexOf('JSONPatch') < 0) return null;
  const block = mes.match(PATCH_BLOCK) ?? mes.match(PATCH_BLOCK_OPEN);
  if (!block) return null;
  for (const candidate of [stripFence(block[1]), repairJson(block[1])]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 继续尝试下一种修复 */
    }
  }
  return null;
}

function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/^\/?stat_data\/?/, '/').replace(/^stat_data/, '') || '';
}

/** 从一条 assistant 消息里抽出 `地图` 变量与 `世界.当前地点/当前时间` */
export function extractMessageMapInfo(mes: string): MessageMapInfo {
  const info: MessageMapInfo = {};
  const ops = parseJsonPatch(mes);
  if (!ops) return info;
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const key = normalizePath(op.path);
    const kind = String(op.op ?? '');
    if (kind === 'remove' || kind === 'move') continue;
    if (key === '/地图' && op.value && typeof op.value === 'object') {
      info.mapVar = { ...(op.value as Record<string, unknown>) } as MessageMapInfo['mapVar'];
      continue;
    }
    if (key.startsWith('/地图/')) {
      const field = key.slice('/地图/'.length);
      info.mapVar = info.mapVar ?? {};
      (info.mapVar as Record<string, unknown>)[field] = op.value;
      continue;
    }
    if (key === '/世界/当前地点' && typeof op.value === 'string') info.location = op.value;
    else if (key === '/世界/当前时间' && typeof op.value === 'string') info.time = op.value;
  }
  return info;
}

/** 上一楼层里 `<UpdateVariable>` 外部的正文（用于兜底：正文里直接写了「当前地点：X」） */
export function extractLooseLocation(mes: string): string | undefined {
  const withoutUpdate = mes.replace(UPDATE_BLOCK, '');
  const match = withoutUpdate.match(/(?:当前地点|所在地点|位置)\s*[：:]\s*([^\n，。；]{2,80})/);
  return match ? match[1].trim() : undefined;
}

export interface RebuildResult {
  trail: Trail;
  /** 本次重建新出现、需要写回底图的节点数量 */
  createdNodes: number;
  /** 坐标可疑的楼层 */
  anomalies: { messageId: number; reason: string }[];
  /** 保留下来但对应楼层已经不在聊天里的点（被大总结删楼/被覆盖） */
  orphanCount: number;
}

export interface RebuildOptions {
  messages: ChatMessageLike[];
  graph: MapGraph;
  hiddenPointIds?: string[];
  /**
   * 上一版轨迹。两个作用：
   *   1. 给每个点分配稳定的 seq —— 就算楼层被大总结删掉导致 messageId 整体前移，顺序也不会乱；
   *   2. 保住那些楼层已经不在聊天里的点（标记 orphan 继续画），避免"用大总结就丢轨迹"。
   */
  previous?: Trail | null;
  /** 相邻点距离超过该值且层级跳跃不足时，视为坐标异常 */
  jumpLimit?: number;
  /**
   * 「AI 整理本会话地点」的规范化结果：原始地点串（normalize 后的 key）→ 干净路径 [→ 相对坐标]。
   * 命中时直接按干净路径解析，绕过脏字符串；坐标只在当层没有更可靠来源时兜底。
   */
  pathFixes?: Trail['pathFixes'];
}

/** 全量重建轨迹 */
export function rebuildTrail(options: RebuildOptions): RebuildResult {
  const { messages, graph } = options;
  const jumpLimit = options.jumpLimit ?? 150;
  const points: TrailPoint[] = [];
  const anomalies: { messageId: number; reason: string }[] = [];
  let createdNodes = 0;
  let previous: TrailPoint | null = null;

  messages.forEach((message, messageId) => {
    if (!message || message.is_user) return;
    const raw = typeof message.message === 'string' ? message.message : '';
    if (!raw) return;
    const info = extractMessageMapInfo(raw);
    const locationRaw = info.location ?? info.mapVar?.层级;
    const loose = locationRaw ? undefined : extractLooseLocation(raw);
    const source = locationRaw ?? loose;
    if (!source && !info.mapVar?.坐标) return;

    // 「AI 整理本会话地点」的规范化结果优先：命中就绕过脏字符串直接用干净路径
    const fix = source ? options.pathFixes?.[normalize(source)] : undefined;
    const pathText = fix?.path ?? normalize(source ?? '');
    const resolved = pathText ? graph.resolve(pathText, { create: true, source: 'trail' }) : null;
    if (resolved?.created) createdNodes++;
    const node: MapNode | null = resolved?.node ?? null;
    if (!node) return;

    // 坐标优先用 AI 给的值，其次用已知坐标，最后用自动落点
    let posSrc: TrailPoint['posSrc'] = 'auto';
    let xy: Vec2 = node.xy;
    const aiCoord = info.mapVar?.坐标;
    if (isVec2(aiCoord)) {
      const candidate: Vec2 = [Number(aiCoord[0]), Number(aiCoord[1])];
      const sane =
        candidate[0] >= COORD_MIN - 20 &&
        candidate[0] <= COORD_MAX + 20 &&
        candidate[1] >= COORD_MIN - 20 &&
        candidate[1] <= COORD_MAX + 20 &&
        (!previous || distance(previous.xy, candidate) <= jumpLimit || node.depth <= 1);
      if (sane) {
        xy = candidate;
        posSrc = 'ai';
        if (!node.locked) {
          node.xy = xy;
          if (node.status === 'unplaced' && node.source === 'trail') node.status = 'ok';
        }
      } else {
        anomalies.push({ messageId, reason: `坐标跳变过大或越界：${JSON.stringify(candidate)}` });
      }
    } else if (node.source !== 'trail' || node.status === 'ok') {
      posSrc = 'lookup';
    }
    // 整理结果里带了相对坐标、且这一层没有更可靠的来源 → 用它兜底
    if (posSrc === 'auto' && fix && Number.isFinite(Number(fix.x)) && Number.isFinite(Number(fix.y)) && !node.locked) {
      xy = [Number(fix.x), Number(fix.y)];
      posSrc = 'ai';
      node.xy = xy;
      if (node.status === 'unplaced' && node.source === 'trail') node.status = 'ok';
    }

    if (typeof info.mapVar?.高度 === 'number') node.altitude = info.mapVar.高度;

    const point: TrailPoint = {
      id: `${messageId}-${message.swipe_id ?? 0}`,
      messageId,
      swipeId: message.swipe_id ?? 0,
      t: info.time ?? (typeof info.mapVar?.时间 === 'string' ? info.mapVar.时间 : ''),
      nodeId: node.id,
      path: node.path,
      xy,
      posSrc,
      kind: classify(previous, node, xy, jumpLimit),
    };
    points.push(point);
    previous = point;
  });

  // ── 与上一版轨迹合并：分配稳定 seq + 保住被删楼层的点 ──────────────────
  const stored = options.previous?.points ?? [];
  const keyOf = (point: { t: string; path: string }) => `${point.t}|${point.path}`;
  const byContent = new Map(stored.map(point => [keyOf(point), point]));
  const byMessage = new Map(stored.map(point => [point.messageId, point]));
  let nextSeq = stored.reduce((max, point) => Math.max(max, point.seq ?? 0), 0) + 1;
  for (const point of points) {
    // 优先按「时间+地点」认领旧序号：删楼会让 messageId 整体前移，按楼层认领会串位
    const matched = byContent.get(keyOf(point)) ?? byMessage.get(point.messageId);
    point.seq = matched?.seq ?? nextSeq++;
  }

  const covered = new Set(points.map(point => keyOf(point)));
  const liveMessages = new Set(points.map(point => point.messageId));
  let orphanCount = 0;
  for (const old of stored) {
    if (liveMessages.has(old.messageId)) continue;
    if (covered.has(keyOf(old))) continue;
    if (!old.path) continue;
    points.push({ ...old, orphan: true });
    orphanCount++;
  }
  points.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const trail: Trail = {
    schemaVersion: 1,
    points,
    hiddenPointIds: options.hiddenPointIds ?? [],
    // 规范化结果必须跟着 trail 走：否则第一次重算就把「AI 整理」冲掉，重开会话又全乱
    pathFixes: options.pathFixes,
  };
  return { trail, createdNodes, anomalies, orphanCount };
}

function classify(previous: TrailPoint | null, node: MapNode, xy: Vec2, jumpLimit: number): TrailKind {
  if (!previous) return 'move';
  if (previous.nodeId === node.id) return 'stay';
  const previousDepth = previous.path.split('·').length;
  const depth = node.path.split('·').length;
  if (Math.abs(depth - previousDepth) >= 2) return 'travel';
  if (distance(previous.xy, xy) > jumpLimit) return 'travel';
  return 'move';
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 收集本会话出现过的**原始地点串**（去重、保序），供「AI 整理本会话地点」发给模型。
 * 只取结构化来源（世界.当前地点 / 地图.层级）；正文兜底那种太脏，不进 AI 清单。
 */
export function collectRawLocations(messages: ChatMessageLike[], limit = 120): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    if (!message || message.is_user) continue;
    const info = extractMessageMapInfo(String(message.message ?? ''));
    const raw = info.location ?? info.mapVar?.层级;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/** 把轨迹里连续重复的坐标合并，供画线使用。孤儿点（楼层已不在聊天里）不参与连线与绘制 */
export function polylinePoints(points: TrailPoint[], hidden: Set<string>): TrailPoint[] {
  const visible = points.filter(point => !hidden.has(point.id) && !point.orphan);
  const result: TrailPoint[] = [];
  for (const point of visible) {
    const last = result[result.length - 1];
    if (last && last.nodeId === point.nodeId && last.xy[0] === point.xy[0] && last.xy[1] === point.xy[1]) {
      result[result.length - 1] = { ...last, kind: point.kind, messageId: point.messageId, id: point.id, t: point.t || last.t };
      continue;
    }
    result.push(point);
  }
  return result;
}
