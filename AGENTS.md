# 世界舆图 · 项目规则（给 AI 编程助手）

本仓库是一个**酒馆助手（JS-Slash-Runner, JSR）脚本**，为 TauriTavern 里的角色卡提供
「世界书坐标底图 + 玩家轨迹」的可视化舆图。改代码前请先读本文件。

## 一、本机环境的硬约束（踩过的坑，别再踩）

1. **禁止以管道 stdio 派生子进程**：node 在本沙箱下 `spawn` 会因为命名管道被拒而 `EPERM`。
   因此 **esbuild / vite / webpack CLI / `tsc --watch` / `npm run` 里嵌套的构建器全都不可用**。
   - 转译走 `tools/transpile.mjs`（`ts.transpileModule`，进程内，12 个文件约 300ms）。
   - 类型检查走 `tools/typecheck.mjs`（`ts.createProgram`，约 3 秒，独立进程跑，别放进 watch 热路径）。
   - npm 安装必须带 `--cache <工程内目录>`，否则写默认缓存目录会被拒。
2. **沙箱到 `github.com` 不通**，`git clone` / `git push` / `git ls-remote` 一概失败：
   - 默认 schannel 后端：`schannel: server closed abruptly (missing close_notify)`；
   - 换 `-c http.sslBackend=openssl`：`CONNECT tunnel failed, response 502`（有 CONNECT 代理）。
   - **但 `api.github.com` 是通的**（实测 HTTP 200），`https://github.com/...` 网页地址超时。
   → 需要读写 GitHub 时走 **REST API**（`Invoke-RestMethod`），不要指望 git 协议。
     提交整棵树用 Git Data API（`POST /git/blobs` → `/git/trees` → `/git/commits` → 强制更新 `PATCH /git/refs/heads/main`）。
   本机凭据管理器里已有 `git:https://github.com` 的登录凭据，**用户自己在终端里 `git push` 是可以的**。
3. 需要外部代码时用 `web_fetch` 拿文件内容，或者干脆自己写。
4. **Chrome 无头模式不可用**（mojo 命名管道被拒）。验证界面用：
   - 开发服务器 + `tools/harness.html`（合成数据试验台，自轮询热重载）；
   - 自检结果写进 `document.title`，用 `Get-Process chrome | Select MainWindowTitle` 直接读，
     比截图 OCR 精确得多；
   - 需要看画面时用 `computer_screenshot` + `image_scan`（`computer_click`/`computer_keypress`
     需要用户批准，能不用就不用）。
5. **改文本文件不要用 PowerShell 的 `Get-Content | Set-Content`**：会把 UTF-8 中文读成 ANSI 再写出，
   造成乱码。用文件工具，或 `[System.IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false))`。
6. **Bash 工具在本机不可用**（PATH 没注入，`ls`/`head`/`mkdir` 都是 `command not found`）。
   一律用 PowerShell 工具；且它的 stdout 有时不回显，**需要看输出就先落盘再读文件**。

## 二、JSR 4.9.3 的关键事实（已逐条核对源码，勿凭印象写）

- 脚本跑在**隐藏的 `<script type="module">` iframe** 里，同源、无 sandbox。
  - `$` 是**酒馆主页面的 jQuery**（`$('body')` 就是酒馆页面）；
  - 裸 `document` 是**脚本 iframe 自己的文档**，界面必须建在 `window.parent.document` 上；
  - `window.innerWidth/Height` 是 iframe 的尺寸 —— 凡是相对宿主视口的计算（悬浮窗定位/贴边/尺寸钳制）
    都必须用 `window.parent.innerWidth`；
  - 卸载要自己清理：`$(window).on('pagehide', …)` + 移除自己注入的 DOM。
- **不存在** `iframe()` / `TavernHelper.iframe` / `TavernHelper.eventOn` / `eventOff` /
  `eventOn(...,{once:true})` / `setVariables` / `assignVariables` / 注册斜杠命令的公开 API /
  CDN 白名单 / chat·message 作用域的脚本。
- 事件：`eventOn(tavern_events.XXX, fn)`，返回值 `.stop()` 在 4.9.3 **是空操作**，取消监听请用
  `eventRemoveListener(事件名, 原始具名函数)`；iframe 卸载时会自动 `eventClearAll()`。
  `CHAT_CHANGED` 的值是 `'chat_id_changed'`；消息类事件的第一个参数会被强制 `parseInt`。
