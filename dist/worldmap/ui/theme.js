export const STYLE_ID = 'worldmap-style';
export const CSS = `
.worldmap-root, .worldmap-root * { box-sizing: border-box; }
.worldmap-root {
  /* ── 设计令牌（深色暖炭壳 × 米黄亚麻强调）───────────────────────── */
  --dym-bg: #16130f;              /* 窗框/标题栏/导航轨/时间轴 */
  --dym-panel: #1f1c17;           /* 抽屉面板 */
  --dym-card: #2a2520;            /* 卡片 */
  --dym-field: #1d1a15;           /* 输入类控件底（比卡片深的"凹陷井"） */
  --dym-hover: rgba(255,255,255,.05);
  --dym-line: rgba(255,255,255,.08);
  --dym-line-strong: rgba(255,255,255,.14);
  --dym-text: #ece7db;
  --dym-muted: #a89f8e;
  --dym-faint: #7d7666;
  --dym-accent: #d9c08c;          /* 亚麻米金 */
  --dym-accent-strong: #ecd9ab;
  --dym-accent-deep: #b99e66;
  --dym-accent-dim: rgba(217,192,140,.13);
  --dym-danger: #e2725f;
  --dym-radius: 12px;
  --dym-font: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC",
    "HarmonyOS Sans SC", "MiSans", system-ui, -apple-system, sans-serif;
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
  min-width: 340px; min-height: 240px;
  font-family: var(--dym-font);
  font-size: 13px; line-height: 1.65;
  color: var(--dym-text);
  background: var(--dym-panel);
  border: 1px solid rgba(222, 200, 156, .38);   /* 浅色描边：在深色酒馆页面上勾出窗缘 */
  border-radius: var(--dym-radius);
  box-shadow: 0 24px 64px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35);
  overflow: hidden;
  transition: width .22s ease, box-shadow .22s ease;
}
.worldmap-root > * { position: relative; z-index: 1; }
.worldmap-root.dym-collapsed { min-height: 0; height: auto !important; }
.worldmap-root.dym-collapsed .dym-body,
.worldmap-root.dym-collapsed .dym-timeline { display: none; }

/* ── 贴边窄条：暖炭底小书签，贴在页面边缘 ─────────────────────────── */
.worldmap-root.dym-rail {
  width: 30px !important; min-width: 30px; min-height: 0;
  border-radius: 10px 0 0 10px;
  border-right: none;
  background: linear-gradient(180deg, #37302a 0%, #2a251f 55%, #221e19 100%);
  border-left: 1px solid rgba(217,192,140,.28);
  box-shadow: -6px 8px 20px rgba(0,0,0,.45);
  transition: width .2s ease;
}
.worldmap-root.dym-rail.dym-rail-left {
  border-radius: 0 10px 10px 0;
  border-right: 1px solid rgba(217,192,140,.28);
  border-left: none;
  box-shadow: 6px 8px 20px rgba(0,0,0,.45);
}
.worldmap-root.dym-rail .dym-body,
.worldmap-root.dym-rail .dym-timeline,
.worldmap-root.dym-rail .dym-resize { display: none !important; }
.worldmap-root.dym-rail .dym-titlebar {
  flex-direction: column; height: 100%; padding: 10px 0; gap: 8px;
  background: transparent; box-shadow: none; cursor: pointer;
}
.worldmap-root.dym-rail .dym-title {
  writing-mode: vertical-rl; font-size: 12px; letter-spacing: .3em; color: var(--dym-accent-strong);
}
.worldmap-root.dym-rail .dym-badge,
.worldmap-root.dym-rail .dym-spacer,
.worldmap-root.dym-rail .dym-actions { display: none; }
.dym-rail-hint { display: none; }
.worldmap-root.dym-rail .dym-rail-hint {
  display: block; writing-mode: vertical-rl; font-size: 9.5px; letter-spacing: .18em;
  color: rgba(236,217,171,.55);
}

/* ── 区域轮廓：界域/地域用虚线多边形围出范围（宣纸上的墨线，保持原画法）── */
.dym-region {
  stroke-dasharray: 6 4.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-width: 1.3;
  stroke: rgba(120, 100, 60, .55);
  fill: rgba(120, 100, 60, .04);
  pointer-events: none;
}
.dym-region-realm {
  stroke: rgba(146, 104, 42, .72);
  fill: rgba(146, 104, 42, .05);
  stroke-width: 1.7;
}
.dym-region-region {
  stroke: rgba(111, 125, 69, .72);
  fill: rgba(111, 125, 69, .045);
  stroke-width: 1.3;
}

/* ── 标题栏：扁平深色，细发丝线分隔 ─────────────────────────────────── */
.dym-titlebar {
  display: flex; align-items: center; gap: 9px; padding: 0 8px 0 14px; height: 44px; flex: 0 0 auto;
  background: var(--dym-bg); color: var(--dym-text); cursor: move; user-select: none;
  border-bottom: 1px solid var(--dym-line);
}
.dym-title {
  font-size: 13.5px; font-weight: 700; letter-spacing: .18em; color: var(--dym-text);
  /* 产品名用衬线：与无衬线 UI 拉开品牌感，呼应宣纸画布 */
  font-family: "Songti SC", "STSong", "SimSun", serif;
}
.dym-logo { display: flex; color: var(--dym-accent); opacity: .95; }
.dym-badge {
  font-size: 11.5px; padding: 2px 10px; border-radius: 999px; max-width: 48%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--dym-accent-dim); border: 1px solid rgba(217,192,140,.26); color: var(--dym-accent-strong);
}
.dym-spacer { flex: 1 1 auto; }
.dym-actions { display: flex; gap: 2px; }
.dym-actions button {
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #b6afa0;
  border-radius: 8px; cursor: pointer; line-height: 1; font-family: inherit; padding: 0;
  transition: background .14s ease, color .14s ease;
}
.dym-actions button:hover { background: rgba(255,255,255,.07); color: var(--dym-text); }
.dym-actions button:active { background: rgba(255,255,255,.11); }
.dym-actions button.dym-on { background: var(--dym-accent-dim); color: var(--dym-accent-strong); }
/* 关闭按钮悬停红：主流窗口的惯例 */
.dym-actions button[data-act="close"]:hover { background: #d9483f; color: #fff; }

/* ── 通用按钮：深色升起面 + 亚麻主按钮 ─────────────────────────────── */
.dym-btn {
  border: 1px solid var(--dym-line-strong);
  background: #2e2a24; color: var(--dym-text);
  border-radius: 8px; cursor: pointer; font-size: 12.5px; padding: 5px 12px;
  line-height: 1.55; font-family: inherit;
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, transform .06s ease;
}
.dym-btn:hover { background: #383329; border-color: rgba(255,255,255,.2); }
.dym-btn:active { transform: translateY(.5px); }
.dym-btn:disabled { opacity: .38; cursor: not-allowed; box-shadow: none; background: #282520; }
.dym-btn.dym-primary {
  background: linear-gradient(180deg, #e6d1a2, #d2b678); border-color: #c3a76c; color: #2c2113;
  font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.3), 0 1px 0 rgba(255,255,255,.18) inset;
}
.dym-btn.dym-primary:hover { background: linear-gradient(180deg, #eeddb4, #dcc287); border-color: #cfae70; }
.dym-btn.dym-danger { color: #ef8d7c; border-color: rgba(226,114,95,.34); background: rgba(226,114,95,.07); }
.dym-btn.dym-danger:hover { background: rgba(226,114,95,.14); border-color: rgba(226,114,95,.55); }
.dym-btn.dym-danger[data-armed="1"] { background: #c05544; border-color: #d4685a; color: #fff; }

.dym-body { display: flex; flex: 1 1 auto; min-height: 0; }
/* 画布区：宣纸底保留在这里（深色外壳中间嵌一张古地图） */
.dym-canvas-wrap {
  position: relative; flex: 1 1 auto; min-width: 120px; overflow: hidden;
  background:
    radial-gradient(135% 105% at 16% -4%, #fdf6e2 0%, #f6ead0 38%, #ecdcb8 68%, #ddc79c 100%);
}
.dym-canvas-wrap::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    repeating-linear-gradient(0deg, rgba(124,96,54,.055) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(124,96,54,.042) 0 1px, transparent 1px 4px),
    radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(120,92,50,.13) 100%);
}
.dym-canvas-wrap > * { position: relative; z-index: 1; }
/* 顶部中间的坐标条：当前选中点的名称 + 坐标（没选中时由脚本隐藏）。
   它浮在宣纸画布上，保持浅色羊皮纸小票风格。 */
.dym-hud {
  position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
  max-width: 72%; padding: 3px 12px; border-radius: 999px; z-index: 3;
  background: rgba(255,252,244,.94);
  border: 1px solid rgba(110,84,46,.32);
  box-shadow: 0 2px 8px rgba(90,66,30,.22);
  font-size: 12.5px; letter-spacing: .02em; color: #3a2c16;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none;
}
.dym-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.dym-svg.dym-panning { cursor: grabbing; }
.dym-svg.dym-editing { cursor: crosshair; }

.dym-breadcrumb {
  position: absolute; left: 9px; top: 9px; display: flex; flex-wrap: wrap; gap: 2px; align-items: center;
  font-size: 12px; background: rgba(255,251,238,.92); border: 1px solid rgba(122,96,58,.3);
  border-radius: 999px; padding: 3px 10px; max-width: calc(100% - 18px);
  box-shadow: 0 1px 5px rgba(90,66,30,.18); color: #4a3c26;
}
.dym-breadcrumb span { cursor: pointer; color: #7a5321; }
.dym-breadcrumb span:hover { color: #a3462a; text-decoration: underline; }
.dym-breadcrumb i { color: #b09772; font-style: normal; margin: 0 1px; }
.dym-breadcrumb b { color: #3a2c17; }

.dym-zoomctl { position: absolute; right: 9px; bottom: 9px; display: flex; flex-direction: column; gap: 5px; }
.dym-zoomctl button {
  width: 28px; height: 28px; border-radius: 9px; cursor: pointer; line-height: 1;
  display: flex; align-items: center; justify-content: center; padding: 0;
  background: rgba(255,251,238,.94); border: 1px solid rgba(122,96,58,.35); color: #4a3418;
  box-shadow: 0 1px 4px rgba(90,66,30,.22);
  transition: background .14s ease;
}
.dym-zoomctl button:hover { background: #fffdf6; }

.dym-legend {
  position: absolute; left: 9px; bottom: 9px; font-size: 11px; color: #5c4a2c;
  background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.26); border-radius: 10px;
  padding: 4px 9px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 46%;
}
.dym-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
.dym-status {
  position: absolute; right: 9px; top: 9px; font-size: 11.5px; color: #5c4a2c;
  background: rgba(255,251,238,.9); border: 1px solid rgba(122,96,58,.26); border-radius: 999px; padding: 3px 10px;
  max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── 抽屉（右栏）：导航轨 + 内容面板 ────────────────────────────────── */
/* 用比例而不是固定像素：设置页控件多，固定 250px 会被挤成一团；
   min-width:0 是关键 —— 否则侧栏会被内容的 min-content 宽度顶大。 */
.dym-drawer {
  flex: 0 0 46%; min-width: 0; max-width: 520px;
  display: flex; flex-direction: row; min-height: 0;
  border-left: 1px solid var(--dym-line); background: var(--dym-panel);
}
.worldmap-root.dym-narrow .dym-drawer { flex-basis: 232px; }

/* 收起右栏：画布占满，把手留在右沿 */
.worldmap-root.dym-drawer-off .dym-drawer { display: none; }
.dym-drawer-toggle {
  flex: 0 0 15px; width: 15px; padding: 0; cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
  color: #857e6f; border: none; background: var(--dym-bg);
  border-left: 1px solid var(--dym-line);
  transition: color .14s ease, background .14s ease;
}
.dym-drawer-toggle:hover { color: var(--dym-accent-strong); background: #24211c; }
.worldmap-root.dym-drawer-off .dym-drawer-toggle { border-left-color: var(--dym-line-strong); }
.worldmap-root.dym-rail .dym-drawer-toggle { display: none; }

/* 导航轨：QQ/ZCode 设置页那种左侧竖排导航（图标 + 小字） */
.dym-tabs {
  display: flex; flex-direction: column; gap: 3px; padding: 8px 6px; flex: 0 0 52px;
  background: var(--dym-bg); border-right: 1px solid var(--dym-line);
}
.dym-tabs button {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 7px 0 5px; cursor: pointer; font-family: inherit;
  background: transparent; border: none; border-radius: 9px; color: #998f7c;
  font-size: 10.5px; letter-spacing: .02em; line-height: 1;
  transition: background .14s ease, color .14s ease;
}
.dym-tabs button:hover { color: var(--dym-text); background: var(--dym-hover); }
.dym-tabs button.dym-active {
  color: var(--dym-accent-strong); background: var(--dym-accent-dim); font-weight: 600;
}
/* 窄窗：导航轨只留图标，省出内容宽度 */
.worldmap-root.dym-narrow .dym-tabs { flex-basis: 44px; padding: 8px 4px; }
.worldmap-root.dym-narrow .dym-tabs button span { display: none; }
.worldmap-root.dym-narrow .dym-tabs button { padding: 9px 0; }
.dym-panes { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 12px; font-size: 13px; color: var(--dym-text); }
.dym-panes::-webkit-scrollbar { width: 10px; }
.dym-panes::-webkit-scrollbar-thumb { background: rgba(255,255,255,.13); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }
.dym-panes::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); border: 3px solid transparent; background-clip: padding-box; }
.dym-panes::-webkit-scrollbar-track { background: transparent; }
.dym-pane { display: none; }
.dym-pane.dym-active { display: block; }

/* ── 表单 ──────────────────────────────────────────────────────────── */
.dym-field { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
.dym-field label { flex: 0 0 62px; color: var(--dym-muted); font-size: 12.5px; }
.dym-field input[type=text], .dym-field input[type=number], .dym-field input[type=password], .dym-field select, .dym-field textarea {
  flex: 1 1 auto; min-width: 0; font-family: inherit; font-size: 12.5px; padding: 5px 9px;
  border: 1px solid var(--dym-line-strong); border-radius: 8px; background: var(--dym-field); color: var(--dym-text);
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.dym-field input::placeholder, .dym-field textarea::placeholder { color: var(--dym-faint); }
.dym-field select { cursor: pointer; }
.dym-field select option { background: #1d1a15; color: var(--dym-text); }
.dym-field input:hover, .dym-field select:hover { border-color: rgba(255,255,255,.22); }
.dym-field input:focus, .dym-field select:focus, .dym-field textarea:focus {
  outline: none; border-color: var(--dym-accent-deep); box-shadow: 0 0 0 3px rgba(217,192,140,.16);
}
.dym-field textarea { font-family: inherit; line-height: 1.6; resize: vertical; }
/* 纵排字段：标签在上、控件通栏（长标签/大文本框用） */
.dym-field.dym-col { flex-direction: column; align-items: stretch; gap: 5px; }
.dym-field.dym-col label { flex: none; width: auto; }
.dym-row { display: flex; gap: 6px; margin-bottom: 9px; flex-wrap: wrap; }
.dym-hint {
  font-size: 11.8px; color: var(--dym-muted); line-height: 1.7; margin: 7px 0 10px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.045);
  border-radius: 10px; padding: 8px 11px;
}
.dym-hint b { color: var(--dym-text); font-weight: 600; }
.dym-hint code {
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11px;
  background: rgba(255,255,255,.07); border-radius: 4px; padding: 1px 5px; color: var(--dym-accent-strong);
}
.dym-sect { font-size: 11.5px; color: var(--dym-faint); letter-spacing: .08em; margin: 14px 0 6px; }
/* AI 功能标记：用了模型的小金标 */
.dym-ai {
  display: inline-flex; align-items: center; margin-left: 7px; padding: 0 5px;
  border-radius: 5px; font-size: 9.5px; font-weight: 700; letter-spacing: .08em; line-height: 16px;
  color: #2c2113; background: linear-gradient(180deg, #e6d1a2, #d2b678);
}
.dym-sec > summary .dym-ai { margin-left: 8px; }

/* 设置页：分块折叠，一叠深色卡片 */
.dym-sec {
  border: 1px solid var(--dym-line); border-radius: var(--dym-radius); margin: 0 0 10px;
  background: var(--dym-card);
  overflow: hidden;
}
.dym-sec > summary {
  cursor: pointer; padding: 11px 13px; font-size: 13px; font-weight: 600; color: var(--dym-text);
  list-style: none; display: flex; align-items: center; gap: 8px; letter-spacing: .01em;
  transition: background .14s ease;
}
.dym-sec > summary::-webkit-details-marker { display: none; }
.dym-sec > summary::before {
  content: ''; width: 5px; height: 5px; flex: 0 0 auto; border-radius: 1px;
  border-right: 1.6px solid #8d8574; border-bottom: 1.6px solid #8d8574;
  transform: rotate(-45deg); transition: transform .16s ease; margin-top: -2px;
}
.dym-sec[open] > summary::before { transform: rotate(45deg); margin-top: 2px; }
.dym-sec > summary:hover { background: rgba(255,255,255,.028); }
.dym-sec[open] > summary { border-bottom: 1px solid var(--dym-line); }
.dym-sec > *:not(summary) { margin-left: 13px; margin-right: 13px; }
.dym-sec > *:not(summary):first-of-type { margin-top: 12px; }
.dym-sec > *:not(summary):last-child { margin-bottom: 12px; }
.dym-sec .dym-field label { flex: 0 0 66px; }
.dym-sec .dym-field.dym-col label { flex: none; width: auto; }
.dym-pw { position: relative; flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
.dym-pw input { flex: 1 1 auto; min-width: 0; }
.dym-pw button {
  flex: 0 0 auto; margin-left: 6px; width: 30px; height: 29px; padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--dym-line-strong); border-radius: 8px; background: var(--dym-field); color: #9d9585;
  transition: color .14s ease, border-color .14s ease;
}
.dym-pw button:hover { color: var(--dym-accent-strong); border-color: rgba(255,255,255,.22); }
.dym-field .dym-tip { flex: 0 0 auto; font-size: 11px; color: var(--dym-faint); cursor: help; border-bottom: 1px dotted rgba(255,255,255,.3); }
.dym-report {
  margin: 8px 0 0; padding: 9px 11px; border-radius: 10px; max-height: 168px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: #181510; border: 1px solid var(--dym-line); color: #d5cec0; white-space: pre-wrap;
}
.dym-report:empty { display: none; }
/* 轻操作的就地结果条：贴在触发按钮下面，不滚动页面、不抢视线 */
.dym-api-result {
  margin: 2px 0 8px; padding: 7px 10px; border-radius: 10px; max-height: 150px; overflow: auto;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.6;
  background: var(--dym-field); border: 1px solid var(--dym-line); color: #d5cec0; white-space: pre-wrap;
}
.dym-api-result:empty { display: none; }
/* 分组卡片：设置页折叠块之外，普通控件分组也用它（编辑页等） */
.dym-card {
  background: var(--dym-card); border: 1px solid var(--dym-line); border-radius: var(--dym-radius);
  padding: 11px 13px; margin-bottom: 10px;
}
.dym-card .dym-sect { margin: 0 0 8px; }
.dym-list {
  list-style: none; margin: 0 0 10px; padding: 5px;
  background: var(--dym-card); border: 1px solid var(--dym-line); border-radius: var(--dym-radius);
}
.dym-list li {
  padding: 6px 9px; border-radius: 8px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; font-size: 13px;
  transition: background .13s ease;
}
.dym-list li:hover { background: var(--dym-hover); }
.dym-list li.dym-selected { background: var(--dym-accent-dim); }
.dym-list .dym-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; transform: translateY(-1px); box-shadow: 0 0 0 1px rgba(255,255,255,.12); }
.dym-list .dym-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dym-list .dym-tag { font-size: 11px; color: var(--dym-faint); flex: 0 0 auto; }
.dym-list .dym-unplaced { color: var(--dym-accent); font-style: italic; }
.dym-list .dym-orphan { color: #a9b56d; }

/* ── 开关：iOS / 微信那种滑块 ────────────────────────────────────────
   胶囊画在 .dym-track（span）上、原生 checkbox 只当状态机隐藏掉：
   有些酒馆主题会给 input[type=checkbox] 配自己的开关样式，直接画在
   input 上会和宿主的叠出一个「黑影」，所以外观必须长在宿主碰不到的元素上。 */
.dym-switches {
  display: flex; flex-direction: column; margin-bottom: 10px;
  border: 1px solid var(--dym-line); border-radius: var(--dym-radius); background: var(--dym-card); overflow: hidden;
}
.dym-switches label {
  display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  gap: 12px; padding: 9px 13px; font-size: 12.8px; color: var(--dym-text); cursor: pointer;
  border-top: 1px solid var(--dym-line); line-height: 1.55;
  transition: background .13s ease;
}
.dym-switches label:first-child { border-top: none; }
.dym-switches label:hover { background: rgba(255,255,255,.022); }
.dym-switches b { font-weight: 600; }
.dym-switches input[type=checkbox] {
  position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;
}
.dym-switches .dym-track {
  position: relative; flex: 0 0 auto; width: 40px; height: 23px; border-radius: 12px;
  background: #45403a; transition: background .2s ease;
}
.dym-switches .dym-track::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 19px; height: 19px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4);
  transition: transform .2s cubic-bezier(.2,.8,.3,1);
}
.dym-switches label:hover .dym-track::after { box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.dym-switches input:checked ~ .dym-track { background: var(--dym-accent); }
.dym-switches input:checked ~ .dym-track::after { transform: translateX(17px); }
.dym-switches input:focus-visible ~ .dym-track { outline: 2px solid rgba(217,192,140,.4); outline-offset: 2px; }
/* 已经躺在卡片里时不要再套一层盒子，用发丝线分隔即可 */
.dym-sec .dym-switches { border: none; border-radius: 0; background: transparent; }
.dym-sec .dym-switches label { padding-left: 0; padding-right: 0; }

/* 导出/导入用的文本框：让用户能直接复制去发给 AI，也能把改好的粘回来 */
.dym-io {
  width: 100%; min-height: 132px; resize: vertical; margin: 2px 0 6px;
  font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 11.5px; line-height: 1.55;
  padding: 8px 10px; border: 1px solid var(--dym-line-strong); border-radius: 10px;
  background: #181510; color: #d5cec0; white-space: pre; overflow: auto;
}
.dym-io:focus { outline: none; border-color: var(--dym-accent-deep); box-shadow: 0 0 0 3px rgba(217,192,140,.16); }

/* 状态小药丸（坐标世界书挂载状态、列表右侧的分类标注） */
.dym-tag {
  display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; padding: 2px 9px; border-radius: 999px;
  background: rgba(255,255,255,.07); border: none; color: #bdb4a2;
}

.dym-timeline {
  flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 7px 12px;
  border-top: 1px solid var(--dym-line); background: var(--dym-bg);
  font-size: 12px; color: var(--dym-muted);
}
.dym-timeline input[type=range] { flex: 1 1 auto; accent-color: var(--dym-accent); }
.dym-timeline .dym-time { flex: 0 0 auto; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dym-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; z-index: 3; }
.dym-resize::after {
  content: ''; position: absolute; right: 4px; bottom: 4px; width: 8px; height: 8px;
  border-right: 2px solid rgba(217,192,140,.4); border-bottom: 2px solid rgba(217,192,140,.4);
  border-radius: 1px;
}

/* ── SVG 图层（宣纸画布上的墨与朱，保持原画法）────────────────────── */
/* 连线：颜色不透明，透明度由元素上的 stroke-opacity 按层级给（越深越淡） */
.dym-link { stroke: #7a623e; fill: none; stroke-linecap: round; }
.dym-trail-glow { fill: none; stroke: rgba(196,110,70,.22); stroke-linejoin: round; stroke-linecap: round; }
.dym-trail { fill: none; stroke: #a83a1a; stroke-linejoin: round; stroke-linecap: round; }
/* 地名标签：只垫一层细描边（高德式）。注意 stroke-width 不写在 CSS 里 ——
   文字在缩放坐标系里，CSS 的 2px 会被放大成几十像素的「气泡」；
   由 canvas 按缩放倒数逐元素设置，保证永远约等于屏幕 2px。 */
.dym-label {
  paint-order: stroke; stroke: rgba(252,246,230,.85);
  fill: #33291a; pointer-events: none;
}
.dym-label-major { fill: #241c10; letter-spacing: .04em; }
.dym-node { cursor: pointer; }
.dym-node text {
  paint-order: stroke; stroke: rgba(252,246,230,.85);
  pointer-events: none; font-family: var(--dym-font); fill: #33291a;
}
.dym-node.dym-dim { opacity: .3; }
.dym-node.dym-unplaced .dym-halo { stroke-dasharray: 3 2.5; }
.dym-node.dym-selected .dym-halo { stroke: #a83a1a; stroke-width: 2.4; }
.dym-halo { fill: none; }
.dym-pulse { fill: rgba(196,86,58,.26); }
.dym-compass { opacity: .45; pointer-events: none; }
`;
/** Lucide 图标（24×24 视口，只存路径数据） */
export const ICONS = {
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
/** 界面小图标（Lucide，24×24 视口）。与地点图标分开，方便按语义取用。 */
export const UI = {
    layers: {
        paths: [
            'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
            'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
            'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
        ],
    },
    pin: {
        paths: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'],
        circles: [[12, 10, 3]],
    },
    pencil: {
        paths: [
            'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
            'm15 5 4 4',
        ],
    },
    route: {
        paths: ['M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15'],
        circles: [[6, 19, 3], [18, 5, 3]],
    },
    sliders: {
        paths: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
    },
    panelRight: {
        paths: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M15 3v18'],
    },
    locate: {
        paths: ['M2 12h3', 'M19 12h3', 'M12 2v3', 'M12 19v3'],
        circles: [[12, 12, 6]],
    },
    fit: { paths: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'] },
    close: { paths: ['M18 6 6 18', 'm6 6 12 12'] },
    chevLeft: { paths: ['m15 18-6-6 6-6'] },
    chevRight: { paths: ['m9 18 6-6-6-6'] },
    plus: { paths: ['M5 12h14', 'M12 5v14'] },
    minus: { paths: ['M5 12h14'] },
    eye: {
        paths: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'],
        circles: [[12, 12, 3]],
    },
};
/** 把 Lucide 路径数据渲染成内联 SVG 字符串（stroke 用 currentColor） */
export function svgIcon(icon, size = 16, strokeWidth = 2) {
    const paths = icon.paths.map(d => `<path d="${d}"/>`).join('');
    const circles = (icon.circles ?? []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
    return (`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"` +
        ` stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        paths +
        circles +
        `</svg>`);
}
/** 罗盘（Lucide compass） */
export const COMPASS = {
    paths: ['m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'],
    circles: [[12, 12, 10]],
};
export const KIND_COLORS = {
    realm: '#7b6a3e',
    region: '#6f7d45',
    power: '#8a4f24',
    city: '#a3462a',
    site: '#4f6d78',
    room: '#5d6f8a',
    poi: '#6f6252',
};
export const KIND_LABELS = {
    realm: '界域',
    region: '地域',
    power: '宗门',
    city: '城池',
    site: '地点',
    room: '房间',
    poi: '地点',
};
export function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID))
        return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
}
export function escapeHtml(text) {
    const table = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text ?? '').replace(/[&<>"']/g, c => table[c] ?? c);
}
//# sourceMappingURL=theme.js.map