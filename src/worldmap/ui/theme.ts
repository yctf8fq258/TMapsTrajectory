/**
 * 视觉：宣纸古地图风格。
 * 图标取自 Lucide（ISC 许可，https://lucide.dev）——只内联路径数据，不引外链，
 * 保证脚本离线可用、也不给酒馆增加网络请求。
 */
import type { NodeKind } from '../types.js';

export const STYLE_ID = 'worldmap-style';

export const CSS = `
.worldmap-root, .worldmap-root * { box-sizing: border-box; }
.worldmap-root {
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
  min-width: 340px; min-height: 240px;
  font-family: "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", Georgia, serif;
  font-size: 13px; line-height: 1.6;
  color: #241d13;
  background:
    radial-gradient(135% 105% at 16% -4%, #fdf6e2 0%, #f6ead0 38%, #ecdcb8 68%, #ddc79c 100%);
  border: 1px solid rgba(104,80,44,.62);
  border-radius: 12px;
  box-shadow: 0 20px 56px rgba(0,0,0,.48), 0 2px 0 rgba(255,255,255,.28) inset, 0 0 80px rgba(150,120,70,.2) inset;
  overflow: hidden;
  transition: width .22s ease, box-shadow .22s ease;
}
.worldmap-root::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    repeating-linear-gradient(0deg, rgba(124,96,54,.055) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(124,96,54,.042) 0 1px, transparent 1px 4px),
    radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(120,92,50,.13) 100%);
}
.worldmap-root > * { position: relative; z-index: 1; }
.worldmap-root.dym-collapsed { min-height: 0; height: auto !important; }
.worldmap-root.dym-collapsed .dym-body,
.worldmap-root.dym-collapsed .dym-timeline { display: none; }

/* ── 贴边窄条：做成"索引标贴"那种小书签，贴在页面边缘 ───────────────── */
.worldmap-root.dym-rail {
  width: 30px !important; min-width: 30px; min-height: 0;
  border-radius: 8px 0 0 8px;
  border-right: none;
  background: linear-gradient(180deg, #cf9350 0%, #b0702f 55%, #96581f 100%);
  box-shadow: -4px 6px 16px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.25) inset;
  transition: width .2s ease;
}
.worldmap-root.dym-rail.dym-rail-left { border-radius: 0 8px 8px 0; border-right: 1px solid rgba(104,80,44,.62); border-left: none; box-shadow: 4px 6px 16px rgba(0,0,0,.38), 0 1px 0 rgba(255,255,255,.25) inset; }
.worldmap-root.dym-rail::before { display: none; }
.worldmap-root.dym-rail .dym-body,
.worldmap-root.dym-rail .dym-timeline,
.worldmap-root.dym-rail .dym-resize { display: none !important; }
.worldmap-root.dym-rail .dym-titlebar {
  flex-direction: column; height: 100%; padding: 9px 0; gap: 7px;
  background: transparent; box-shadow: none; cursor: pointer;
}
.worldmap-root.dym-rail .dym-title {
  writing-mode: vertical-rl; font-size: 12.5px; letter-spacing: .3em; color: #fff8e8;
  text-shadow: 0 1px 2px rgba(0,0,0,.35);
}
.worldmap-root.dym-rail .dym-badge,
.worldmap-root.dym-rail .dym-spacer,
.worldmap-root.dym-rail .dym-actions { display: none; }
.dym-rail-hint { display: none; }
.worldmap-root.dym-rail .dym-rail-hint {
  display: block; writing-mode: vertical-rl; font-size: 9.5px; letter-spacing: .18em;
  color: rgba(255,248,232,.78);
}

/* ── 区域轮廓：界域/地域用虚线多边形围出范围 ─────────────────────────── */
.dym-region {
  stroke-dasharray: 7 5;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-width: 1.4;
  stroke: rgba(120, 100, 60, .6);
  fill: rgba(120, 100, 60, .04);
  pointer-events: none;
}
.dym-region-realm {
  stroke: rgba(146, 104, 42, .78);
  fill: rgba(146, 104, 42, .05);
  stroke-width: 1.9;
}
.dym-region-region {
  stroke: rgba(111, 125, 69, .72);
  fill: rgba(111, 125, 69, .045);
  stroke-width: 1.3;
}

/* ── 标题栏 ─────────────────────────────────────────────────────────── */
.dym-titlebar {
  display: flex; align-items: center; gap: 9px; padding: 8px 11px; flex: 0 0 auto;
  background: linear-gradient(180deg, #6d4a24 0%, #55381b 60%, #452c14 100%);
  color: #f6ead0; cursor: move; user-select: none;
  box-shadow: 0 1px 0 rgba(255,255,255,.14) inset, 0 2px 6px rgba(0,0,0,.28);
}
.dym-title { font-size: 15.5px; letter-spacing: .18em; font-weight: 700; text-shadow: 0 1px 0 rgba(0,0,0,.45); }
.dym-badge {
  font-size: 12px; padding: 1px 9px; border-radius: 10px; max-width: 48%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: rgba(246,234,208,.16); border: 1px solid rgba(246,234,208,.34);
}
.dym-spacer { flex: 1 1 auto; }
.dym-actions { display: flex; gap: 5px; }
.dym-actions button {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(246,234,208,.38); background: rgba(246,234,208,.14); color: #f6ead0;
  border-radius: 7px; cursor: pointer; font-size: 14px; line-height: 1; font-family: inherit;
}
.dym-actions button:hover { background: rgba(246,234,208,.3); }

/* ── 通用按钮：侧栏是浅底，必须用深色字，否则会"看不见但能点" ────────── */
.dym-btn {
  border: 1px solid rgba(110,84,46,.45);
  background: linear-gradient(180deg, rgba(255,252,244,.92), rgba(244,232,208,.78));
  color: #4a3418; border-radius: 7px; cursor: pointer; font-size: 12.5px; padding: 4px 10px;
  line-height: 1.5; font-family: inherit; box-shadow: 0 1px 2px rgba(120,92,50,.16);
}
.dym-btn:hover { background: linear-gradient(180deg, #fffdf7, #f0e2c2); border-color: rgba(110,84,46,.72); }
.dym-btn:active { transform: translateY(1px); }
.dym-btn:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
.dym-btn.dym-primary {
  background: linear-gradient(180deg, #b8542f, #94401f); border-color: #7d3316; color: #fdf3e2;
  text-shadow: 0 1px 0 rgba(0,0,0,.25);
}
.dym-btn.dym-primary:hover { background: linear-gradient(180deg, #c65c34, #a04722); }
.dym-btn.dym-danger { color: #96331a; border-color: rgba(150,51,26,.45); background: linear-gradient(180deg, #fff8f2, #f4e0d2); }
.dym-btn.dym-danger:hover { background: linear-gradient(180deg, #fff, #f0d3c0); border-color: rgba(150,51,26,.7); }
.dym-btn.dym-danger[data-armed="1"] { background: linear-gradient(180deg, #b8542f, #94401f); border-color: #7d3316; color: #fdf3e2; }
.dym-titlebar .dym-btn { border-color: rgba(246,234,208,.38); background: rgba(246,234,208,.14); color: #f6ead0; }
.dym-titlebar .dym-btn:hover { background: rgba(246,234,208,.3); }
.dym-actions button.dym-on { background: rgba(246,234,208,.34); color: #fff8e8; }

.dym-body { display: flex; flex: 1 1 auto; min-height: 0; }
.dym-canvas-wrap { position: relative; flex: 1 1 auto; min-width: 120px; overflow: hidden; }
.dym-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.dym-svg.dym-panning { cursor: grabbing; }
.dym-svg.dym-editing { cursor: crosshair; }

.dym-breadcrumb {
  position: absolute; left: 9px; top: 9px; display: flex; flex-wrap: wrap; gap: 2px; align-items: center;
  font-size: 12px; background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.4);
  border-radius: 8px; padding: 3px 8px; max-width: calc(100% - 18px);
  box-shadow: 0 1px 4px rgba(120,92,50,.14);
}
.dym-breadcrumb span { cursor: pointer; color: #7a5321; }
.dym-breadcrumb span:hover { color: #a3462a; text-decoration: underline; }
.dym-breadcrumb i { color: #b09772; font-style: normal; margin: 0 1px; }
.dym-breadcrumb b { color: #3a2c17; }

.dym-zoomctl { position: absolute; right: 9px; bottom: 9px; display: flex; flex-direction: column; gap: 4px; }
.dym-zoomctl button {
  width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1;
  background: rgba(255,251,238,.94); border: 1px solid rgba(122,96,58,.45); color: #4a3418;
  box-shadow: 0 1px 3px rgba(120,92,50,.2);
}
.dym-zoomctl button:hover { background: #fff; }

.dym-legend {
  position: absolute; left: 9px; bottom: 9px; font-size: 11px; color: #6a5433;
  background: rgba(255,251,238,.88); border: 1px solid rgba(122,96,58,.32); border-radius: 8px;
  padding: 3px 7px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 46%;
}
.dym-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
.dym-status {
  position: absolute; right: 9px; top: 9px; font-size: 11.5px; color: #6a5433;
  background: rgba(255,251,238,.88); border: 1px solid rgba(122,96,58,.32); border-radius: 8px; padding: 3px 8px;
  max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 侧栏（信息面板）─────────────────────────────────────────────────── */
/* 用比例而不是固定像素：设置页控件多，固定 250px 会被挤成一团；
   min-width:0 是关键 —— 否则侧栏会被内容的 min-content 宽度顶大（曾经被 textarea 顶到 431px）。 */
.dym-drawer {
  flex: 0 0 46%; min-width: 0; max-width: 520px;
  display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid rgba(122,96,58,.32); background: rgba(253,248,235,.5);
}
.worldmap-root.dym-narrow .dym-drawer { flex-basis: 232px; }

/* 收起右侧栏：画布占满，把手留在右沿 */
.worldmap-root.dym-drawer-off .dym-drawer { display: none; }
.dym-drawer-toggle {
  flex: 0 0 14px; width: 14px; padding: 0; cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 700; line-height: 1; color: #6b4f28;
  border: none; border-left: 1px solid rgba(122,96,58,.34);
  background: linear-gradient(90deg, rgba(240,228,203,.65), rgba(232,217,187,.98));
  box-shadow: inset 1px 0 0 rgba(255,255,255,.5);
}
.dym-drawer-toggle:hover { color: #9c3a1e; background: linear-gradient(90deg, rgba(246,214,190,.9), rgba(240,200,170,.98)); }
.dym-drawer-toggle:active { transform: translateX(1px); }
.worldmap-root.dym-drawer-off .dym-drawer-toggle { border-left-color: rgba(122,96,58,.45); }
.worldmap-root.dym-rail .dym-drawer-toggle { display: none; }
.dym-tabs { display: flex; border-bottom: 1px solid rgba(122,96,58,.3); flex: 0 0 auto; background: rgba(246,236,214,.6); }
.dym-tabs button {
  flex: 1 1 auto; padding: 7px 2px 6px; font-size: 13px; cursor: pointer; font-family: inherit;
  background: transparent; border: none; border-bottom: 2.5px solid transparent; color: #7a6242;
}
.dym-tabs button:hover { color: #4a3418; }
.dym-tabs button.dym-active { color: #9c3a1e; border-bottom-color: #b8542f; font-weight: 700; background: rgba(255,253,246,.7); }
.dym-panes { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 10px; font-size: 13px; }
.dym-panes::-webkit-scrollbar { width: 9px; }
.dym-panes::-webkit-scrollbar-thumb { background: rgba(122,96,58,.34); border-radius: 6px; }
.dym-pane { display: none; }
.dym-pane.dym-active { display: block; }

.dym-field { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.dym-field label { flex: 0 0 58px; color: #7a6242; font-size: 12.5px; }
.dym-field input[type=text], .dym-field input[type=number], .dym-field select {
  flex: 1 1 auto; min-width: 0; font-family: inherit; font-size: 12.5px; padding: 4px 7px;
  border: 1px solid rgba(122,96,58,.4); border-radius: 6px; background: rgba(255,253,247,.95); color: #2b2114;
}
.dym-field input:focus, .dym-field select:focus { outline: 2px solid rgba(184,84,47,.35); }
.dym-row { display: flex; gap: 6px; margin-bottom: 7px; flex-wrap: wrap; }
.dym-hint {
  font-size: 12px; color: #7d6a4a; line-height: 1.75; margin: 5px 0 9px;
  background: rgba(255,252,244,.6); border-left: 2px solid rgba(184,84,47,.4); border-radius: 0 6px 6px 0; padding: 5px 8px;
}
.dym-sect { font-size: 12px; color: #8a6f45; letter-spacing: .1em; margin: 12px 0 6px; }

/* 设置页：分块折叠，别把一堆输入框挤在一屏 */
.dym-sec {
  border: 1px solid rgba(122,96,58,.32); border-radius: 9px; margin: 0 0 9px;
  background: linear-gradient(180deg, rgba(255,253,247,.82), rgba(248,240,224,.7));
  overflow: hidden;
}
.dym-sec > summary {
  cursor: pointer; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #6b4f28;
  list-style: none; display: flex; align-items: center; gap: 6px; letter-spacing: .04em;
}
.dym-sec > summary::-webkit-details-marker { display: none; }
.dym-sec > summary::before {
  content: ''; width: 0; height: 0; flex: 0 0 auto;
  border-left: 5px solid #a3462a; border-top: 4px solid transparent; border-bottom: 4px solid transparent;
  transition: transform .16s ease;
}
.dym-sec[open] > summary::before { transform: rotate(90deg) translateX(1px); }
.dym-sec > summary:hover { background: rgba(163,70,42,.08); }
.dym-sec[open] > summary { border-bottom: 1px solid rgba(122,96,58,.24); }
.dym-sec > *:not(summary) { margin-left: 10px; margin-right: 10px; }
.dym-sec > *:not(summary):first-of-type { margin-top: 9px; }
.dym-sec > *:not(summary):last-child { margin-bottom: 9px; }
.dym-sec .dym-field label { flex: 0 0 66px; }
.dym-pw { position: relative; flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
.dym-pw input { flex: 1 1 auto; min-width: 0; }
.dym-pw button {
  flex: 0 0 auto; margin-left: 4px; width: 28px; height: 26px; padding: 0; cursor: pointer;
  border: 1px solid rgba(122,96,58,.4); border-radius: 6px; background: rgba(255,253,247,.95); color: #6b4f28;
}
.dym-pw button:hover { background: #fff; color: #a3462a; }
.dym-field .dym-tip { flex: 0 0 auto; font-size: 11px; color: #9a8158; cursor: help; border-bottom: 1px dotted rgba(122,96,58,.6); }
.dym-report {
  margin: 8px 0 0; padding: 7px 9px; border-radius: 7px; max-height: 168px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: rgba(43,33,20,.06); border: 1px dashed rgba(122,96,58,.45); color: #4a3418; white-space: pre-wrap;
}
.dym-report:empty { display: none; }
.dym-list { list-style: none; margin: 0; padding: 0; }
.dym-list li {
  padding: 4px 6px; border-radius: 6px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; font-size: 13px;
}
.dym-list li:hover { background: rgba(163,70,42,.1); }
.dym-list li.dym-selected { background: rgba(163,70,42,.2); }
.dym-list .dym-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; transform: translateY(-1px); }
.dym-list .dym-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dym-list .dym-tag { font-size: 11px; color: #9a8158; flex: 0 0 auto; }
.dym-list .dym-unplaced { color: #a3462a; font-style: italic; }
.dym-list .dym-orphan { color: #6b7a45; }
.dym-switches { display: grid; grid-template-columns: 1fr; gap: 5px; margin-bottom: 10px; }
.dym-switches label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #4a3418; cursor: pointer; }
.dym-switches input { accent-color: #b8542f; width: 14px; height: 14px; }

/* 导出/导入用的文本框：让用户能直接复制去发给 AI，也能把改好的粘回来 */
.dym-io {
  width: 100%; min-height: 132px; resize: vertical; margin: 2px 0 6px;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.55;
  padding: 6px 8px; border: 1px solid rgba(122,96,58,.42); border-radius: 7px;
  background: rgba(255,253,247,.96); color: #2b2114; white-space: pre; overflow: auto;
}
.dym-io:focus { outline: 2px solid rgba(184,84,47,.35); }

.dym-timeline {
  flex: 0 0 auto; display: flex; align-items: center; gap: 9px; padding: 7px 11px;
  border-top: 1px solid rgba(122,96,58,.3); background: rgba(246,236,214,.72);
  font-size: 12.5px; color: #5a4526;
}
.dym-timeline input[type=range] { flex: 1 1 auto; accent-color: #b8542f; }
.dym-timeline .dym-time { flex: 0 0 auto; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dym-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; z-index: 3; }
.dym-resize::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px;
  border-right: 2px solid rgba(122,96,58,.65); border-bottom: 2px solid rgba(122,96,58,.65);
}
.dym-launcher {
  position: fixed; z-index: 2147483000; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700;
  font-family: "Songti SC", "STSong", "SimSun", serif;
  background: radial-gradient(circle at 32% 28%, #7c5528, #3f2a13);
  color: #f4e6c6; border: 1px solid rgba(246,234,208,.55);
  box-shadow: 0 8px 20px rgba(0,0,0,.45); user-select: none;
}
.dym-launcher:hover { transform: scale(1.06); }
.dym-launcher .dym-launcher-dot {
  position: absolute; top: -2px; right: -2px; width: 11px; height: 11px; border-radius: 50%;
  background: #c4563a; border: 1px solid #f6ead0;
}

/* ── SVG 图层 ───────────────────────────────────────────────────────── */
.dym-link { stroke: rgba(108,84,48,.45); fill: none; }
.dym-trail-glow { fill: none; stroke: rgba(196,110,70,.22); stroke-linejoin: round; stroke-linecap: round; }
.dym-trail { fill: none; stroke: #a83a1a; stroke-linejoin: round; stroke-linecap: round; }
.dym-node { cursor: pointer; }
.dym-node text {
  paint-order: stroke; stroke: rgba(253,247,232,.95); stroke-width: 3px;
  pointer-events: none; font-family: "Songti SC", "STSong", "SimSun", serif; fill: #241d13;
}
.dym-node.dym-dim { opacity: .3; }
.dym-node.dym-unplaced .dym-halo { stroke-dasharray: 3 2.5; }
.dym-node.dym-selected .dym-halo { stroke: #a83a1a; stroke-width: 2.4; }
.dym-halo { fill: none; }
.dym-pulse { fill: rgba(196,86,58,.26); }
.dym-compass { opacity: .45; pointer-events: none; }
`;

