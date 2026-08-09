import * as m from "electron";
console.log("m.default type:", typeof m.default);
console.log("m.default keys:", m.default ? Object.keys(m.default).slice(0, 10) : "null");
console.log("m.default.app:", typeof m.default?.app);
console.log("m.default.isPackaged:", m.default?.app?.isPackaged);
console.log("m['module.exports']:", typeof m["module.exports"]);
process.exit(0);
