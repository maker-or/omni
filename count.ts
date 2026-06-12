import { Project, Node } from "ts-morph";
import path from "path";

const TARGET_FOLDER = "src/components";

const IGNORE_FOLDERS = [
  "app-template",
  "@",
  "apps/web/src/components/settings",
  "apps/web/src/components/chat/__screenshots__",
];

const targetPath = path.resolve(process.cwd(), TARGET_FOLDER);

const ignoreFolders = IGNORE_FOLDERS.map((folder) =>
  path.resolve(process.cwd(), folder),
);

function shouldIgnore(filePath: string): boolean {
  const normalized = path.resolve(filePath);

  const inIgnoredFolder = ignoreFolders.some((folder) =>
    normalized.startsWith(folder),
  );

  const fileName = path.basename(normalized);

  const isTestFile =
    normalized.endsWith(".test.tsx") || normalized.includes(".test.");

  const startsWithUnderscore = fileName.startsWith("_");

  return inIgnoredFolder || isTestFile || startsWithUnderscore;
}
const project = new Project();

// Adjust if your source files live elsewhere
project.addSourceFilesAtPaths([
  "apps/web/src/**/*.ts",
  "apps/web/src/**/*.tsx",
]);

const allFiles = project
  .getSourceFiles()
  .filter((file) => !shouldIgnore(file.getFilePath()));

const componentFiles = allFiles.filter((file) => {
  const filePath = file.getFilePath();

  return filePath.startsWith(targetPath) && filePath.endsWith(".tsx");
});

type UsageReport = {
  count: number;
  usedIn: string[];
};

const results: Record<string, UsageReport> = {};

console.log(
  `Analyzing ${componentFiles.length} components across ${allFiles.length} files...\n`,
);

for (const [index, componentFile] of componentFiles.entries()) {
  const componentPath = componentFile.getFilePath();

  const componentKey = path.relative(process.cwd(), componentPath);

  console.log(
    `[${index + 1}/${componentFiles.length}] ${componentFile.getBaseName()}`,
  );

  const usedIn = new Set<string>();

  for (const sourceFile of allFiles) {
    if (sourceFile.getFilePath() === componentPath) {
      continue;
    }

    const importedNames: string[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const resolvedFile = importDecl.getModuleSpecifierSourceFile();

      if (!resolvedFile) continue;

      if (resolvedFile.getFilePath() !== componentPath) {
        continue;
      }

      const defaultImport = importDecl.getDefaultImport();

      if (defaultImport) {
        importedNames.push(defaultImport.getText());
      }

      for (const namedImport of importDecl.getNamedImports()) {
        importedNames.push(
          namedImport.getAliasNode()?.getText() ?? namedImport.getName(),
        );
      }
    }

    if (importedNames.length === 0) {
      continue;
    }

    let foundUsage = false;

    sourceFile.forEachDescendant((node) => {
      if (foundUsage) {
        return false;
      }

      if (
        Node.isJsxOpeningElement(node) ||
        Node.isJsxSelfClosingElement(node)
      ) {
        const tagName = node.getTagNameNode().getText();

        if (importedNames.includes(tagName)) {
          foundUsage = true;
          return false;
        }
      }
    });

    if (foundUsage) {
      usedIn.add(path.relative(process.cwd(), sourceFile.getFilePath()));
    }
  }

  results[componentKey] = {
    count: usedIn.size,
    usedIn: [...usedIn].sort(),
  };
}

const sortedResults = Object.fromEntries(
  Object.entries(results).sort((a, b) => a[1].count - b[1].count),
);

await Bun.write(
  "component-usage-report.json",
  JSON.stringify(sortedResults, null, 2),
);

const unusedComponents = Object.entries(sortedResults)
  .filter(([, value]) => value.count === 0)
  .map(([key]) => key);

console.log("\n================================");
console.log(`Components analyzed: ${componentFiles.length}`);
console.log(`Unused components: ${unusedComponents.length}`);
console.log("================================");

if (unusedComponents.length > 0) {
  console.log("\nUnused Components:\n");

  for (const component of unusedComponents) {
    console.log(component);
  }
}

console.log("\nReport written to component-usage-report.json");