- 变量：作用域只有 `chat/character/global/message/preset/script/extension`。
  **`replaceVariables` 是整体替换**（会把别人的键抹掉），增量一律用 `insertOrAssignVariables`。
- MVU：`await waitGlobalInitialized('Mvu')` 后用 `Mvu.getMvuData({type:'chat'})`；
  事件常量在 `Mvu.events.VARIABLE_UPDATE_ENDED`（回调是 `(新值, 旧值)` 两个位置参数）。
- TauriTavern 特有问题：**流式渲染被禁用**；`#chat > .mes` 只有当前投影，
  **不要用 DOM 统计楼层数**，用 `getChatMessages()` / `getLastMessageId()`。

## 三、本项目的约定

1. **模块纪律**（`tools/release.mjs` 里的迷你打包器要求）：
   - 源码 import 一律写**相对路径 + `.js` 后缀**（`./types.js`、`../path.js`）；
   - 只用**具名导出**，不要 `export default`、不要 `export * from`、不要 namespace import；
   - 一个模块里 `import` 语句单独占一行。
2. **对自己的 DOM 一律加 `worldmap-` 前缀**（`ID_PREFIX`），热重载与 `pagehide` 靠它清理。
3. **不要碰角色卡里「卡内手机脚本」的 `phone_data`**；底图写自己的 `worldmap_v1`。
4. 所有外部调用（世界书、模型接口、文件）都要 try/catch 并给用户可读的 toast，
   **失败时绝不半写底图**。
5. 人工改动过的节点一定要 `locked=true, source='manual'`，AI 生成与作者预设都不许覆盖它。
6. 改完代码跑一遍：`npm run typecheck` → `npm run selftest` → `npm run release` →
   `npm run bundletest`（脚本名与 `package.json` 对齐；`release.mjs` / `bundletest.mjs` 也能
   直接用 `node tools/xxx.mjs` 跑）。其中 **`selftest` 用到了只留本地的文件**，
   在克隆出来的仓库里跑不了 —— 见 §四 末尾的说明。
7. 禁止批量删除文件或目录。
  不要使用：
  - `del /s`
  - `rd /s`
  - `rmdir /s`
  - `Remove-Item -Recurse`
  - `rm -rf`

  需要删除文件时，只能一次删除一个明确路径的文件。删除时应走回收站。

  正确示例：
  Remove-Item "C:\path\to\file.txt"

  如果需要批量删除文件，应停止操作，并询问用户，让用户手动删除。

## 四、目录速查

```
src/worldmap/
  index.ts        入口/控制器：初始化、事件、动作、撤销栈、__worldMap 调试接口
  types.ts        全部类型与常量（坐标范围、存储键名、ID 前缀、默认设置）
  path.ts         地点串解析：归一化、切描述、切段、描述止损判定
  graph.ts        节点树：别名表、前缀最长匹配、自动落点、坐标写入
  trail.ts        轨迹：从 <JSONPatch> 全量重建、分类 move/stay/travel、折线合并
  store.ts        四层存储（chat/character/script/localStorage）读写与降级
  preset.ts       底图来源与合并（内置骨架 / 作者预设 / 本地优先）
  layout-ai.ts    世界书抽取 → 模型 → 宽容 JSON 解析 → 合并（尊重 locked）
  seed.ts         内置世界骨架（坐标来自世界书里写死的方位与距离，1 单位=15 亿里）
  ui/theme.ts     纸上古地图样式（纯 CSS + 内联 SVG，零外链）
  ui/canvas.ts    SVG 画布：相机、分层可见性、轨迹绘制、标签避让、拖拽编辑
  ui/window.ts    悬浮窗外壳 + 抽屉五个页签 + 时间轴
tools/
  dev-server.mjs  进程内转译 + 静态服务 + 构建哈希（供热重载）
  transpile.mjs   每文件转译（dev / release / selftest / sanitize-test / bundletest 共用）
  typecheck.mjs   全量类型检查
  selftest.mjs    用真实存档跑纯逻辑自测（地点解析 → 节点树 → 轨迹重建）
  inspect-chat.mjs 只读检查某个存档里插件的实际落地情况（轨迹点、AI 写的 /地图）
  sanitize-test.mjs 底图清洗自测（方位词剔除 / 仙界剔除 / 重复合并）
  release.mjs     单文件打包 + 脚本 JSON + 外链 loader + 作者底图
  bundletest.mjs  单文件产物冒烟测试
  harness.html    本地试验台（合成数据，不需要酒馆）**——只留本地，不入库**
  harness-fixture.js 试验台用的合成存档数据（世界书条目 + 带 <JSONPatch> 的假楼层）**——只留本地**
  win.ps1         试验台窗口小工具：列窗口 / 截图 / 关窗（**文件必须保持纯 ASCII**，
                  Windows PowerShell 会把无 BOM 的 .ps1 当 ANSI 读，中文会变乱码报语法错）**——只留本地**
docs/
  安装与使用.md / 数据格式.md / 提示词-地图坐标.md
  worldmap-script.json  可直接导入酒馆助手的成品脚本（release.mjs 生成）
presets/worldmap-base-map.json  作者底图预设（可托管在 GitHub 供玩家拉取）
releases/           外链运行时一行式 + 版本清单
@types/             酒馆助手 iframe API 的类型声明（vendored，function/ 与 iframe/ 两个子目录）
README.md           面向 GitHub 访客的说明（改功能后记得同步）
```

