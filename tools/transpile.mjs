/**
 * 每文件 TypeScript 转译（ts.transpileModule）。
 * 被 dev-server.mjs / selftest.mjs / build.mjs 共用；不做跨文件类型检查（那是 typecheck.mjs 的事）。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const TRANSPILE_OPTIONS = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  isolatedModules: true,
  sourceMap: true,
  inlineSources: true,
  removeComments: false,
};

export function transpileDir(srcDir, outDir) {
  const written = [];
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
        const relative = path.relative(srcDir, full).replace(/\.ts$/, '.js');
        const outFile = path.join(outDir, relative);
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
        written.push(outFile);
      }
    }
  };
  walk(srcDir);
  return written;
}
