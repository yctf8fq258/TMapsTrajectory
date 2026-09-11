/**
 * 开发服务器：进程内 TypeScript 每文件转译 + 静态服务 + 构建哈希热重载。
 *
 * 为什么不用 esbuild/webpack/tsc CLI：
 *   本机沙箱禁止 node 以管道 stdio spawn 子进程（spawn EPERM），
 *   因此所有 CLI 形式的构建器都不可用；这里改用 TypeScript 编译器 API
 *   （ts.transpileModule 做每文件转译，约 50ms；ts.createProgram 只用于按需全量类型检查）
 *   在同一个进程里完成，不需要 spawn。
 *
 * 配套：酒馆助手脚本内容用一段自轮询 bootstrap（见 docs/安装与使用.md），
 *   它周期性 GET /__build.json，哈希变化时重新 import 带时间戳的入口模块，
 *   不需要 socket.io，也不依赖「酒馆助手 ‣ 开发 ‣ 实时监听」。
 *
 * 用法：node tools/dev-server.mjs [--port 5500]
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'dist');
const PORT = Number(argValue('--port') ?? 5500);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** @type {{ hash: string; at: number; errors: { file: string; message: string }[]; ok: boolean }} */
let buildState = { hash: 'init', at: 0, errors: [], ok: false };

// ── 全量类型检查用的 program 配置 ────────────────────────────────────────
const tsconfigPath = path.join(ROOT, 'tsconfig.json');
const configFile = ts.readConfigFile(tsconfigPath, p => fs.readFileSync(p, 'utf8'));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT, { noEmit: true }, tsconfigPath);

// ── 每文件转译（快路径）─────────────────────────────────────────────────
const TRANSPILE_OPTIONS = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  isolatedModules: true,
  sourceMap: true,
  inlineSources: true,
  removeComments: false,
};

function emitAll() {
  let written = 0;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        const result = ts.transpileModule(source, {
          compilerOptions: TRANSPILE_OPTIONS,
          fileName: full,
          reportDiagnostics: true,
        });
        const relative = path.relative(SRC_DIR, full).replace(/\.ts$/, '.js');
        const outFile = path.join(OUT_DIR, relative);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, result.outputText, 'utf8');
        fs.writeFileSync(
          outFile + '.map',
          JSON.stringify({
            version: 3,
            file: path.basename(outFile),
            sources: [relative],
            sourcesContent: [source],
            names: [],
            mappings: '',
          }),
          'utf8',
        );
        written++;
      }
    }
  };
  walk(SRC_DIR);
  return written;
}

let compiling = false;
let recompileQueued = false;
let checkTimer = null;

function compile(reason) {
  if (compiling) {
    recompileQueued = true;
    return;
  }
  compiling = true;
  const started = Date.now();
  try {
    const written = emitAll();
    buildState = {
      ...buildState,
      hash: crypto.createHash('sha1').update(String(Date.now()) + written).digest('hex').slice(0, 12),
      at: Date.now(),
    };
    console.log(`\x1b[36m[build]\x1b[0m ${reason} → 转译 ${written} 个文件 (${Date.now() - started}ms) hash=${buildState.hash}`);
  } catch (error) {
    buildState = {
      hash: crypto.createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 12),
      at: Date.now(),
      errors: [{ file: '', message: String(error && error.stack ? error.stack : error) }],
      ok: false,
    };
    console.log('\x1b[31m[build] 转译异常\x1b[0m', error);
  } finally {
    compiling = false;
    if (recompileQueued) {
      recompileQueued = false;
      setTimeout(() => compile('排队重编译'), 40);
    }
  }
}

/** 全量类型检查（同步、约 13 秒、会阻塞事件循环）—— 只在显式请求时执行 */
function runFullTypeCheck(reason) {
  const started = Date.now();
  try {
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
    const errors = diagnostics.map(d => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        return { file: `${path.relative(ROOT, d.file.fileName)}:${line + 1}:${character + 1}`, message };
      }
      return { file: '', message };
    });
    buildState = { ...buildState, errors, ok: errors.length === 0 };
    if (errors.length) {
      console.log(`\x1b[33m[check]\x1b[0m ${reason} → ${errors.length} 个类型错误 (${Date.now() - started}ms)`);
      for (const e of errors.slice(0, 20)) console.log(`  \x1b[31m✗\x1b[0m ${e.file} ${e.message}`);
      if (errors.length > 20) console.log(`  … 另有 ${errors.length - 20} 条`);
    } else {
      console.log(`\x1b[32m[check]\x1b[0m ${reason} → 类型检查通过 (${Date.now() - started}ms)`);
    }
    return buildState;
  } catch (error) {
    console.log('\x1b[31m[check] 类型检查异常\x1b[0m', error);
    return buildState;
  }
}