### 只留本地、不入库的文件（见 `.gitignore` 末尾）

下面这些依赖本机环境（真实存档路径、试验台合成数据）或属于内部参考，
**与「插件能不能跑」无关，所以不随仓库发布**；文件仍在本地，开发时照常使用：

| 文件 | 为什么不留库 |
|---|---|
| `tools/selftest.mjs` | 用的是**本机真实存档**的绝对路径，还内嵌了作品地名 |
| `tools/inspect-chat.mjs` | 直接读本机 TauriTavern 数据目录，含个人路径 |
| `tools/harness.html` / `harness-fixture.js` | 试验台，内含作品世界书条目与地名 |
| `tools/win.ps1` | 只服务试验台窗口的 Windows 小工具（`-PW` 用 PrintWindow 抓被遮挡窗口） |
| `tools/shot.sh` | 试验台截图助手：经 DevTools 端口开标签页 → 抓窗 → 关标签（需 Chrome 带 `--remote-debugging-port=9222`） |
| `docs/计划书-世界舆图插件.md` | 内部立项文档，含世界书 uid 与大量作品专名 |

⚠️ 因此 **`npm run selftest` 在克隆下来的仓库里跑不了**（缺文件），自己在本地开发时才可用。
新增文件时先想一下：它是「插件运行/构建必需」还是「本机调试用」——后者一律加进 `.gitignore`。

### 试验台的 URL 参数（`tools/harness.html`）

| 参数 | 作用 |
|---|---|
| `fresh=1` | 先清掉 `worldmap_map*` / `harness_*` 的 localStorage，保证干净起点 |
| `tab=settings\|layers\|places\|edit\|trail` | 打开时停在哪个页签 |
| `size=980x640` | 把悬浮窗设成指定尺寸（截图审查用；不传用上次布局） |
| `open=all` | 展开设置页全部折叠小节 |
| `scroll=N` | 抽屉滚动到第 N 像素（一屏放不下时逐段截图用） |
| `zoom=N` | 启动后把相机设到指定倍率 |
| `dock=left\|right` | 把悬浮窗贴边收成"索引标贴"，验证窄条样式 |
| `action=<data-act>` | 自动点一下那个按钮，把结果写进标题（异步动作等 4 秒） |
| `call=<方法名>` | 直接调 `__worldMap.window` 上的方法，**异常会写进标题**（按钮路径出错时用它抓真实异常） |

标题里带 `atab=` / `sct=`，多开窗口时靠它们区分是哪一屏。
`powershell -File tools/win.ps1 -List` 可以直接列出所有试验台窗口的标题。

## 五、调试界面时的省事做法（本机实测有效）

- **`read_image` 可以直接看图**：用 PowerShell 的 `System.Drawing` 截屏，再 `read_image` 打开，
  比 `image_scan` 的像素网格直观得多（`computer_screenshot` 有时不可用）：

  ```powershell
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap(640,520)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x,$y,0,0,(New-Object System.Drawing.Size(640,520)))
  $bmp.Save("D:\AICoding\TMapsTrajectory\.shots\x.png",[System.Drawing.Imaging.ImageFormat]::Png)
  ```

- 悬浮窗的**视口坐标**可以从 `__worldMap.diagnostics().layout` 读到（形如 `root=620x500@1292,96`），
  再用 Chrome 窗口的屏幕矩形换算成截屏区域。
