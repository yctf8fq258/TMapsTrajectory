/**
 * 发布构建：
 *   1) src → dist（每文件转译）
 *   2) dist/worldmap/index.js → 单文件 ESM（自写迷你打包器，无需外部 bundler）
 *   3) 产出可导入酒馆的脚本 JSON、外链 loader、版本清单、作者底图 JSON
 *
 * 用法：node tools/release.mjs [--repo <用户/仓库>] [--ref <ref>] [--cdn <域名>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileDir } from './transpile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const ENTRY_DIR = 'worldmap';
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const arg = flag => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const REPO = arg('--repo') ?? 'yctf8fq258/TMapsTrajectory';
const REF = arg('--ref') ?? 'main';
const CDN = arg('--cdn') ?? 'https://testingcf.jsdelivr.net';

// ── 迷你 ESM 打包器 ─────────────────────────────────────────────────────
const NAMED_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/;
const SIDE_IMPORT = /^import\s*'([^']+)';?\s*$/;
const NAMED_EXPORT = /^export\s*\{([^}]*)\};?\s*$/;
const DECL_EXPORT = /^export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z0-9_$]+)/;

function parseModule(absFile) {
  const code = fs.readFileSync(absFile, 'utf8');
  const dir = path.dirname(absFile);
  /** 依赖列表：占位符 → 绝对路径；占位符在整张图收集完后统一替换成模块 id */
  const deps = [];
  const exports = new Map(); // 导出名 -> 本地名
  const lines = code.split(/\r?\n/);
  const output = [];

  const token = target => {
    deps.push(target);
    return `__DEP_${deps.length - 1}__`;
  };

  for (const line of lines) {
    const named = line.match(NAMED_IMPORT);
    if (named) {
      const binding = named[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
          const [local, exported] = part.split(/\s+as\s+/).map(text => text.trim());
          return exported ? `${exported}: ${local}` : local;
        })
        .join(', ');
      output.push(`const { ${binding} } = __req('${token(path.resolve(dir, named[2]))}');`);
      continue;
    }
    const side = line.match(SIDE_IMPORT);
    if (side) {
      output.push(`__req('${token(path.resolve(dir, side[1]))}');`);
      continue;
    }
    const namedExport = line.match(NAMED_EXPORT);
    if (namedExport) {
      for (const part of namedExport[1].split(',').map(text => text.trim()).filter(Boolean)) {
        const [local, exported] = part.split(/\s+as\s+/).map(text => text.trim());
        exports.set(exported ?? local, local);
      }
      continue;
    }
    const decl = line.match(DECL_EXPORT);
    if (decl) {
      exports.set(decl[2], decl[2]);
      output.push(line.replace(/^export\s+/, ''));
      continue;
    }
    if (/^export\s+(type|interface|declare)\b/.test(line) || /^export\s+default\b/.test(line) || /^export\s*\*\s*from\b/.test(line)) {
      throw new Error(`打包器不支持这种导出语法：${path.basename(absFile)} → ${line.slice(0, 80)}`);
    }
    output.push(line);
  }
  return { code: output.join('\n'), deps, exports };
}

function bundle(entryFile) {
  const modules = new Map();
  const order = [];
  const visit = abs => {
    if (modules.has(abs)) return;
    const parsed = parseModule(abs);
    modules.set(abs, parsed);
    for (const target of parsed.deps) {
      if (!fs.existsSync(target)) throw new Error(`依赖不存在：${target}`);
      visit(target);
    }
    order.push(abs);
  };
  visit(entryFile);

  const rootDir = path.dirname(entryFile);
  const idOf = abs => {
    const rel = path.relative(rootDir, abs).split(path.sep).join('/');
    return rel.startsWith('.') ? rel : './' + rel;
  };

  const parts = [
    '/* worldmap —— 单文件版（由 tools/release.mjs 生成，请勿直接编辑） */',
    '(() => {',
    'const __mods = Object.create(null);',
    'const __def = (name, factory) => { __mods[name] = factory(); };',
    'const __req = name => {',
    '  const mod = __mods[name];',
    "  if (!mod) throw new Error('[世界舆图] 单文件打包缺失模块: ' + name);",
    '  return mod;',
    '};',
  ];
  for (const abs of order) {
    const parsed = modules.get(abs);
    const exportList = [...parsed.exports.entries()]
      .map(([exported, local]) => (exported === local ? local : `${exported}: ${local}`))
      .join(', ');
    const body = parsed.code.replace(/__DEP_(\d+)__/g, (_match, index) => idOf(parsed.deps[Number(index)]));
    parts.push(`__def(${JSON.stringify(idOf(abs))}, () => {`);
    parts.push(body);
    parts.push(`return { ${exportList} };`);
    parts.push('});');
  }
  parts.push('})();');
  return parts.join('\n');
}

