import { ID_PREFIX } from '../types.js';
import { COMPASS, KIND_COLORS, KIND_LABELS, UI, escapeHtml, ensureStyle, svgIcon } from './theme.js';
const TABS = [
    { key: 'layers', label: '图层', icon: UI.layers },
    { key: 'places', label: '地点', icon: UI.pin },
    { key: 'edit', label: '编辑', icon: UI.pencil },
    { key: 'trail', label: '轨迹', icon: UI.route },
    { key: 'settings', label: '设置', icon: UI.sliders },
];
/** 轻提示：走宿主的 toastr（酒馆页面右上角），没有就落控制台 */
function toast(kind, message) {
    try {
        const host = window.parent && window.parent !== window ? window.parent : window;
        const fn = host.toastr?.[kind];
        if (typeof fn === 'function')
            fn(message, '世界舆图');
        else
            window.console.log('[世界舆图]', kind, message);
    }
    catch {
        window.console.log('[世界舆图]', message);
    }
}
export class MapWindow {
    doc;
    actions;
    canvasWrap;
    root;
    drawer;
    drawerHandle;
    panes = new Map();
    tabButtons = new Map();
    badge;
    timelineInput;
    timelineLabel;
    breadcrumb;
    statusBar;
    searchInput;
    fileInput;
    data;
    /**
     * 宿主窗口（酒馆主页面）。
     * 悬浮窗的坐标是相对宿主视口的，所以 innerWidth / 视口高度 / resize 事件都必须取宿主的，
     * 而不是脚本 iframe 自己的窗口 —— 后者永远是那个隐藏小 iframe 的尺寸。
     */
    host;
    dockSide = null;
    /** 贴边判定阈值（像素） */
    edgeThreshold = 18;
    constructor(doc, data, actions, canvasWrap) {
        this.doc = doc;
        this.actions = actions;
        this.canvasWrap = canvasWrap;
        this.host = (doc.defaultView ?? window);
        this.data = data;
        ensureStyle(doc);
        this.root = doc.createElement('div');
        this.root.id = `${ID_PREFIX}root`;
        this.root.className = 'worldmap-root';
        this.build();
        this.applyLayout(data.layout);
        this.bindChrome();
    }
    build() {
        const doc = this.doc;
        // 标题栏
        const bar = doc.createElement('div');
        bar.className = 'dym-titlebar';
        bar.innerHTML = `<span class="dym-logo">${svgIcon(COMPASS, 15, 1.8)}</span><span class="dym-title">世界舆图</span><span class="dym-badge" data-role="badge">—</span>
      <span class="dym-rail-hint">点开</span>
      <span class="dym-spacer"></span>
      <div class="dym-actions">
        <button data-act="drawer" title="收起 / 展开右侧栏">${svgIcon(UI.panelRight, 15)}</button>
        <button data-act="locate" title="定位到当前地点">${svgIcon(UI.locate, 15)}</button>
        <button data-act="fit" title="全图">${svgIcon(UI.fit, 14)}</button>
        <button data-act="close" title="关闭（点脚本按钮可重新打开）">${svgIcon(UI.close, 15)}</button>
      </div>`;
        this.badge = bar.querySelector('[data-role=badge]');
        // 主体
        const body = doc.createElement('div');
        body.className = 'dym-body';
        const canvasWrap = this.canvasWrap;
        canvasWrap.classList.add('dym-canvas-wrap');
        if (!canvasWrap.id)
            canvasWrap.id = `${ID_PREFIX}canvas`;
        this.breadcrumb = doc.createElement('div');
        this.breadcrumb.className = 'dym-breadcrumb';
        const zoomCtl = doc.createElement('div');
        zoomCtl.className = 'dym-zoomctl';
        zoomCtl.innerHTML = `<button data-act="zoom-in" title="放大">${svgIcon(UI.plus, 14)}</button><button data-act="zoom-out" title="缩小">${svgIcon(UI.minus, 14)}</button>`;
        const legend = doc.createElement('div');
        legend.className = 'dym-legend';
        legend.innerHTML = ['realm', 'region', 'power', 'city', 'site']
            .map(kind => `<span><i style="background:${KIND_COLORS[kind]}"></i>${KIND_LABELS[kind]}</span>`)
            .join('');
        this.statusBar = doc.createElement('div');
        this.statusBar.className = 'dym-status';
        this.drawer = doc.createElement('div');
        this.drawer.className = 'dym-drawer';
        // 收起 / 展开右侧栏的把手：贴着侧栏左沿，侧栏收起后它就在窗口右沿（一直可点）
        this.drawerHandle = doc.createElement('button');
        this.drawerHandle.className = 'dym-drawer-toggle';
        this.drawerHandle.type = 'button';
        this.drawerHandle.title = '收起 / 展开右侧栏';
        this.drawerHandle.innerHTML = svgIcon(UI.chevRight, 12);
        this.drawerHandle.addEventListener('click', () => this.toggleDrawer());
        const tabs = doc.createElement('div');
        tabs.className = 'dym-tabs';
        const panes = doc.createElement('div');
        panes.className = 'dym-panes';
        for (const tab of TABS) {
            const button = doc.createElement('button');
            button.innerHTML = `${svgIcon(tab.icon, 17)}<span>${tab.label}</span>`;
            button.title = tab.label;
            button.dataset.tab = tab.key;
            button.addEventListener('click', () => this.setTab(tab.key));
            tabs.appendChild(button);
            this.tabButtons.set(tab.key, button);
            const pane = doc.createElement('div');
            pane.className = 'dym-pane';
            pane.dataset.pane = tab.key;
            panes.appendChild(pane);
            this.panes.set(tab.key, pane);
        }
        this.drawer.append(tabs, panes);
        // 时间轴
        const timeline = doc.createElement('div');
        timeline.className = 'dym-timeline';
        const range = doc.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '0';
        range.value = '0';
        range.addEventListener('input', () => {
            const value = Number(range.value);
            const max = Number(range.max);
            this.actions.onTimeline(value >= max ? null : value);
        });
        this.timelineInput = range;
        this.timelineLabel = doc.createElement('span');
        this.timelineLabel.className = 'dym-time';
        const latest = doc.createElement('button');
        latest.className = 'dym-btn';
        latest.textContent = '回到最新';
        latest.addEventListener('click', () => this.actions.onTimeline(null));
        timeline.append(range, this.timelineLabel, latest);
        const resize = doc.createElement('div');
        resize.className = 'dym-resize';
        this.root.append(bar, body, timeline, resize);
        body.append(canvasWrap, this.drawerHandle, this.drawer);
        canvasWrap.append(this.breadcrumb, zoomCtl, legend, this.statusBar, this.data.canvas.svg);
        this.fileInput = doc.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.json';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                    const text = String(reader.result ?? '');
                    this.setIo(text, `已读入 ${file.name}，正在导入…`);
                    this.actions.onImportBaseMapText(text, message => this.setIoHint(message));
                };
                reader.readAsText(file);
            }
            this.fileInput.value = '';
        });
        this.root.appendChild(this.fileInput);
        this.buildPanes();
    }
    buildPanes() {
        const doc = this.doc;
        // ── 图层 ──
        const layers = this.panes.get('layers');
        layers.innerHTML = `
      <div class="dym-switches">
        <label><input type="checkbox" data-layer="showTrail"><span>显示轨迹</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="trailCityOnly"><span>轨迹只连到市级（去掉城内蜘蛛网）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showLinks"><span>显示层级连线</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showRegions"><span>显示区域轮廓（州/域用虚线围范围）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-layer="showUnplaced"><span>显示待定位节点</span><span class="dym-track" aria-hidden="true"></span></label>
      </div>
      <div class="dym-row"><button class="dym-btn" data-act="scatter">环形铺开待定位节点</button></div>
      <div class="dym-hint" data-role="layer-hint"></div>`;
        layers.querySelectorAll('[data-layer]').forEach(input => {
            input.addEventListener('change', () => this.actions.onToggleLayer(input.dataset.layer, input.checked));
        });
        layers.querySelector('[data-act=scatter]')?.addEventListener('click', () => this.actions.onScatterUnplaced());
        // ── 地点 ──
        const places = this.panes.get('places');
        places.innerHTML = `
      <div class="dym-field"><label>搜索</label><input type="text" data-role="search" placeholder="地名 / 路径片段"></div>
      <div class="dym-hint">单击定位、双击下钻；右键节点可重命名、删除、加子节点。</div>
      <ul class="dym-list" data-role="place-list"></ul>`;
        this.searchInput = places.querySelector('[data-role=search]');
        this.searchInput?.addEventListener('input', () => this.renderPlaceList());
        // ── 编辑 ──
        const edit = this.panes.get('edit');
        edit.innerHTML = `
      <div class="dym-switches">
        <label><input type="checkbox" data-role="edit-mode"><span>编辑模式（拖动节点改位置）</span><span class="dym-track" aria-hidden="true"></span></label>
        <label><input type="checkbox" data-role="box-select"><span>框选模式（空白处拖动框选多点，Shift 点单点加减）</span><span class="dym-track" aria-hidden="true"></span></label>
      </div>
      <div class="dym-row">
        <button class="dym-btn" data-act="undo">撤销</button>
        <button class="dym-btn" data-act="redo">重做</button>
      </div>
      <div class="dym-card">
        <div class="dym-sect">选中节点</div>
        <div class="dym-hint" data-role="selected-info">未选中节点。</div>
        <div class="dym-field"><label>名称</label><input type="text" data-role="node-name"></div>
        <div class="dym-field"><label>X</label><input type="number" step="0.1" data-role="node-x"></div>
        <div class="dym-field"><label>Y</label><input type="number" step="0.1" data-role="node-y"></div>
        <div class="dym-field"><label>显示层级</label>
          <select data-role="node-tier">
            <option value="">自动（按类型推导）</option>
            <option value="1">1 · 界域 / 大域</option>
            <option value="2">2 · 地域 / 地貌</option>
            <option value="3">3 · 城池 / 宗级势力</option>
            <option value="4">4 · 具体地点</option>
            <option value="5">5 · 房间</option>
          </select>
        </div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="apply-xy">应用坐标</button></div>
      </div>
      <div class="dym-card">
        <div class="dym-sect">新增地点</div>
        <div class="dym-field"><label>名称</label><input type="text" data-role="child-name" placeholder="新子地点名称"></div>
        <div class="dym-row">
          <button class="dym-btn" data-act="add-child">加子节点</button>
          <button class="dym-btn" data-act="add-sibling">加同级</button>
          <button class="dym-btn" data-act="add-free">在视图中心新增</button>
        </div>
      </div>
      <div class="dym-row">
        <button class="dym-btn" data-act="toggle-lock">锁定 / 解锁</button>
        <button class="dym-btn" data-act="toggle-pin" title="固定后：框选与批量拖动会跳过该点（直接拖仍可移动）">固定位置</button>
        <button class="dym-btn dym-danger" data-act="delete-node">删除节点</button>
      </div>
      <div class="dym-hint">
        增点：<b>开启编辑模式后，在画布空白处右键或双击</b>即可在那里新增一个地点（会挂在当前下钻的节点下）。<br>
        批量：打开<b>框选模式</b>后空白处拖动框选多点（Shift 点单点可加减），抓住其中一点拖动整组移动；
        <b>右键空白处取消框选</b>；固定的点不会被框到。<br>
        平移：<b>鼠标中键按住拖拽</b>任何模式下都能平移地图。<br>
        删点：选中后点上面的「删除节点」，或按 <b>Delete</b> 键（子节点会一起删）。<br>
        锁定后的节点不会被地图布局 AI 覆盖；人工拖动会自动标记为「人工」。
      </div>`;
        edit.querySelector('[data-role=edit-mode]')?.addEventListener('change', event => {
            this.actions.onSetEditMode(event.target.checked);
        });
        edit.querySelector('[data-role=box-select]')?.addEventListener('change', event => {
            this.data.canvas.setBoxSelect(event.target.checked);
        });
        edit.querySelector('[data-act=undo]')?.addEventListener('click', () => this.actions.onUndo());
        edit.querySelector('[data-act=redo]')?.addEventListener('click', () => this.actions.onRedo());
        const applyXy = () => {
            const x = Number(edit.querySelector('[data-role=node-x]').value);
            const y = Number(edit.querySelector('[data-role=node-y]').value);
            if (!Number.isFinite(x) || !Number.isFinite(y))
                return;
            this.actions.onMoveSelected([x, y]);
        };
        edit.querySelector('[data-act=apply-xy]')?.addEventListener('click', applyXy);
        edit.querySelector('[data-role=node-tier]')?.addEventListener('change', event => {
            if (!this.data.selectedId)
                return;
            const raw = event.target.value;
            this.actions.onSetNodeTier(this.data.selectedId, raw === '' ? null : Number(raw));
        });
        const childName = () => edit.querySelector('[data-role=child-name]').value.trim();
        edit.querySelector('[data-act=add-child]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            if (this.data.selectedId)
                this.actions.onAddChild(this.data.selectedId, name);
        });
        edit.querySelector('[data-act=add-sibling]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            const selected = this.data.selectedId ? this.data.canvas.getView().graph.get(this.data.selectedId) : undefined;
            if (selected)
                this.actions.onAddChild(selected.parentId, name);
        });
        edit.querySelector('[data-act=add-free]')?.addEventListener('click', () => {
            const name = childName() || '新地点';
            // 真按「当前画面中心」的世界坐标落点 —— 之前落在父节点旁边，用户根本找不到新生成的点
            const size = this.data.canvas.size();
            const center = this.data.canvas.screenToWorld(size.w / 2, size.h / 2);
            this.actions.onAddChild(this.data.focusId ?? this.data.selectedId, name, [
                Math.round(center[0] * 100) / 100,
                Math.round(center[1] * 100) / 100,
            ]);
        });
        edit.querySelector('[data-act=toggle-lock]')?.addEventListener('click', () => this.data.selectedId && this.actions.onToggleLock(this.data.selectedId));
        edit.querySelector('[data-act=toggle-pin]')?.addEventListener('click', () => this.data.selectedId && this.actions.onTogglePinned(this.data.selectedId));
        // 删除用两步确认，避免在隐藏 iframe 里弹 confirm 对话框
        const deleteButton = edit.querySelector('[data-act=delete-node]');
        deleteButton.addEventListener('click', () => {
            if (!this.data.selectedId)
                return;
            if (deleteButton.dataset.armed === '1') {
                deleteButton.dataset.armed = '';
                deleteButton.textContent = '删除节点';
                this.actions.onDeleteNode(this.data.selectedId);
                return;
            }
            deleteButton.dataset.armed = '1';
            deleteButton.textContent = '再点一次确认删除';
            setTimeout(() => {
                if (deleteButton.dataset.armed === '1') {
                    deleteButton.dataset.armed = '';
                    deleteButton.textContent = '删除节点';
                }
            }, 3200);
        });
        edit.querySelector('[data-role=node-name]')?.addEventListener('change', event => {
            if (this.data.selectedId)
                this.actions.onRenameNode(this.data.selectedId, event.target.value);
        });
        // ── 轨迹 ──
        const trail = this.panes.get('trail');
        trail.innerHTML = `
      <div class="dym-row">
        <button class="dym-btn" data-act="rebuild" title="清空当前轨迹层（含拖过的位置、隐藏列表）并按聊天记录全量重建；配合「AI 整理」可清除历史污点">从聊天记录重算</button>
        <button class="dym-btn" data-act="clear-hidden" title="取消隐藏所有轨迹点">恢复全部显示</button>
      </div>
      <div class="dym-row">
        <button class="dym-btn dym-primary" data-act="ai-fix-history">AI 整理本会话地点<span class="dym-ai">AI</span></button>
      </div>
      <div class="dym-api-result" data-role="trail-result"></div>
      <div class="dym-hint">聊天中途才装插件、或 AI 写的地点串太脏（混描述/时刻/拼层级）？点它把本会话出现过的
        原始地点串发给模型规范化成干净路径，玩出来的非设定地点顺带按方位给相对坐标。
        从头开始玩的新档不需要；整理结果存在本会话的轨迹数据里，重算时自动套用。<br>
        清污两步：<b>先「从聊天记录重算」（全量重建，会清掉拖过的轨迹点位置）→ 再「AI 整理」</b>。</div>
      <div class="dym-hint" data-role="trail-hint"></div>
      <ul class="dym-list" data-role="trail-list"></ul>`;
        trail.querySelector('[data-act=rebuild]')?.addEventListener('click', () => this.actions.onRebuildTrail());
        trail.querySelector('[data-act=clear-hidden]')?.addEventListener('click', () => this.actions.onClearHiddenPoints());
        trail.querySelector('[data-act=ai-fix-history]')?.addEventListener('click', () => this.actions.onAiFixHistory());
        // ── 设置 ──
        const settings = this.panes.get('settings');
        settings.innerHTML = `
      <details class="dym-sec"><summary>地图布局 AI（接口与模型）</summary>
        <div class="dym-hint">读世界书的地点条目、一次性给出坐标。与正文用的模型分开配置，默认沿用 MVU 的本地端点。</div>
        <div class="dym-field"><label>接口</label><input type="text" data-set="url" placeholder="http://localhost:1234/v1"></div>
        <div class="dym-field"><label>密钥</label>
          <span class="dym-pw">
            <input type="password" data-set="key" placeholder="留空表示接口不需要密钥" autocomplete="off">
            <button type="button" data-act="toggle-key" title="显示 / 隐藏密钥">${svgIcon(UI.eye, 14)}</button>
          </span>
        </div>
        <div class="dym-field"><label>模型</label>
          <select data-role="model-select"><option value="">（先点下面的「获取模型列表」）</option></select>
        </div>
        <div class="dym-field"><label>自定义</label><input type="text" data-set="model" placeholder="也可以直接手填模型名"></div>
        <div class="dym-row"><button class="dym-btn" data-act="fetch-models">获取模型列表</button>
          <button class="dym-btn" data-act="test-api">测试连接</button></div>
        <div class="dym-api-result" data-role="api-result"></div>
        <div class="dym-field"><label>上限</label><input type="number" data-set="maxTokens" step="1024"></div>
        <div class="dym-hint">上限 = <b>一次最多让模型写多少 token</b>（只是输出长度，不影响读进去的世界书）。
          生成底图正常十来条资料，<b>16384 够用</b>；要是哪天一次喂 100 多条（比如从控制台跑 <code>__worldMap.runLayout('all')</code>），
          就调到 <b>32768~65535</b>。<b>填太小会看到「模型返回为空」或 JSON 解析失败</b>——那就是被截断了，不是模型不行。
          有些服务端上限就是 65535，填更大反而会被拒。</div>
        <div class="dym-field"><label>温度</label><input type="number" data-set="temperature" step="0.1"></div>
        <div class="dym-hint">温度 = 随机性。<b>0.2~0.4</b> 最稳；调高会让它"发挥"，坐标就开始乱编。</div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="save-settings">保存设置</button></div>
      </details>

      <details class="dym-sec"><summary>生成底图（按世界书铺点）<span class="dym-ai">AI</span></summary>
        <div class="dym-hint">
          读世界书里的<b>地点类条目</b>（《玄天界介绍》《地点：X》这类总纲），一次性给出大域、主要势力、
          主要城池的坐标；已经人工拖过的点会跳过，不会覆盖。<br>
          定位顺序：<b>方位补充表（主）→ 坐标骨架 → 世界书条目（校验与补漏）</b>；
          条目与补充表冲突时以补充表为准，冲突会写进节点的备注。<br>
          想要更细的城内地点，在地图上双击下钻后<b>手动加</b>更稳（AI 细化很容易编出无意义的小点）。
        </div>
        <div class="dym-field dym-col"><label>方位补充表（先按它落点；格式：地名-方位-距离(亿里)，可写相对线索）</label>
          <textarea data-set="layoutSupplement" rows="9" placeholder="留空 = 不用补充表，纯按世界书条目定位"></textarea>
        </div>
        <div class="dym-hint">改完记得点「保存设置」再生成。示例见 <code>docs/底图补充.txt</code>；
          相对线索的写法：<code>距某地N</code>、<code>向某方向N到某地</code>、<code>正上/正下方</code>、<code>宽N</code>。</div>
        <div class="dym-row"><button class="dym-btn dym-primary" data-act="layout-world">生成底图<span class="dym-ai">AI</span></button></div>
        <div class="dym-hint">生成结果（用了哪些条目、新增/移动/丢弃多少、模型原始回复）会显示在下面这块，同时抄一份到「导出 / 导入」的文本框里方便留存。</div>
        <div class="dym-report" data-role="layout-report">还没跑过地图布局 AI。</div>
        <div class="dym-row"><button class="dym-btn dym-danger" data-act="clear-nodes">清空地图上所有地点</button></div>
        <div class="dym-hint">清空后底图上一个点都不剩（<b>轨迹数据不受影响</b>，画面上只剩轨迹线及其坐标）。
          要重来一遍时用它：先清空 → 再点「生成底图」。
          点一次会变成「再点一次确认清空」，<b>可以撤销</b>。</div>
      </details>

      <details class="dym-sec"><summary>底图来源（作者预设 / 内置骨架）</summary>
        <div class="dym-field"><label>预设</label><input type="text" data-set="presetUrl" placeholder="作者预设 JSON 的网址（jsdelivr 上的 GitHub 文件）"></div>
        <div class="dym-row">
          <button class="dym-btn" data-act="pull-preset">拉取作者预设</button>
          <button class="dym-btn" data-act="reset-map">恢复内置骨架</button>
        </div>
        <div class="dym-hint">拉取时<b>已锁定的点不会被覆盖</b>；「恢复内置骨架」会把整张底图换成内置的 54 个节点（可撤销）。</div>
      </details>

      <details class="dym-sec"><summary>导出 / 导入（可发给 AI 改坐标）</summary>
        <div class="dym-row">
          <button class="dym-btn" data-act="export-map">导出底图 JSON</button>
          <button class="dym-btn" data-act="export-anchors">导出锚点文本</button>
        </div>
        <textarea class="dym-io" data-role="io" spellcheck="false"
          placeholder="点上面两个按钮之一，内容会出现在这里。&#10;· 底图 JSON：完整节点表，发给 AI 批量改坐标最方便；&#10;· 锚点文本：一段「地名(坐标)｜…」，直接替换提示词里的固定锚点；&#10;· 生成报告也会写在这里。&#10;改完粘回这里再点「从文本框导入」即可。"></textarea>
        <div class="dym-row">
          <button class="dym-btn" data-act="copy-io">复制</button>
          <button class="dym-btn" data-act="download-io">存成文件</button>
          <button class="dym-btn" data-act="import-io">从文本框导入</button>
          <button class="dym-btn" data-act="pick-file">选文件</button>
        </div>
        <div class="dym-hint" data-role="io-hint">导出的文件会存到浏览器的下载目录；不确定的话直接用「复制」再粘到别处。</div>
      </details>

      <details class="dym-sec"><summary>坐标世界书与地理态势</summary>
        <div class="dym-hint">
          把底图同步成插件<b>自建</b>的世界书《世界舆图·坐标表》并挂到角色卡：<b>原世界书一个字不动</b>。
          正文提到某地才注入该地坐标（绿灯，不提不花 token）；每回合另注入一段「当前位置 + 周边 + 地界规则」。
          同步是<b>单向</b>的（底图 → 世界书）：在世界书里手改的坐标会被下次同步覆盖。
        </div>
        <div class="dym-row"><span class="dym-tag" data-role="geo-mount">…</span></div>
        <div class="dym-row">
          <button class="dym-btn dym-primary" data-act="geo-mount">生成并挂载坐标世界书</button>
          <button class="dym-btn" data-act="geo-sync">立即同步</button>
        </div>
        <div class="dym-api-result" data-role="geo-result"></div>
        <div class="dym-hint">「立即同步」= 按当前底图与设置**整体重写**《世界舆图·坐标表》：
          蓝灯的总纲/移动规则/叙事规则 3 条 + 当前已确认的地点条目（待定位的虚线圈本来就不进书）。
          切换会话后条目数量变化，多半是新会话的轨迹产生了新地点 —— 想清掉旧档地名就点下面的清理按钮。</div>
        <div class="dym-row">
          <button class="dym-btn" data-act="geo-remount">修复挂载（重新挂）</button>
          <button class="dym-btn" data-act="geo-unmount">卸载（解除绑定）</button>
          <button class="dym-btn dym-danger" data-act="geo-delete">删除坐标世界书</button>
        </div>
        <div class="dym-hint">「修复挂载」不碰书内容，只把角色卡上的绑定重写一遍并读回校验——
          状态显示「未挂载」或正文读不到坐标条目时点它（挂载接口报错、被别的脚本改了绑定都靠它恢复）。</div>
        <div class="dym-hint">挂载对齐成熟 DLC 的做法：追加为角色卡<b>附加世界书</b>（不碰主书），写完读回校验；
          卸载只解绑不删书。「删除」才是连书一起删（两步确认）。</div>
        <div class="dym-switches">
          <label><input type="checkbox" data-gset="coordEnabled"><span>底图变更后自动同步进世界书</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="coordTier4"><span>收录城内要点（tier 4：某宫某阁这类）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoEnabled"><span>每回合注入「地理态势」（关闭 = 只靠世界书条目）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoBounds"><span>注入地界规则（非本地势力需有理由才能生事）</span><span class="dym-track" aria-hidden="true"></span></label>
          <label><input type="checkbox" data-gset="geoJump"><span>位移超限时附「远行提示」</span><span class="dym-track" aria-hidden="true"></span></label>
        </div>
        <div class="dym-hint">坐标书里只有「设定里的地方」和确认过的城内要点；轨迹自动产生的待定位虚线圈本来就不进书。</div>
        <div class="dym-row">
          <button class="dym-btn" data-act="geo-preview">预览本回合态势（写入下方文本框）</button>
        </div>
        <div class="dym-field dym-col"><label>人物移动规则（蓝灯条目，随坐标书常驻注入）</label>
          <textarea data-gset-text="movementRules" rows="7" placeholder="各境界日行速度与移动方式…（保存后会作为 [舆图]人物移动规则 写进坐标书）"></textarea>
        </div>
        <div class="dym-switches"><label><input type="checkbox" data-gset="coordMovementOn"><span>把人物移动规则写进坐标书</span><span class="dym-track" aria-hidden="true"></span></label></div>
        <div class="dym-field dym-col"><label>叙事地理规则（蓝灯条目：坐标权威 + 远方事件隔离）</label>
          <textarea data-gset-text="narrativeRules" rows="7" placeholder="远方事件不串场、坐标数据优先于世界书条目方位…（保存后会作为 [舆图]叙事地理规则 写进坐标书）"></textarea>
        </div>
        <div class="dym-switches"><label><input type="checkbox" data-gset="coordNarrativeOn"><span>把叙事地理规则写进坐标书</span><span class="dym-track" aria-hidden="true"></span></label></div>
        <div class="dym-hint">两段文本都<b>已预填默认内容</b>，直接在框里改即可（失焦即保存，改完点「立即同步」写进书）。
          距离换算以总纲为准（1 坐标格 ≈ 15 亿里）；它们放蓝灯是为了「写剧情时一定在场」，
          且生效范围恰好等于坐标书本身：卸载坐标书，规则随之消失，不会变成死条目。</div>
        <div class="dym-hint" data-role="geo-hint"></div>
      </details>

      <details class="dym-sec"><summary>其他</summary>
        <div class="dym-row"><button class="dym-btn" data-act="export-trail">导出轨迹 JSON</button></div>
        <div class="dym-hint" data-role="settings-hint"></div>
      </details>`;
        settings.querySelector('[data-act=test-api]')?.addEventListener('click', () => this.actions.onTestApi());
        settings.querySelector('[data-act=fetch-models]')?.addEventListener('click', () => this.fetchModels());
        settings.querySelector('[data-act=save-settings]')?.addEventListener('click', () => this.collectSettings());
        settings.querySelector('[data-act=toggle-key]')?.addEventListener('click', () => {
            const input = settings.querySelector('[data-set=key]');
            input.type = input.type === 'password' ? 'text' : 'password';
        });
        settings.querySelector('[data-role=model-select]')?.addEventListener('change', event => {
            const value = event.target.value;
            if (!value)
                return;
            const input = settings.querySelector('[data-set=model]');
            if (input)
                input.value = value;
            this.collectSettings();
        });
        settings.querySelector('[data-act=layout-world]')?.addEventListener('click', () => this.actions.onRunLayout('world'));
        // 清空全部地点：两步确认（隐藏 iframe 里弹不了 confirm）
        const clearButton = settings.querySelector('[data-act=clear-nodes]');
        clearButton.addEventListener('click', () => {
            if (clearButton.dataset.armed === '1') {
                clearButton.dataset.armed = '';
                clearButton.textContent = '清空地图上所有地点';
                this.actions.onClearNodes();
                return;
            }
            clearButton.dataset.armed = '1';
            clearButton.textContent = '再点一次确认清空（可撤销）';
            setTimeout(() => {
                if (clearButton.dataset.armed === '1') {
                    clearButton.dataset.armed = '';
                    clearButton.textContent = '清空地图上所有地点';
                }
            }, 4000);
        });
        settings.querySelector('[data-act=pull-preset]')?.addEventListener('click', () => this.actions.onPullPreset());
        settings.querySelector('[data-act=reset-map]')?.addEventListener('click', () => this.actions.onResetBaseMap());
        settings.querySelector('[data-act=export-map]')?.addEventListener('click', () => {
            this.setIo(this.actions.onExportBaseMap(), '已生成完整底图 JSON：复制发给 AI 让它改坐标，改完粘回文本框再点「从文本框导入」。');
        });
        settings.querySelector('[data-act=export-anchors]')?.addEventListener('click', () => {
            this.setIo(this.actions.onExportAnchorText(), '这是可以直接替换提示词里「固定锚点」那一段的文本（照抄即可，坐标单位与地图一致）。');
        });
        settings.querySelector('[data-act=copy-io]')?.addEventListener('click', () => void this.copyIo());
        settings.querySelector('[data-act=download-io]')?.addEventListener('click', () => this.downloadIo());
        settings.querySelector('[data-act=import-io]')?.addEventListener('click', () => {
            const text = this.ioValue();
            if (!text.trim()) {
                this.setIoHint('文本框是空的，先粘贴 JSON 再导入。');
                return;
            }
            this.actions.onImportBaseMapText(text, message => this.setIoHint(message));
        });
        settings.querySelector('[data-act=pick-file]')?.addEventListener('click', () => this.fileInput.click());
        settings.querySelector('[data-act=export-trail]')?.addEventListener('click', () => this.actions.onExportTrail());
        // ── 坐标世界书与地理态势 ──
        settings.querySelector('[data-act=geo-mount]')?.addEventListener('click', () => this.actions.onMountCoordBook());
        settings.querySelector('[data-act=geo-sync]')?.addEventListener('click', () => this.actions.onSyncCoordBook());
        settings.querySelector('[data-act=geo-remount]')?.addEventListener('click', () => this.actions.onRemountCoordBook());
        settings.querySelector('[data-act=geo-unmount]')?.addEventListener('click', () => this.actions.onUnmountCoordBook());
        // 删书是破坏性动作：两步确认（隐藏 iframe 里弹不了 confirm）
        const geoDelete = settings.querySelector('[data-act=geo-delete]');
        geoDelete.addEventListener('click', () => {
            if (geoDelete.dataset.armed === '1') {
                geoDelete.dataset.armed = '';
                geoDelete.textContent = '删除坐标世界书';
                this.actions.onDeleteCoordBook();
                return;
            }
            geoDelete.dataset.armed = '1';
            geoDelete.textContent = '再点一次确认删除（解绑 + 删书）';
            setTimeout(() => {
                if (geoDelete.dataset.armed === '1') {
                    geoDelete.dataset.armed = '';
                    geoDelete.textContent = '删除坐标世界书';
                }
            }, 4000);
        });
        settings.querySelector('[data-act=geo-preview]')?.addEventListener('click', () => {
            const text = this.actions.onGeoPreview();
            this.setIo(text, '这是「地理态势」注入的原文（每回合按当前坐标现算，只在下一轮生成时进入模型上下文）。');
        });
        settings.querySelectorAll('[data-gset]').forEach(input => {
            input.addEventListener('change', () => this.collectGeoSettings());
        });
        // 规则文本框：失焦即保存（读当前 coordBook 全量、只覆盖对应字段，两个框互不覆盖）
        const movementInput = settings.querySelector('[data-gset-text=movementRules]');
        movementInput.addEventListener('change', () => {
            this.saveCoordBookField('movementRules', movementInput.value, '移动规则已保存。下次同步（挂载后自动 / 点「立即同步」）会写进坐标书蓝灯条目。');
        });
        const narrativeInput = settings.querySelector('[data-gset-text=narrativeRules]');
        narrativeInput.addEventListener('change', () => {
            this.saveCoordBookField('narrativeRules', narrativeInput.value, '叙事规则已保存。下次同步（挂载后自动 / 点「立即同步」）会写进坐标书蓝灯条目。');
        });
        this.fillSettings();
        this.fillGeoSettings();
    }
    ioPane() {
        return this.panes.get('settings');
    }
    ioValue() {
        return this.ioPane().querySelector('[data-role=io]')?.value ?? '';
    }
    setIo(text, hint) {
        const area = this.ioPane().querySelector('[data-role=io]');
        if (area) {
            area.value = text;
            area.focus();
            area.setSelectionRange(0, 0);
        }
        if (hint)
            this.setIoHint(hint);
    }
    setIoHint(text) {
        const hint = this.ioPane().querySelector('[data-role=io-hint]');
        if (hint)
            hint.textContent = text;
    }
    /**
     * 对外：显示一段生成报告。
     * 报告就写在「生成底图」那一段下面（同一个页签，不用来回找），
     * 同时抄一份进「导出 / 导入」的文本框，方便复制留存。
     */
    showReport(text, hint) {
        const pane = this.ioPane();
        const report = pane.querySelector('[data-role=layout-report]');
        if (report) {
            report.textContent = text;
            const section = report.closest('details');
            if (section)
                section.open = true;
            report.scrollIntoView({ block: 'nearest' });
        }
        const area = pane.querySelector('[data-role=io]');
        if (area)
            area.value = text;
        this.setIoHint(hint);
        this.setTab('settings');
    }
    /** 轻操作（获取模型/测试连接）的就地结果：写在按钮下面的小结果条里，不滚动、不跳页签 */
    showApiResult(text, role = 'api-result') {
        const box = this.ioPane().querySelector(`[data-role=${role}]`);
        if (box) {
            box.textContent = text;
            box.scrollTop = 0;
        }
    }
    /** 坐标世界书操作（挂载/同步/修复/删除）的就地结果：显示在本节按钮下方 */
    showGeoResult(text) {
        this.showApiResult(text, 'geo-result');
    }
    /** AI 整理本会话地点的就地结果：显示在轨迹页按钮下方 */
    showTrailResult(text) {
        this.showApiResult(text, 'trail-result');
    }
    async copyIo() {
        const text = this.ioValue();
        if (!text) {
            this.setIoHint('文本框是空的。');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            this.setIoHint(`已复制 ${text.length} 个字符到剪贴板。`);
        }
        catch {
            // 非安全上下文等情况下退回"全选 + 提示手动复制"
            const area = this.ioPane().querySelector('[data-role=io]');
            area?.focus();
            area?.select();
            this.setIoHint('这个环境不允许自动写剪贴板，已帮你全选，按 Ctrl+C 即可。');
        }
    }
    downloadIo() {
        const text = this.ioValue();
        if (!text) {
            this.setIoHint('文本框是空的。');
            return;
        }
        try {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = this.doc.createElement('a');
            anchor.href = url;
            anchor.download = `世界舆图底图-${new Date().toISOString().slice(0, 10)}.json`;
            this.doc.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            this.setIoHint('已触发下载，文件在浏览器的下载目录里；收不到就用「复制」。');
        }
        catch (error) {
            this.setIoHint(`下载失败：${String(error)}。请改用「复制」。`);
        }
    }
    fillSettings() {
        const pane = this.panes.get('settings');
        const api = this.data.settings?.api;
        const map = {
            url: api?.url,
            key: api?.key,
            model: api?.model,
            maxTokens: api?.maxTokens,
            temperature: api?.temperature,
            presetUrl: this.data.settings?.presetUrl,
            layoutSupplement: this.data.settings?.layoutSupplement ?? '',
        };
        pane.querySelectorAll('[data-set]').forEach(input => {
            if (document.activeElement === input)
                return;
            const value = map[input.dataset.set];
            input.value = value === undefined || value === null ? '' : String(value);
        });
    }
    /** 坐标世界书 / 态势注入的开关回填 */
    fillGeoSettings() {
        const pane = this.panes.get('settings');
        const geo = this.data.settings?.geoContext;
        const book = this.data.settings?.coordBook;
        const values = {
            coordEnabled: Boolean(book?.enabled),
            coordTier4: book?.includeTier4 !== false,
            coordMovementOn: book?.movementRulesEnabled !== false,
            coordNarrativeOn: book?.narrativeRulesEnabled !== false,
            geoEnabled: geo?.enabled !== false,
            geoBounds: geo?.enforceBounds !== false,
            geoJump: geo?.jumpNotice !== false,
        };
        pane.querySelectorAll('[data-gset]').forEach(input => {
            const value = values[input.dataset.gset];
            if (typeof value === 'boolean')
                input.checked = value;
        });
        const movement = pane.querySelector('[data-gset-text=movementRules]');
        if (movement && document.activeElement !== movement)
            movement.value = book?.movementRules ?? '';
        const narrative = pane.querySelector('[data-gset-text=narrativeRules]');
        if (narrative && document.activeElement !== narrative)
            narrative.value = book?.narrativeRules ?? '';
    }
    /** 规则文本框保存：读当前 coordBook 全量、只覆盖指定字段（两个文本框互不覆盖、不冲掉复选框） */
    saveCoordBookField(field, value, savedHint) {
        const book = this.data.settings?.coordBook;
        this.actions.onSaveSettings({
            coordBook: {
                enabled: Boolean(book?.enabled),
                includeTier4: book?.includeTier4 !== false,
                maxEntries: book?.maxEntries ?? 200,
                movementRulesEnabled: book?.movementRulesEnabled !== false,
                narrativeRulesEnabled: book?.narrativeRulesEnabled !== false,
                movementRules: book?.movementRules ?? '',
                narrativeRules: book?.narrativeRules ?? '',
                [field]: value,
            },
        });
        const hint = this.panes.get('settings').querySelector('[data-role=geo-hint]');
        if (hint) {
            hint.textContent = value.trim() ? `已保存。${savedHint}` : '已保存为空文本：下次同步会移除对应的规则条目（想保留文本只停用，请取消上面那个勾）。';
        }
    }
    /** 开关即时保存（不用再去点「保存设置」）；数量类参数沿用当前值 */
    collectGeoSettings() {
        const pane = this.panes.get('settings');
        const checked = (key) => Boolean(pane.querySelector(`[data-gset=${key}]`)?.checked);
        const text = (key) => pane.querySelector(`[data-gset-text=${key}]`)?.value ?? this.data.settings?.coordBook?.[key] ?? '';
        this.actions.onSaveSettings({
            coordBook: {
                enabled: checked('coordEnabled'),
                includeTier4: checked('coordTier4'),
                maxEntries: this.data.settings?.coordBook?.maxEntries ?? 200,
                movementRulesEnabled: checked('coordMovementOn'),
                narrativeRulesEnabled: checked('coordNarrativeOn'),
                movementRules: text('movementRules'),
                narrativeRules: text('narrativeRules'),
            },
            geoContext: {
                enabled: checked('geoEnabled'),
                depth: this.data.settings?.geoContext?.depth ?? 1,
                role: this.data.settings?.geoContext?.role ?? 'system',
                nearbyCount: this.data.settings?.geoContext?.nearbyCount ?? 6,
                enforceBounds: checked('geoBounds'),
                jumpNotice: checked('geoJump'),
            },
        });
        const hint = pane.querySelector('[data-role=geo-hint]');
        if (hint)
            hint.textContent = '已保存。挂载状态下底图变更会自动同步进世界书；态势开关下一轮生成生效。';
    }
    /** 把模型列表填进下拉框；选中下拉里的一项就会直接替换「模型」输入框，不用手打 */
    fillModels(models) {
        const pane = this.panes.get('settings');
        const select = pane.querySelector('[data-role=model-select]');
        if (!select)
            return;
        select.innerHTML =
            `<option value="">（共 ${models.length} 个，点这里选）</option>` +
                models.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
        const current = pane.querySelector('[data-set=model]')?.value;
        if (current && models.includes(current))
            select.value = current;
    }
    /** 点「获取模型列表」：拉 /models 填进下拉，选中即替换模型框，不用先清空手打 */
    async fetchModels() {
        const pane = this.panes.get('settings');
        const button = pane.querySelector('[data-act=fetch-models]');
        if (button) {
            button.disabled = true;
            button.textContent = '拉取中…';
        }
        let base = '';
        let key = '';
        try {
            // 这里一律不用可选链以外的读取方式：点一下按钮就抛异常、界面上毫无反馈是最糟的体验
            const urlInput = pane.querySelector('[data-set=url]');
            const keyInput = pane.querySelector('[data-set=key]');
            base = String(urlInput?.value || this.data.settings?.api?.url || '').trim().replace(/\/+$/, '');
            key = String(keyInput?.value || this.data.settings?.api?.key || '');
            if (!base)
                throw new Error('还没填接口地址（形如 http://localhost:1234/v1）');
            const models = await this.listModels(base, key);
            if (!models.length)
                throw new Error(`${base}/models 没有返回任何模型`);
            this.fillModels(models);
            if (button)
                button.textContent = `已获取 ${models.length} 个`;
            this.showApiResult(`【获取模型列表】成功\n接口：${base}\n共 ${models.length} 个：\n` +
                models.map(id => `  · ${id}`).join('\n') +
                `\n\n选一个（下拉框或「自定义」框）再点「保存设置」。`);
            toast('success', `已获取 ${models.length} 个模型，结果在按钮下方`);
        }
        catch (error) {
            const message = String(error instanceof Error ? error.message : error);
            if (button)
                button.textContent = `失败：${message.slice(0, 30)}`;
            let detail = '';
            try {
                detail = base ? await this.describeEndpoint(base) : '';
            }
            catch {
                detail = '';
            }
            this.showApiResult(`【获取模型列表】失败\n接口：${base || '(未填写)'}\n密钥：${key ? '已填写' : '(空)'}\n原因：${message}${detail}\n`);
            toast('error', `获取模型列表失败：${message.slice(0, 60)}${detail}`);
        }
        finally {
            if (button) {
                button.disabled = false;
                setTimeout(() => {
                    button.textContent = '获取模型列表';
                }, 4000);
            }
        }
    }
    async listModels(base, key) {
        let response;
        try {
            response = await fetch(`${base}/models`, {
                headers: key ? { Authorization: `Bearer ${key}` } : {},
            });
        }
        catch (error) {
            throw new Error(`连不上 ${base}/models（${String(error)}）`);
        }
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${response.statusText}` +
                (response.status === 401 || response.status === 403 ? '（密钥不对或没权限）' : '') +
                (body ? `｜${body.slice(0, 160)}` : ''));
        }
        const data = (await response.json());
        return (data?.data ?? []).map(item => String(item.id ?? '')).filter(Boolean).sort();
    }
    /** 失败时补一句人话：接口到底通不通 */
    async describeEndpoint(base) {
        try {
            const response = await fetch(`${base}/models`, { method: 'GET' });
            if (response.ok)
                return '';
            const body = await response.text().catch(() => '');
            if (response.status === 401 || response.status === 403)
                return '（密钥可能不对或没填）';
            return `（接口返回 ${response.status}：${body.slice(0, 80)}）`;
        }
        catch (error) {
            return `（连不上 ${base}：${String(error).slice(0, 80)}）`;
        }
    }
    collectSettings() {
        const pane = this.panes.get('settings');
        const read = (key) => pane.querySelector(`[data-set=${key}]`)?.value ?? '';
        this.actions.onSaveSettings({
            api: {
                url: read('url').trim() || this.data.settings?.api?.url || '',
                key: read('key'),
                model: read('model').trim(),
                maxTokens: Number(read('maxTokens')) || 8192,
                temperature: Number(read('temperature')) || 0,
            },
            presetUrl: read('presetUrl').trim(),
            layoutSupplement: read('layoutSupplement'),
        });
    }
    bindChrome() {
        const bar = this.root.querySelector('.dym-titlebar');
        // 标题栏按钮里是 SVG 图标：点击目标可能是 <svg>/<path>，必须用 closest 找到带 data-act 的按钮
        const actOf = (target) => target?.closest?.('[data-act]')?.dataset?.act;
        bar.addEventListener('click', event => {
            const act = actOf(event.target);
            if (act === 'drawer')
                this.toggleDrawer();
            else if (act === 'locate')
                this.actions.onLocateCurrent();
            else if (act === 'fit')
                this.actions.onFit();
            else if (act === 'close')
                this.close();
        });
        this.root.querySelector('[data-act=zoom-in]')?.addEventListener('click', () => this.data.canvas.zoomBy(1.25));
        this.root.querySelector('[data-act=zoom-out]')?.addEventListener('click', () => this.data.canvas.zoomBy(1 / 1.25));
        // 拖动标题栏（贴边窄条状态下拖动 = 从边上拖出来）
        let dragging = null;
        bar.addEventListener('pointerdown', event => {
            // 点在按钮（含其内部 SVG）上时不启动拖拽，否则 setPointerCapture 会把 click 吃掉
            if (actOf(event.target))
                return;
            dragging = {
                x: event.clientX,
                y: event.clientY,
                ox: this.root.offsetLeft,
                oy: this.root.offsetTop,
                undocked: false,
            };
            bar.setPointerCapture(event.pointerId);
        });
        bar.addEventListener('pointermove', event => {
            if (!dragging)
                return;
            const dx = event.clientX - dragging.x;
            const dy = event.clientY - dragging.y;
            if (this.isRail() && !dragging.undocked) {
                if (Math.abs(dx) + Math.abs(dy) < 8)
                    return; // 还没拖动，先当作待判定点击
                dragging.undocked = true;
                const rect = this.root.getBoundingClientRect();
                this.exitRail();
                this.root.style.left = `${rect.left}px`;
                this.root.style.right = 'auto';
                this.root.style.top = `${Math.max(0, rect.top)}px`;
                dragging.ox = rect.left;
                dragging.oy = rect.top;
                dragging.x = event.clientX;
                dragging.y = event.clientY;
                return;
            }
            const x = dragging.ox + (event.clientX - dragging.x);
            const y = dragging.oy + (event.clientY - dragging.y);
            this.root.style.left = `${Math.max(-40, Math.min(this.host.innerWidth - 60, x))}px`;
            this.root.style.right = 'auto';
            this.root.style.top = `${Math.max(0, y)}px`;
        });
        bar.addEventListener('pointerup', event => {
            if (!dragging)
                return;
            const moved = dragging.undocked || Math.abs(event.clientX - dragging.x) + Math.abs(event.clientY - dragging.y) > 6;
            dragging = null;
            if (!moved && this.isRail()) {
                // 单击书签：直接把整个窗口从边上放出来（不需要拖拽）
                this.openFromRail();
                return;
            }
            this.snapDock();
            this.persistLayout();
        });
        // 注意：这里**刻意不做悬停展开**。鼠标扫过书签时它保持原样不动，
        // 只有单击才开窗 —— 悬停就变大会在鼠标路过页面边缘时乱跳。
        // 右下角缩放
        const handle = this.root.querySelector('.dym-resize');
        let resizing = null;
        handle.addEventListener('pointerdown', event => {
            if (this.isRail())
                this.exitRail();
            resizing = { x: event.clientX, y: event.clientY, w: this.root.offsetWidth, h: this.root.offsetHeight };
            this.root.classList.add('dym-resizing');
            handle.setPointerCapture(event.pointerId);
            event.stopPropagation();
        });
        handle.addEventListener('pointermove', event => {
            if (!resizing)
                return;
            this.root.style.width = `${Math.max(380, resizing.w + (event.clientX - resizing.x))}px`;
            this.root.style.height = `${Math.max(260, resizing.h + (event.clientY - resizing.y))}px`;
            this.data.canvas.render();
        });
        handle.addEventListener('pointerup', () => {
            resizing = null;
            this.root.classList.remove('dym-resizing');
            this.persistLayout();
        });
        this.host.addEventListener('resize', () => this.data.canvas.render());
        // Delete / Backspace 删除选中节点（编辑模式下）
        this.doc.addEventListener('keydown', event => {
            if (!this.isOpen())
                return;
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
                return;
            if ((event.key === 'Delete' || event.key === 'Backspace') && this.data.selectedId) {
                event.preventDefault();
                this.actions.onDeleteNode(this.data.selectedId);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.actions.onSelectNode(null);
            }
        });
    }
    // ── 贴边自动缩进（"抽屉"）────────────────────────────────────────────
    railTop = 0;
    isRail() {
        return this.root.classList.contains('dym-rail');
    }
    /** 贴到左/右侧：立刻收成一条"索引标贴"那样的小书签 */
    enterRail(side) {
        this.dockSide = side;
        const rect = this.root.getBoundingClientRect();
        this.data.layout.w = Math.max(320, Math.round(rect.width));
        this.data.layout.h = Math.max(240, Math.round(rect.height));
        this.data.layout.y = Math.max(0, Math.round(rect.top));
        this.root.classList.add('dym-rail');
        this.root.classList.toggle('dym-rail-left', side === 'left');
        // 小书签：一两百像素高，贴在页面边缘，不挡正文
        const railHeight = Math.min(190, Math.max(112, Math.round(this.host.innerHeight * 0.19)));
        const railTop = Math.min(Math.max(8, rect.top), Math.max(8, this.host.innerHeight - railHeight - 8));
        this.railTop = railTop;
        this.root.style.height = `${railHeight}px`;
        this.root.style.top = `${railTop}px`;
        this.root.style.width = `${this.railWidth()}px`;
        if (side === 'right') {
            this.root.style.right = '0px';
            this.root.style.left = 'auto';
        }
        else {
            this.root.style.left = '0px';
            this.root.style.right = 'auto';
        }
        this.data.canvas.render();
    }
    railWidth() {
        return this.data.layout.railWidth || 30;
    }
    /** 悬停/点击时把书签临时展开成可用的大小（连高度一起还原，否则只有一条缝看不清） */
    openFromRail() {
        if (!this.isRail())
            return;
        this.exitRail();
        this.persistLayout();
    }
    /** 离开贴边状态，恢复原来的尺寸 */
    exitRail() {
        if (!this.isRail())
            return;
        this.root.classList.remove('dym-rail');
        this.dockSide = null;
        const width = this.data.layout.w;
        const height = Math.min(this.data.layout.h, Math.max(240, this.host.innerHeight - 16));
        const top = Math.min(Math.max(8, this.railTop), Math.max(8, this.host.innerHeight - height - 8));
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
        this.root.style.top = `${top}px`;
        requestAnimationFrame(() => this.data.canvas.render());
    }
    /** 松手时距边缘足够近就贴边收进去 */
    snapDock() {
        const rect = this.root.getBoundingClientRect();
        const width = this.host.innerWidth;
        if (rect.left <= this.edgeThreshold) {
            this.enterRail('left');
        }
        else if (width - rect.right <= this.edgeThreshold) {
            this.enterRail('right');
        }
        else if (this.isRail()) {
            this.exitRail();
        }
        else {
            this.dockSide = null;
        }
    }
    persistLayout() {
        const rect = this.root.getBoundingClientRect();
        // 窗口还没显示（display:none）时 rect 全是 0，写回去会把布局写坏
        if (rect.width < 40 || rect.height < 40)
            return;
        const rail = this.isRail();
        const rightSide = this.dockSide === 'right' || this.host.innerWidth - rect.right < rect.left;
        Object.assign(this.data.layout, {
            x: rightSide ? -1 : Math.round(rect.left),
            y: Math.round(rect.top),
            w: rail ? this.data.layout.w : Math.round(rect.width),
            h: rail ? this.data.layout.h : Math.round(rect.height),
            collapsed: this.root.classList.contains('dym-collapsed'),
            drawerOpen: !this.root.classList.contains('dym-drawer-off'),
            tab: this.currentTab,
            docked: rail ? this.dockSide : null,
        });
        // 键名与 store.ts 的 LOCAL_PREFIX + 'layout' 对齐：之前写成 worldmap_local_layout，
        // 读的却是 worldmap_map_local_layout，布局（位置/尺寸/页签）从来没被真正恢复过。
        try {
            localStorage.setItem('worldmap_map_local_layout', JSON.stringify(this.data.layout));
        }
        catch {
            /* 忽略 */
        }
    }
    currentTab = 'places';
    applyLayout(layout) {
        const width = layout.w || 620;
        const height = layout.h || 500;
        this.root.style.width = `${width}px`;
        this.root.style.height = `${height}px`;
        const maxX = Math.max(0, this.host.innerWidth - width - 8);
        const x = layout.x === undefined || layout.x < 0 ? maxX : Math.min(maxX, layout.x);
        const y = Math.min(Math.max(0, this.host.innerHeight - 120), Math.max(0, layout.y ?? 96));
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        if (this.host.innerWidth < 720)
            this.root.classList.add('dym-narrow');
        // 最小化按钮已移除：即便旧布局里存着 collapsed，也强制展开，避免出现"打不开"的窗口
        this.root.classList.remove('dym-collapsed');
        if (layout.collapsed)
            this.data.layout.collapsed = false;
        this.setTab(layout.tab ?? 'places');
        this.toggleDrawer(layout.drawerOpen === false);
        if (layout.docked)
            this.enterRail(layout.docked);
    }
    setTab(tab) {
        this.currentTab = tab;
        for (const [key, button] of this.tabButtons)
            button.classList.toggle('dym-active', key === tab);
        for (const [key, pane] of this.panes)
            pane.classList.toggle('dym-active', key === tab);
    }
    toggleCollapsed() {
        const collapsed = this.root.classList.toggle('dym-collapsed');
        this.root.classList.toggle('dym-collapsed-hidden', false);
        this.persistLayout();
        if (!collapsed)
            this.data.canvas.render();
    }
    /** 收起 / 展开右侧栏（收起后画布占满窗口，把手留在右沿） */
    toggleDrawer(force) {
        const off = force === undefined ? !this.root.classList.contains('dym-drawer-off') : force;
        this.root.classList.toggle('dym-drawer-off', off);
        this.data.layout.drawerOpen = !off;
        this.drawerHandle.innerHTML = svgIcon(off ? UI.chevLeft : UI.chevRight, 12);
        this.drawerHandle.title = off ? '展开右侧栏' : '收起右侧栏';
        const barButton = this.root.querySelector('[data-act=drawer]');
        if (barButton) {
            barButton.innerHTML = svgIcon(UI.panelRight, 15);
            barButton.classList.toggle('dym-on', off);
            barButton.title = off ? '展开右侧栏' : '收起右侧栏';
        }
        this.persistLayout();
        requestAnimationFrame(() => this.data.canvas.render());
    }
    close() {
        this.exitRail();
        this.root.style.display = 'none';
        // 不做悬浮球：关掉就是关掉，重新打开走快捷回复栏的「世界舆图」按钮
        this.data.layout = { ...this.data.layout, collapsed: false };
    }
    open() {
        this.root.style.display = 'flex';
        requestAnimationFrame(() => this.data.canvas.render());
    }
    isOpen() {
        return this.root.style.display !== 'none';
    }
    render(data) {
        this.data = { ...this.data, ...data };
        const { canvas } = this.data;
        const view = canvas.getView();
        this.badge.textContent = this.data.currentPath ? this.data.currentPath.split('·').slice(-2).join('·') : '尚未启程';
        this.badge.title = this.data.currentPath ?? '';
        // 面包屑：以当前聚焦链的根节点作为起点，没有聚焦时显示默认舞台
        const chain = view.focusId ? canvas.getView().graph.ancestors(view.focusId) : [];
        if (chain.length) {
            this.breadcrumb.innerHTML =
                `<span data-focus="">全图</span>` +
                    chain.map(node => ` <i>›</i> <span data-focus="${node.id}">${escapeHtml(node.name)}</span>`).join('');
        }
        else {
            this.breadcrumb.innerHTML = `<b>全图 · 双击节点下钻</b>`;
        }
        this.breadcrumb.querySelectorAll('[data-focus]').forEach(item => {
            item.addEventListener('click', () => this.actions.onFocusNode(item.dataset.focus || null));
        });
        // 图层开关
        const layers = this.panes.get('layers');
        layers.querySelectorAll('[data-layer]').forEach(input => {
            const key = input.dataset.layer;
            input.checked = Boolean(view[key]);
        });
        const unplaced = canvas.getView().graph.toArray().filter(node => node.status === 'unplaced').length;
        const hint = layers.querySelector('[data-role=layer-hint]');
        if (hint)
            hint.textContent = `节点 ${canvas.getView().graph.size} 个，其中待定位 ${unplaced} 个。待定位节点由轨迹自动落点产生，确认位置后可拖动微调。`;
        // 选中信息
        const edit = this.panes.get('edit');
        const selected = this.data.selectedId ? canvas.getView().graph.get(this.data.selectedId) : undefined;
        edit.querySelector('[data-role=selected-info]').textContent = selected
            ? `${selected.path}\n${canvas.describeNode(selected)}｜来源 ${selected.source}${selected.locked ? '｜已锁定' : ''}`
            : '未选中节点。';
        const nameInput = edit.querySelector('[data-role=node-name]');
        const xInput = edit.querySelector('[data-role=node-x]');
        const yInput = edit.querySelector('[data-role=node-y]');
        const tierSelect = edit.querySelector('[data-role=node-tier]');
        if (document.activeElement !== nameInput)
            nameInput.value = selected?.name ?? '';
        if (document.activeElement !== xInput)
            xInput.value = selected ? String(selected.xy[0]) : '';
        if (document.activeElement !== yInput)
            yInput.value = selected ? String(selected.xy[1]) : '';
        if (tierSelect && document.activeElement !== tierSelect)
            tierSelect.value = selected?.tier ? String(selected.tier) : '';
        tierSelect.disabled = !selected;
        const editToggle = edit.querySelector('[data-role=edit-mode]');
        editToggle.checked = this.data.editMode;
        // 固定位置按钮：跟随选中点的状态
        const pinButton = edit.querySelector('[data-act=toggle-pin]');
        if (pinButton) {
            const selected = this.data.selectedId ? this.data.canvas.getView().graph.get(this.data.selectedId) : undefined;
            pinButton.textContent = selected?.pinned ? '取消固定' : '固定位置';
            pinButton.disabled = !selected;
            pinButton.title = '固定后：框选与批量拖动会跳过该点（直接拖仍可移动）';
        }
        edit.querySelector('[data-act=undo]').disabled = !this.data.canUndo;
        edit.querySelector('[data-act=redo]').disabled = !this.data.canRedo;
        // 轨迹
        const trailPane = this.panes.get('trail');
        const trailHint = trailPane.querySelector('[data-role=trail-hint]');
        trailHint.textContent = this.data.trail.length
            ? `共 ${this.data.trail.length} 个轨迹点，已隐藏 ${this.data.hiddenPointIds.size} 个。` +
                (view.trailCityOnly
                    ? '当前画的是「市级以上」的走位（城内小点不参与连线，可在「图层」页签关掉这个限制）。'
                    : '当前画的是全部层级（城中细节也连线，容易糊成一团）。')
            : '还没有轨迹。装好提示词后新回合会自动落点，也可以点「从聊天记录重算」。';
        const trailList = trailPane.querySelector('[data-role=trail-list]');
        const graphView = this.data.canvas.getView().graph;
        const ordered = this.data.trail.slice().sort((a, b) => (a.seq ?? a.messageId) - (b.seq ?? b.messageId));
        trailList.innerHTML = ordered
            .reverse()
            .map(point => {
            const hidden = this.data.hiddenPointIds.has(point.id);
            const orphan = point.orphan ? '<span class="dym-tag dym-orphan" title="这一楼已不在聊天里，但轨迹保留">留</span>' : '';
            // 节点失联：底图里已经找不到这个地点（被清空/重建/换会话 id 对不上）
            const dead = !graphView.get(point.nodeId) && !(point.path && graphView.byPath.get(point.path))
                ? '<span class="dym-tag dym-orphan" title="底图里已找不到该地点，轨迹线在此断开；重新生成底图或手补该地点即可接回">失</span>'
                : '';
            return `<li data-point="${escapeHtml(point.id)}" style="opacity:${hidden ? 0.45 : 1}">
          <span class="dym-dot" style="background:#a3462a"></span>
          <span class="dym-name">楼${point.messageId}·${escapeHtml(point.path.split('·').slice(-2).join('·'))}</span>
          <span class="dym-tag">${escapeHtml(point.kind)}</span>${orphan}${dead}
        </li>`;
        })
            .join('');
        trailList.querySelectorAll('[data-point]').forEach(item => {
            const point = this.data.trail.find(candidate => candidate.id === item.dataset.point);
            if (!point)
                return;
            item.addEventListener('click', () => this.actions.onJumpToPoint(point));
            item.addEventListener('contextmenu', event => {
                event.preventDefault();
                this.actions.onTogglePointHidden(point.id);
            });
        });
        // 时间轴
        const max = Math.max(0, this.data.trail.length - 1);
        this.timelineInput.max = String(max);
        this.timelineInput.value = String(this.data.timelineIndex === null ? max : Math.min(this.data.timelineIndex, max));
        const shown = this.data.timelineIndex === null ? this.data.trail.length : Math.min(this.data.timelineIndex + 1, this.data.trail.length);
        const point = this.data.trail[shown - 1];
        this.timelineLabel.textContent = point ? `楼${point.messageId} ${point.t.slice(0, 12)}` : '无轨迹';
        this.statusBar.textContent = this.data.busy ? this.data.busy : this.data.status;
        this.statusBar.style.color = this.data.busy ? '#a3462a' : '#6a5433';
        const settingsHint = this.panes.get('settings').querySelector('[data-role=settings-hint]');
        if (settingsHint)
            settingsHint.textContent = this.data.presetError ? `作者预设：${this.data.presetError}` : '';
        const geoMount = this.panes.get('settings').querySelector('[data-role=geo-mount]');
        if (geoMount) {
            geoMount.textContent = this.data.geoStatus ?? '…';
            geoMount.title = this.data.geoStatus ?? '';
        }
        // 地点列表
        this.renderPlaceList();
        canvas.render();
    }
    renderPlaceList() {
        const list = this.panes.get('places').querySelector('[data-role=place-list]');
        const keyword = this.searchInput?.value?.trim() ?? '';
        const nodes = this.data.canvas
            .getView()
            .graph.toArray()
            .filter(node => (keyword ? node.path.includes(keyword) : true))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh'));
        const shown = nodes.slice(0, 400);
        list.innerHTML = shown
            .map(node => {
            const selected = node.id === this.data.selectedId ? ' class="dym-selected"' : '';
            return `<li${selected} data-node="${node.id}">
          <span class="dym-dot" style="background:${KIND_COLORS[node.kind]}"></span>
          <span class="dym-name${node.status === 'unplaced' ? ' dym-unplaced' : ''}">${escapeHtml(node.name)}</span>
          <span class="dym-tag">${KIND_LABELS[node.kind]}${node.depth ? '·' + node.depth : ''}</span>
        </li>`;
        })
            .join('');
        list.querySelectorAll('[data-node]').forEach(item => {
            const id = item.dataset.node;
            item.addEventListener('click', () => this.actions.onSelectNode(id));
            item.addEventListener('dblclick', () => this.actions.onFocusNode(id));
        });
        if (nodes.length > shown.length) {
            list.insertAdjacentHTML('beforeend', `<li style="cursor:default">… 还有 ${nodes.length - shown.length} 个，请输入关键词缩小范围</li>`);
        }
    }
    /** 右键节点：选中并跳到编辑页签（不用系统对话框，避免隐藏 iframe 里的弹窗问题） */
    contextMenu(node) {
        this.actions.onSelectNode(node.id);
        this.setTab('edit');
        this.open();
    }
    /** 选中并跳转到编辑页签，供「加子节点」等操作复用 */
    selectForEdit(id) {
        this.actions.onSelectNode(id);
        this.setTab('edit');
    }
    destroy() {
        this.root.remove();
    }
}
//# sourceMappingURL=window.js.map