- 试验台把自检写进 `document.title`，用 `Get-Process chrome | Where MainWindowTitle -match 'T2\|'`
  直接读，不需要 OCR。
- **同时开多个试验台窗口会互相干扰**（同一屏幕位置、同一 localStorage）。
  验证前先把旧的都关掉、只留一个，用完立刻关，不要留在用户桌面上。

## 六、推送与发布（GitHub）

- 仓库：`https://github.com/yctf8fq258/TMapsTrajectory.git`，公开，默认分支 `main`。
- **`dist/` 必须入库**，见 `.gitignore` 底部的说明：外链加载版靠 jsdelivr 直接读仓库里的
  `dist/worldmap/index.single.js`，不提交 dist 别人就加载不到。
- **禁止入库**：`node_modules/`、`.npm-cache/`、`.chrome-profile/`、`.chrome-harness/`、
  `.shots/`、`.workbuddy/`（工作区记忆）。这些已在 `.gitignore` 里。
  > 历史教训：本仓库的**第一个提交曾把以上目录全部提交进去**（2520 个跟踪文件 / 约 84MB），
  > 已于 2026-09-11 重写掉，现在的根提交只有 94 个文件 / 约 1.5MB。
  > 再加文件前先 `git status` 看一眼，别用 `git add -A` 无脑加。
- ⚠️ **绝对不要在本沙箱里跑 `git gc` / `git reflog expire`**（2026-09-11 实测踩坑）：
  `git gc --prune=now` 的批量删除动作会撞上沙箱的 safe-delete 拦截（`SAFE_DELETE_FAIL_CLOSED`
  / `Some operations were aborted`），**把整个 `.git` 目录清空**（只剩空的 `info/` 和 `objects/`），
  仓库瞬间变成「not a git repository」。工作区文件不会受损，恢复办法就是 `git init -b main` +
  `git add` + 重新提交。清理历史请改用 `git commit --amend`（对象少时不需要 gc）。
- 沙箱内**不能** `git push`（见 §一.2）。代推用 `.workbuddy/push-github.mjs`：
  走 GitHub REST API（blobs → tree → 无父 commit → 强制更新 ref），
  **它刻意不派生子进程**（`git ls-tree` 之类会 EPERM），直接遍历工作区文件。
  ```powershell
  $env:DAOYUAN_GH_TOKEN = '<细粒度 PAT，Contents: Read and write>'
  node .workbuddy/push-github.mjs --dry     # 先看清单
  node .workbuddy/push-github.mjs           # 真推
  ```
- ⚠️ **改远端历史要用 Git Data API 重建，不要在本机跑 `git rebase` / `git gc`**：
  - **压缩成一条**：`GET /git/ref/heads/<分支>` → `GET /git/commits/<sha>` 拿 `tree` →
    `POST /git/commits`（带上原 tree、`parents: []`、新 message）→
    `PATCH /git/refs/heads/<分支>`（`force: true`）。
  - **只改提交信息、保留序列**：按从老到新逐条 `POST /git/commits`（tree 不变、message 改写、
    parent 指向上一条新建的），最后同样 force 移动指针。
  - 本地要同步的话用 `git checkout --orphan 新分支` + `git add -A` + `git commit` →
    `git branch -D main` → `git branch -m 新分支 main`。**本地/远端的 SHA 会不一样**（作者与
    时间戳不同），但 tree 内容一致，不必强行对齐。
  - 注意：旧的提交对象 GitHub 不会立刻回收，**指定 SHA 仍能访问一段时间**，
    所以「删掉某个文件」不等于「删掉它曾经的内容」—— 涉及密钥时唯一可靠的办法是**吊销密钥**。
- 发布流程：
  1. `npm run typecheck` → `npm run selftest` → `npm run release` → `npm run bundletest`
  2. 更新 `releases/manifest.json` 的 `version` / `ref`，`ref` 建议指向发布用的 tag
     而不是长期 `main`（`YOUR_GITHUB_USER` 已换成 `yctf8fq258`，`tools/release.mjs` 的默认值也改了）
  3. 提交并推送；玩家侧脚本内容只需一行 `import('<runtime>')`
- 改功能后记得同步 `README.md`（README 是给 GitHub 访客看的，AGENTS.md 是给 AI 看的）。

