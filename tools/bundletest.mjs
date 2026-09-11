/**
 * 单文件产物的冒烟测试：在 Node 里桩掉酒馆/浏览器全局，导入 dist/worldmap/index.single.js，
 * 确认打包结果语法正确、模块依赖顺序正确、初始化不抛异常。
 * 用法：node tools/bundletest.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(ROOT, 'dist', 'worldmap', 'index.single.js');

const warnings = [];
const readyHandlers = [];

// ── 最小 DOM 桩 ─────────────────────────────────────────────────────────
function makeElement(tag = 'div') {
  const element = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    attributes: {},
    textContent: '',
    innerHTML: '',
    id: '',
    className: '',
    title: '',
    type: '',
    value: '',
    max: '',
    min: '',
    files: null,
    offsetLeft: 0,
    offsetTop: 96,
    offsetWidth: 560,
    offsetHeight: 460,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    removeAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...children) {
      this.children.push(...children);
    },
    remove() {},
    replaceChildren(...children) {
      this.children = children;
    },
    /** 桩实现：innerHTML 赋值时清空缓存的子元素；querySelector 一律返回一个新元素 */
    querySelector: () => makeElement('input'),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 320, bottom: 400, width: 320, height: 400 }),
    insertAdjacentHTML() {},
    click() {},
    focus() {},
  };
  return element;
}

const documentStub = {
  head: makeElement('head'),
  body: makeElement('body'),
  documentElement: makeElement('html'),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: makeElement,
  createElementNS: (_ns, tag) => makeElement(tag),
  addEventListener() {},
};

globalThis.window = globalThis;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = documentStub;
globalThis.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  },
  setItem(key, value) {
    this.store.set(key, String(value));
  },
  removeItem(key) {
    this.store.delete(key);
  },
  clear() {
    this.store.clear();
  },
};
globalThis.$ = arg => {
  if (typeof arg === 'function') readyHandlers.push(arg);
  return { on() {}, append() {}, remove() {}, find: () => ({ on() {} }) };
};
globalThis.toastr = { success() {}, info() {}, warning() {}, error() {} };
globalThis.getVariables = () => ({});
globalThis.insertOrAssignVariables = () => ({});
globalThis.replaceVariables = () => {};
globalThis.getChatMessages = () => [];
globalThis.getLastMessageId = () => -1;
globalThis.getScriptId = () => 'bundle-test';
globalThis.getButtonEvent = name => 'button:' + name;
globalThis.replaceScriptButtons = () => {};
globalThis.eventOn = () => ({ stop() {} });
globalThis.eventClearAll = () => {};
globalThis.waitGlobalInitialized = async () => {
  throw new Error('no Mvu');
};
globalThis.getCharWorldbookNames = () => ({ primary: '', additional: [] });
globalThis.getGlobalWorldbookNames = () => [];
globalThis.getWorldbook = async () => [];
globalThis.tavern_events = new Proxy({}, { get: (_t, key) => String(key) });
globalThis.SillyTavern = { getCurrentChatId: () => 'test' };
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));

try {
  await import(pathToFileURL(bundle).href);
  for (const handler of readyHandlers) handler();
  await new Promise(resolve => setTimeout(resolve, 300));
  const api = globalThis.__worldMap;
  if (!api) throw new Error('插件没有挂上 window.__worldMap');
  const state = api.state();
  console.log('单文件产物冒烟测试通过');
  console.log(`  模块导出：${Object.keys(api).length} 项`);
  console.log(`  节点 ${state.nodes} 个（内置骨架已装载）`);
  console.log(`  轨迹 ${state.points} 个（测试环境无聊天记录）`);
  if (warnings.length) console.log(`  警告 ${warnings.length} 条（启动阶段 DB 未就绪属预期）`);
} catch (error) {
  console.error('单文件产物冒烟测试失败：', error);
  process.exitCode = 1;
} finally {
  console.warn = originalWarn;
}
