/**
 * 独立的全量类型检查（给 CLI / npm run typecheck 用）。
 * 与 dev-server 内的 /__check 等价，但跑在独立进程里，不阻塞开发服务器。
 * 用法：node tools/typecheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsconfigPath = path.join(ROOT, 'tsconfig.json');
const configFile = ts.readConfigFile(tsconfigPath, p => fs.readFileSync(p, 'utf8'));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT, { noEmit: true }, tsconfigPath);
const started = Date.now();
const program = ts.createProgram(parsed.fileNames, parsed.options);
const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);

if (!errors.length) {
  console.log(`类型检查通过（${parsed.fileNames.length} 个文件，${Date.now() - started}ms）`);
  process.exit(0);
}

console.log(`发现 ${errors.length} 个类型错误：`);
for (const d of errors) {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n  ');
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`  ${path.relative(ROOT, d.file.fileName)}:${line + 1}:${character + 1} — ${message}`);
  } else {
    console.log(`  ${message}`);
  }
}
process.exit(1);
