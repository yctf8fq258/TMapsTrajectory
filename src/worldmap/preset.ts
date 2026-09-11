/**
 * 底图来源与合并：
 *   内置骨架（seed.ts） → 作者预设（GitHub/jsdelivr 上的 JSON） → 本地修正
 * 合并规则：locked / manual 的节点永不被覆盖，其余按来源优先级更新。
 */
import type { BaseMap, MapNode } from './types.js';
import { migrateBaseMap } from './types.js';
import { MapGraph, toBaseMap } from './graph.js';
import { SEED_ALL } from './seed.js';

export function seedBaseMap(name = '内置世界骨架'): BaseMap {
  const graph = new MapGraph(SEED_ALL.map(node => ({ ...node })));
  return { ...toBaseMap(graph), name, sourceRef: undefined };
}

export interface MergeReport {
  added: number;
  updated: number;
  skipped: number;
  conflicts: { path: string; kept: [number, number]; dropped: [number, number] }[];
}

/** 把 incoming 合并进 base（就地修改 base.nodes），返回统计 */
export function mergeBaseMaps(base: BaseMap, incoming: BaseMap, options: { source?: MapNode['source']; force?: boolean } = {}): MergeReport {
  const source = options.source ?? 'preset';
  const byPath = new Map(base.nodes.map(node => [node.path, node]));
  const report: MergeReport = { added: 0, updated: 0, skipped: 0, conflicts: [] };
  for (const node of incoming.nodes ?? []) {
    if (!node || typeof node.path !== 'string') continue;
    const existing = byPath.get(node.path);
    if (!existing) {
      const copy: MapNode = { ...node, source, status: node.status ?? 'ok' };
      base.nodes.push(copy);
      byPath.set(copy.path, copy);
      report.added++;
      continue;
    }
    const protectedNode = existing.locked || existing.source === 'manual';
    if (protectedNode && !options.force) {
      const moved = Math.abs(existing.xy[0] - node.xy[0]) > 1 || Math.abs(existing.xy[1] - node.xy[1]) > 1;
      if (moved) {
        report.conflicts.push({ path: existing.path, kept: existing.xy, dropped: node.xy });
      }
      report.skipped++;
      continue;
    }
    existing.xy = [Number(node.xy[0]) || existing.xy[0], Number(node.xy[1]) || existing.xy[1]];
    if (node.kind) existing.kind = node.kind;
    if (node.note) existing.note = node.note;
    if (typeof node.altitude === 'number') existing.altitude = node.altitude;
    if (options.force) existing.locked = node.locked ?? false;
    existing.source = source;
    report.updated++;
  }
  base.updatedAt = new Date().toISOString();
  return report;
}

/** 拉取作者预设（GitHub raw / jsdelivr 都行，jsdelivr 带 CORS 头） */
export async function fetchPresetMap(url: string): Promise<BaseMap | null> {
  if (!url) return null;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const data = (await response.json()) as BaseMap;
  if (!data || !Array.isArray(data.nodes)) throw new Error('预设格式不正确：缺少 nodes 数组');
  return migrateBaseMap({ ...data, hiddenIds: data.hiddenIds ?? [] });
}

export interface InitialBaseMapResult {
  map: BaseMap;
  source: 'local' | 'preset' | 'seed';
  presetError?: string;
  report?: MergeReport;
}

/**
 * 决定首次/重置时用哪份底图。
 * local 有效就不覆盖（除非 forcePreset）；否则依次尝试作者预设、内置骨架。
 */
export async function resolveInitialBaseMap(options: {
  local?: BaseMap | null;
  presetUrl?: string;
  forcePreset?: boolean;
}): Promise<InitialBaseMapResult> {
  if (options.local && !options.forcePreset) {
    return { map: options.local, source: 'local' };
  }
  const seed = seedBaseMap(options.presetUrl ? '作者预设 + 内置骨架' : '内置世界骨架');
  if (!options.presetUrl) return { map: seed, source: 'seed' };
  try {
    const preset = await fetchPresetMap(options.presetUrl);
    if (!preset) return { map: seed, source: 'seed' };
    seed.name = preset.name || seed.name;
    seed.sourceRef = { repo: preset.sourceRef?.repo ?? '', ref: preset.sourceRef?.ref ?? '', url: options.presetUrl };
    const report = mergeBaseMaps(seed, preset, { source: 'preset', force: false });
    seed.hiddenIds = preset.hiddenIds ?? [];
    return { map: seed, source: 'preset', report };
  } catch (error) {
    return { map: seed, source: 'seed', presetError: String(error) };
  }
}