// ── 让 transpile 先跑一遍 ───────────────────────────────────────────────
const written = transpileDir(SRC, DIST);
console.log(`[1/5] 转译 ${written.length} 个文件 → dist/`);

const entryPath = path.join(DIST, ENTRY_DIR, 'index.js');
if (!fs.existsSync(entryPath)) throw new Error('找不到编译产物：' + entryPath);

const single = bundle(entryPath);
const singlePath = path.join(DIST, ENTRY_DIR, 'index.single.js');
fs.writeFileSync(singlePath, single, 'utf8');
const sizeKb = (Buffer.byteLength(single, 'utf8') / 1024).toFixed(1);
console.log(`[2/5] 单文件打包 → dist/${ENTRY_DIR}/index.single.js（${sizeKb} KB）`);

// ── 可导入酒馆的脚本 JSON ───────────────────────────────────────────────
const scriptId = crypto.createHash('sha1').update('worldmap-trajectory-v1').digest('hex');
const uuid = [scriptId.slice(0, 8), scriptId.slice(8, 12), '4' + scriptId.slice(13, 16), 'a' + scriptId.slice(17, 20), scriptId.slice(20, 32)].join('-');

const scriptJson = {
  type: 'script',
  enabled: true,
  name: '世界舆图',
  id: uuid,
  content: single,
  info: [
    '# 世界舆图',
    '',
    '角色卡地图轨迹插件：在世界书基础上绘制十字坐标舆图，按存档记录玩家轨迹。',
    '',
    '- 按钮「世界舆图」开合悬浮窗；右上角 ⤢ 全图、⌖ 定位当前地点。',
    '- 底图存角色卡变量（跨存档共享），轨迹存聊天变量（每个存档独立）。',
    '- 「设置」页可配置地图布局 AI，按世界书一次性生成坐标。',
    '',
    `版本：${PACKAGE.version}`,
  ].join('\n'),
  button: { enabled: true, buttons: [{ name: '世界舆图', visible: true }] },
  data: {},
  export_with: { data: true, button: true },
};
const scriptPath = path.join(ROOT, 'docs', 'worldmap-script.json');
fs.writeFileSync(scriptPath, JSON.stringify(scriptJson, null, 2), 'utf8');
console.log(`[3/5] 导入用脚本 → docs/worldmap-script.json`);

// ── 外链 loader 与版本清单 ──────────────────────────────────────────────
const runtimeUrl = `${CDN}/gh/${REPO}@${REF}/dist/${ENTRY_DIR}/index.single.js`;
const manifestUrl = `${CDN}/gh/${REPO}@${REF}/releases/manifest.json`;
const loader = `/* worldmap —— 外链加载版：脚本内容只保留这一行 import 即可自动跟随 GitHub 更新 */
import('${runtimeUrl}');
`;
fs.writeFileSync(path.join(ROOT, 'releases', 'loader.js'), loader, 'utf8');
fs.writeFileSync(
  path.join(ROOT, 'releases', 'manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      name: '世界舆图',
      version: PACKAGE.version,
      ref: REF,
      runtime: runtimeUrl,
      manifest: manifestUrl,
      generatedAt: new Date().toISOString(),
      note: '把本仓库推到 GitHub 后，把 ref 改成发布用的 tag 或 commit，玩家侧脚本内容写 import(\'<runtime>\') 即可。',
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`[4/5] 外链产物 → releases/（引用 ${runtimeUrl}）`);

// ── 作者底图 ────────────────────────────────────────────────────────────
const seedModule = await import(pathToFileURL(path.join(DIST, ENTRY_DIR, 'seed.js')).href);
const graphModule = await import(pathToFileURL(path.join(DIST, ENTRY_DIR, 'graph.js')).href);
const seedGraph = new graphModule.MapGraph(seedModule.SEED_ALL.map(node => ({ ...node })));
const baseMap = {
  ...graphModule.toBaseMap(seedGraph),
  name: '玄天界·内置骨架',
  authorNote: '只有世界书里写死了方位与距离的地点才在这里；其余交给「设置 → 生成：世界骨架」或人工拖动。',
};
fs.writeFileSync(path.join(ROOT, 'presets', 'worldmap-base-map.json'), JSON.stringify(baseMap, null, 2), 'utf8');
console.log(`[5/5] 作者底图 → presets/worldmap-base-map.json（${baseMap.nodes.length} 个节点）`);

console.log('\n完成。');
console.log(`  单文件：${path.relative(ROOT, singlePath)}（${sizeKb} KB）`);
console.log(`  导入用：${path.relative(ROOT, scriptPath)}`);
console.log('  安装：酒馆助手 → 脚本 → 导入 docs/worldmap-script.json → 打开开关 → 点「世界舆图」按钮');
