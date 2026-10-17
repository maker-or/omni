import ts from "typescript";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const output = resolve(process.argv[2] ?? "docs/architecture");
mkdirSync(output, { recursive: true });
const files = execFileSync(
  "rg",
  [
    "--files",
    "--hidden",
    "-g",
    "!.git",
    "-g",
    "!node_modules",
    "-g",
    "!docs/performance",
    "-g",
    "!docs/architecture",
    "-g",
    "!.tmp-check",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .sort();
const scriptExtensions = /\.(?:[cm]?[jt]sx?)$/;
function localImport(file, specifier) {
  const bases = specifier.startsWith("@/")
    ? [resolve(root, "src", specifier.slice(2)), resolve(root, "@", specifier.slice(2))]
    : specifier.startsWith(".")
      ? [resolve(dirname(resolve(file)), specifier)]
      : [];
  for (const base of bases) {
    for (const candidate of [
      base,
      ...[".ts", ".tsx", ".mjs", ".js", ".mts"].map((suffix) => base + suffix),
      ...["index.ts", "index.tsx", "index.mjs", "index.js"].map((suffix) => resolve(base, suffix)),
    ]) {
      if (existsSync(candidate) && scriptExtensions.test(candidate))
        return relative(root, candidate);
    }
  }
  return null;
}
function role(file) {
  if (/\.test\.|\.bench\./.test(file)) return "test/measurement";
  if (/\.d\.[cm]?ts$/.test(file) || file.startsWith("contracts/")) return "shared contract";
  if (file.startsWith("electron/")) return "Electron main";
  if (file.startsWith("src/store/")) return "renderer state";
  if (file.startsWith("src/lib/")) return "renderer/shared logic";
  if (file.startsWith("native/")) return "native/mobile";
  if (file.startsWith("marketing/")) return "marketing/server";
  if (file.startsWith("scripts/")) return "build/measurement";
  if (!file.startsWith("src/") && !file.startsWith("@/")) return "repository config/documentation";
  return "renderer UI";
}
const modules = [];
const otherFiles = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (!scriptExtensions.test(file)) {
    otherFiles.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      role: role(file),
    });
    continue;
  }
  const text = bytes.toString("utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("tsx")
      ? ts.ScriptKind.TSX
      : file.endsWith("js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const entry = {
    file,
    role: role(file),
    lines: source.getLineAndCharacterOfPosition(text.length).line + 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    imports: [],
    exports: [],
    channels: [],
    operations: [],
  };
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = Boolean(
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly)),
      );
      entry.imports.push({
        specifier: node.moduleSpecifier.text,
        resolved: localImport(file, node.moduleSpecifier.text),
        typeOnly,
        dynamic: false,
        line: lineOf(node),
      });
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      entry.imports.push({
        specifier: node.moduleSpecifier.text,
        resolved: localImport(file, node.moduleSpecifier.text),
        typeOnly: node.isTypeOnly,
        dynamic: false,
        line: lineOf(node),
      });
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    )
      entry.exports.push({ name: node.name?.text ?? "default", line: lineOf(node) });
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      const argument = node.arguments[0];
      const literal =
        argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : null;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && literal)
        entry.imports.push({
          specifier: literal,
          resolved: localImport(file, literal),
          typeOnly: false,
          dynamic: true,
          line: lineOf(node),
        });
      if (
        literal &&
        /\.(?:handle|invoke|send|on)\b$/.test(callee) &&
        /^[a-z][a-z-]*:[a-z]/i.test(literal)
      )
        entry.channels.push({ operation: callee, channel: literal, line: lineOf(node) });
      if (
        /\b(?:execFileSync|execSync|spawnSync|readFileSync|writeFileSync|readdirSync|realpathSync|statSync|lstatSync|renameSync|unlinkSync|mkdirSync|appendFileSync|setInterval|fetch)\b$/.test(
          callee,
        ) ||
        /\.(?:prepare|exec|postMessage|request|notify)\b$/.test(callee)
      )
        entry.operations.push({
          operation: callee,
          line: lineOf(node),
          detail: literal?.replace(/\s+/g, " ").slice(0, 160) ?? null,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  modules.push(entry);
}
const byFile = new Map(modules.map((entry) => [entry.file, entry]));
for (const entry of modules)
  entry.importedBy = modules
    .filter((other) => other.imports.some((item) => item.resolved === entry.file))
    .map((other) => other.file);
function closure(file, includeDynamic) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path) || !byFile.has(path)) return;
    seen.add(path);
    for (const edge of byFile.get(path).imports)
      if (edge.resolved && !edge.typeOnly && (includeDynamic || !edge.dynamic))
        visit(edge.resolved);
  };
  visit(file);
  return [...seen].sort();
}
const roots = [
  "electron/main.ts",
  "electron/agent-connection-manager.ts",
  "src/main.tsx",
  "src/App.tsx",
  "src/components/agent-panel.tsx",
  "src/remote/main.tsx",
  "src/settings/app.tsx",
];
const importClosures = roots.map((file) => ({
  file,
  staticImports: closure(file, false),
  allImports: closure(file, true),
}));
const report = {
  capturedAt: new Date().toISOString(),
  scope:
    "All discoverable repository files, excluding ignored dependencies/builds, .git, generated reports and .tmp-check. Import graph is syntactic, not a runtime call graph; type-only and dynamic edges are identified. Reachability does not imply that a module executes on a workflow.",
  modules,
  otherFiles,
  importClosures,
};
writeFileSync(resolve(output, "module-map.json"), JSON.stringify(report, null, 2));
const markdown = [
  "# Module responsibilities and direct touches",
  "",
  report.scope,
  "",
  "Every TypeScript/JavaScript module is listed below. Symbols, direct imports, IPC channels and IO operations are extracted from the actual AST. `module-map.json` contains line numbers and hashes. Non-JS files are listed separately at the end; their behavior is not inferred from the TypeScript graph.",
  "",
  "| File | Role | Lines | Direct local dependencies | IPC / IO touches |",
  "| --- | --- | ---: | --- | --- |",
];
for (const entry of modules) {
  const deps = [
    ...new Set(
      entry.imports.filter((item) => item.resolved && !item.typeOnly).map((item) => item.resolved),
    ),
  ];
  const touches = [
    ...new Set([
      ...entry.channels.map((item) => item.channel),
      ...entry.operations.map((item) => item.operation),
    ]),
  ];
  markdown.push(
    `| [${entry.file}](../../${entry.file}) | ${entry.role} | ${entry.lines} | ${deps.map((name) => `\`${name}\``).join("<br>") || "—"} | ${touches.map((name) => `\`${name}\``).join("<br>") || "—"} |`,
  );
}
markdown.push("", "## Other files", "", "| File | Role | Bytes |", "| --- | --- | ---: |");
for (const file of otherFiles)
  markdown.push(`| [${file.file}](../../${file.file}) | ${file.role} | ${file.bytes} |`);
writeFileSync(resolve(output, "FILE-MAP.md"), markdown.join("\n") + "\n");
console.log(
  JSON.stringify(
    {
      modules: modules.length,
      otherFiles: otherFiles.length,
      importClosures: importClosures.map((item) => ({
        file: item.file,
        static: item.staticImports.length,
        all: item.allImports.length,
      })),
    },
    null,
    2,
  ),
);
