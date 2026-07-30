import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(toolsDirectory, "..");
const sourceDirectory = path.join(rootDirectory, "src");
const demoDirectory = path.join(rootDirectory, "demo");
const entryModule = path.join(sourceDirectory, "main.js");

function resolveImportedModule(importerPath, specifier) {
  if (!specifier.startsWith(".")) {
    throw new Error(`Only relative imports can be bundled: ${specifier} in ${importerPath}`);
  }

  const resolvedPath = path.resolve(path.dirname(importerPath), specifier);
  if (!resolvedPath.startsWith(`${sourceDirectory}${path.sep}`)) {
    throw new Error(`Import escapes src/: ${specifier} in ${importerPath}`);
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Imported module does not exist: ${specifier} in ${importerPath}`);
  }

  return resolvedPath;
}

function findImports(source) {
  const imports = [];
  const importPattern = /^import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?\s*$/gm;
  let match;

  while ((match = importPattern.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, "")
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, "");
}

function orderModules(entryPath) {
  const states = new Map();
  const orderedPaths = [];
  const stack = [];

  function visit(modulePath) {
    const state = states.get(modulePath);
    if (state === "visiting") {
      const cycleStart = stack.indexOf(modulePath);
      const cycle = [...stack.slice(cycleStart), modulePath]
        .map((item) => path.relative(rootDirectory, item))
        .join(" -> ");
      throw new Error(`Circular import detected: ${cycle}`);
    }
    if (state === "visited") {
      return;
    }

    states.set(modulePath, "visiting");
    stack.push(modulePath);
    const source = fs.readFileSync(modulePath, "utf8");
    findImports(source).forEach((specifier) => visit(resolveImportedModule(modulePath, specifier)));
    stack.pop();
    states.set(modulePath, "visited");
    orderedPaths.push(modulePath);
  }

  visit(entryPath);
  return orderedPaths;
}

function buildBundle() {
  const modules = orderModules(entryModule);
  const body = modules.map((modulePath) => {
    const relativePath = path.relative(rootDirectory, modulePath).replaceAll(path.sep, "/");
    return `// ${relativePath}\n${stripModuleSyntax(fs.readFileSync(modulePath, "utf8")).trim()}`;
  });

  return `"use strict";\n\n${body.join("\n\n")}\n`;
}

function buildDemoHtml() {
  const sourceHtml = fs.readFileSync(path.join(rootDirectory, "index.html"), "utf8");
  const moduleTag = '<script type="module" src="src/main.js"></script>';
  if (!sourceHtml.includes(moduleTag)) {
    throw new Error("Root index.html no longer contains the expected module entry point.");
  }

  return sourceHtml.replace(moduleTag, '<script src="salesscope.js"></script>');
}

fs.mkdirSync(demoDirectory, { recursive: true });
fs.writeFileSync(path.join(demoDirectory, "index.html"), buildDemoHtml(), "utf8");
fs.writeFileSync(path.join(demoDirectory, "salesscope.js"), buildBundle(), "utf8");
fs.copyFileSync(path.join(rootDirectory, "style.css"), path.join(demoDirectory, "style.css"));
fs.copyFileSync(path.join(rootDirectory, "superstore-data.js"), path.join(demoDirectory, "superstore-data.js"));

console.log("Built demo/ from the src/main.js import graph.");
