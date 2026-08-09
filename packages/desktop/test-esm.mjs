console.log("process.type:", process.type);
import electron from "electron";
console.log("typeof electron:", typeof electron);
console.log("electron.default:", typeof electron?.default);
console.log("electron keys:", Object.keys(electron).slice(0, 5));
process.exit(0);