// ── 静态服务 ─────────────────────────────────────────────────────────────
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 酒馆助手脚本内容（自轮询热重载 bootstrap），单行，可直接粘贴 */
const BOOTSTRAP = `(()=>{const B='__BASE__',J='__BUILD__';let h=null,n=0;const clear=()=>{try{eventClearAll()}catch(e){};try{document.querySelectorAll('[id^=worldmap-]').forEach(e=>e.remove())}catch(e){};try{window.parent&&window.parent.document.querySelectorAll('[id^=worldmap-]').forEach(e=>e.remove())}catch(e){}};const load=()=>import(B+'?v='+(++n));const boot=async()=>{try{const r=await fetch(J,{cache:'no-store'}),j=await r.json();if(h===null){h=j.hash;if(j.errors&&j.errors.length&&window.toastr)toastr.error(j.errors[0].file+' '+j.errors[0].message,'[世界舆图] 编译错误');}else if(j.hash!==h){h=j.hash;clear();load();if(window.toastr)toastr.info('已热重载','[世界舆图]');}}catch(e){}setTimeout(boot,1200)};load();boot()})();`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Cache-Control': 'no-store, must-revalidate',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }

  if (url.pathname === '/__check') {
    const result = runFullTypeCheck('手动触发');
    res.writeHead(200, { ...cors, 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/__build.json') {
    res.writeHead(200, { ...cors, 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(buildState));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/__index') {
    res.writeHead(200, { ...cors, 'Content-Type': MIME['.html'] });
    res.end(renderIndex());
    return;
  }

  const target = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403, cors).end('forbidden');
    return;
  }
  try {
    let file = target;
    let stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fsp.stat(file);
    }
    const body = await fsp.readFile(file);
    res.writeHead(200, {
      ...cors,
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, cors).end('not found: ' + url.pathname);
  }
});

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

function renderIndex() {
  const errors = buildState.errors.length
    ? `<pre style="color:#ff7a6a">${escapeHtml(buildState.errors.map(e => `${e.file} ${e.message}`).join('\n'))}</pre>`
    : '<p style="color:#8ad07a">类型检查通过</p>';
  const snippet = BOOTSTRAP.replace('__BASE__', `http://localhost:${PORT}/dist/worldmap/index.js`).replace(
    '__BUILD__',
    `http://localhost:${PORT}/__build.json`,
  );
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>worldmap · 开发服务器</title>
<style>body{background:#141210;color:#e8e0d0;font:14px/1.7 ui-monospace,Consolas,monospace;padding:24px}
pre{background:#241f1a;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap;word-break:break-all}
code{background:#241f1a;padding:2px 6px;border-radius:4px}a{color:#e0b46a}h2{margin-top:28px;font-size:15px}</style></head><body>
<h1>worldmap · 开发服务器</h1>
<p>构建：<code>${buildState.ok ? 'OK' : 'FAILED'}</code> hash=<code>${buildState.hash}</code> 时间=<code>${new Date(buildState.at).toLocaleTimeString()}</code></p>
${errors}
<h2>把下面这一整行粘进「酒馆助手 → 脚本 → 脚本内容」</h2>
<pre>${escapeHtml(snippet)}</pre>
<h2>产物</h2>
<p><a href="/dist/worldmap/index.js">/dist/worldmap/index.js</a></p>
</body></html>`;
}

// ── 启动：先监听端口，再转译（转译约 0.4 秒；全量类型检查只在显式 /__check 或 npm run typecheck 时跑）
server.listen(PORT, () => {
  console.log(`\x1b[36m[serve]\x1b[0m http://localhost:${PORT}/  (根目录 ${ROOT})`);
  console.log(`\x1b[36m[serve]\x1b[0m 浏览器打开上面地址可复制粘贴用的脚本内容`);
  console.log(`\x1b[36m[serve]\x1b[0m 触发全量类型检查： GET http://localhost:${PORT}/__check`);
  compile('首次转译');
});

let watchTimer = null;
let lastSignature = sourceSignature();
try {
  fs.watch(SRC_DIR, { recursive: true }, () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      // Windows 的 recursive watch 有时会给出与源码无关的事件（例如 dist 写入、
      // 编辑器索引），这里用"源码 mtime 签名"二次确认，避免无意义的重复编译。
      const signature = sourceSignature();
      if (signature === lastSignature) return;
      lastSignature = signature;
      compile('源码变更');
    }, 150);
  });
  console.log(`\x1b[36m[watch]\x1b[0m 监听 ${path.relative(ROOT, SRC_DIR)}`);
} catch (error) {
  console.log('\x1b[33m[watch] fs.watch 不可用，改为 2 秒轮询\x1b[0m', String(error));
  setInterval(() => {
    const next = sourceSignature();
    if (next !== lastSignature) {
      lastSignature = next;
      compile('源码变更(轮询)');
    }
  }, 2000);
}

function sourceSignature() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|css|html)$/.test(entry.name)) files.push(full + ':' + fs.statSync(full).mtimeMs);
    }
  };
  walk(SRC_DIR);
  return crypto.createHash('sha1').update(files.sort().join('|')).digest('hex');
}
