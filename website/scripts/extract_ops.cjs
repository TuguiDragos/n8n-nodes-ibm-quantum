// What the built action node and its triggers declare about themselves, read from dist after `npm run build`.
const path = require("path");
const repo = path.resolve(__dirname, "../..");
const node = require(path.join(repo, "dist/nodes/IbmQuantum/IbmQuantum.node.js"));
const Cls = Object.values(node)[0];
const desc = new Cls().description;
const props = desc.properties;
const resource = props.find((p) => p.name === "resource");
const out = { displayName: desc.displayName, version: desc.version, usableAsTool: desc.usableAsTool, resources: [] };
for (const r of resource.options) {
  const op = props.find((p) => p.name === "operation" && p.displayOptions?.show?.resource?.includes(r.value));
  out.resources.push({ name: r.name, value: r.value, operations: op.options.map((o) => ({ name: o.name, value: o.value, description: o.description, action: o.action })) });
}
const gates = props.find((p) => p.name === "gates");
out.gates = gates ? JSON.stringify(gates).match(/"options":\[\{"name":"[^\]]*\]/)?.[0] : null;
for (const f of ["IbmQuantumTrigger", "IbmQuantumErrorTrigger"]) {
  const m = require(path.join(repo, `dist/nodes/IbmQuantum/${f}.node.js`));
  const d = new (Object.values(m)[0])().description;
  out[f] = { displayName: d.displayName, hidden: d.hidden, polling: d.polling, usableAsTool: d.usableAsTool, description: d.description };
}
require("fs").writeFileSync(path.join(__dirname, "../_build/ops.json"), JSON.stringify(out, null, 1));
console.log(out.displayName, "v", out.version, "tool", out.usableAsTool, out.resources.map((r) => `${r.name}:${r.operations.length}`).join(" "), "total", out.resources.reduce((a, r) => a + r.operations.length, 0));
console.log(JSON.stringify(out.IbmQuantumTrigger), JSON.stringify(out.IbmQuantumErrorTrigger));