/** Lucide 图标（24×24 视口，只存路径数据） */
export const ICONS: Record<NodeKind, { paths: string[]; circles?: [number, number, number][] }> = {
  realm: {
    paths: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
    circles: [[12, 12, 10]],
  },
  region: { paths: ['m8 3 4 8 5-5 5 15H2L8 3z'] },
  power: {
    paths: [
      'M10 18v-7',
      'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z',
      'M14 18v-7',
      'M18 18v-7',
      'M3 22h18',
      'M6 18v-7',
    ],
  },
  city: {
    paths: [
      'M10 5V3',
      'M14 5V3',
      'M15 21v-3a3 3 0 0 0-6 0v3',
      'M18 3v8',
      'M18 5H6',
      'M22 11H2',
      'M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9',
      'M6 3v8',
    ],
  },
  site: {
    paths: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'],
    circles: [[12, 10, 3]],
  },
  room: {
    paths: [
      'M10 21H2',
      'M10 3H7a2 2 0 0 0-2 2v16',
      'M14 12h.01',
      'M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992z',
      'M22 21h-3',
    ],
  },
  poi: {
    paths: [
      'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      'M20 2v4',
      'M22 4h-4',
    ],
    circles: [[4, 20, 2]],
  },
};

/** 罗盘（Lucide compass） */
export const COMPASS = {
  paths: ['m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'],
  circles: [[12, 12, 10]] as [number, number, number][],
};

export const KIND_COLORS: Record<NodeKind, string> = {
  realm: '#7b6a3e',
  region: '#6f7d45',
  power: '#8a4f24',
  city: '#a3462a',
  site: '#4f6d78',
  room: '#5d6f8a',
  poi: '#6f6252',
};

export const KIND_LABELS: Record<NodeKind, string> = {
  realm: '界域',
  region: '地域',
  power: '宗门',
  city: '城池',
  site: '地点',
  room: '房间',
  poi: '地点',
};

export function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

export function escapeHtml(text: unknown): string {
  const table: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text ?? '').replace(/[&<>"']/g, c => table[c] ?? c);
}
