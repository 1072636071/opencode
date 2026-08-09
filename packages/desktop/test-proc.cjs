console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);
const e = require("electron");
console.log("type:", typeof e);
console.log("app:", typeof e?.app);
process.exit(0);
