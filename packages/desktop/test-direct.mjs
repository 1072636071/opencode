import * as m from "electron";
console.log("module keys:", Object.keys(m).slice(0, 5));
console.log("m.default:", typeof m.default, m.default?.substring?.(0, 50));
console.log("m.app:", typeof m.app);
process.exit(0);
