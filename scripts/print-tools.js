const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

const toolsPath = path.resolve(__dirname, "../frontend/src/lib/realtimeTools.ts");

function loadRealtimeTools() {
  const source = fs.readFileSync(toolsPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require,
    __dirname: path.dirname(toolsPath),
    __filename: toolsPath,
    process,
    console,
  };

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: "realtimeTools.js" });
  const exported = sandbox.module.exports.realtimeTools || sandbox.exports.realtimeTools;

  if (!Array.isArray(exported)) {
    throw new Error("realtimeTools export was not found or is not an array");
  }

  return exported;
}

function main() {
  const tools = loadRealtimeTools();
  const simplified = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

  const lines = simplified.map((tool) => JSON.stringify(tool, null, 2));
  process.stdout.write(`${lines.join("\n\n")}\n`);
}

main();
