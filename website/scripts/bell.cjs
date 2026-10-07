// The 12-gate Bell state from the README, written by the node's own Circuit > Build code.
const path = require("path");
const { buildQasm3 } = require(path.resolve(__dirname, "../../dist/nodes/IbmQuantum/qasm3.js"));
const H = "1.5707963267948966";
const g = (gate, targets, params = [], extra = {}) => ({ gate, targets, controls: [], params: params.map(Number), ...extra });
const gates = [
  g("rz", [0], [H]), g("sx", [0]), g("rz", [0], [H]),
  g("rz", [1], [H]), g("sx", [1]), g("rz", [1], [H]),
  { gate: "cz", targets: [1], controls: [0], params: [] },
  g("rz", [1], [H]), g("sx", [1]), g("rz", [1], [H]),
  g("measure", [0], [], { clbit: 0 }), g("measure", [1], [], { clbit: 1 }),
];
const qasm = buildQasm3({ numQubits: 2, numClbits: 2, gates });
console.log(qasm);
require("fs").writeFileSync(path.join(__dirname, "../_build/bell.qasm"), qasm);
