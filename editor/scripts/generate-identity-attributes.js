// Keep inspector attribute positions aligned with the installed web-ifc schemas.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.resolve(__dirname, "../node_modules/web-ifc/ifc-schema.d.ts");
const source = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true);
const schemas = {};
for (const namespace of source.statements) {
  if (!ts.isModuleDeclaration(namespace) || !namespace.body || !ts.isModuleBlock(namespace.body)) continue;
  const entities = {};
  for (const declaration of namespace.body.statements) {
    if (!ts.isClassDeclaration(declaration) || !declaration.name) continue;
    const constructor = declaration.members.find(ts.isConstructorDeclaration);
    if (!constructor) continue;
    let name = -1;
    let description = -1;
    constructor.parameters.forEach((parameter, index) => {
      if (!/Ifc(Label|Text|Identifier)/.test(parameter.type?.getText(source) ?? "")) return;
      const attribute = parameter.name.getText(source);
      if (["Name", "LayerSetName", "ProfileName"].includes(attribute)) name = index;
      if (attribute === "Description") description = index;
    });
    if (name >= 0 || description >= 0) entities[declaration.name.text.toUpperCase()] = [name, description];
  }
  schemas[namespace.name.text] = entities;
}
fs.writeFileSync(path.resolve(__dirname, "../src/ifc/identityAttributes.json"), `${JSON.stringify(schemas, null, 2)}\n`);
console.log(Object.entries(schemas).map(([schema, entities]) => `${schema}: ${Object.keys(entities).length} entities`).join("\n"));
