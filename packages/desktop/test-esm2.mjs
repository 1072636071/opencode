import electron from "electron";
console.log("typeof electron:", typeof electron);
console.log("electron.default:", typeof electron?.default);
console.log("electron.app:", typeof electron?.app);
console.log("proto:", Object.getPrototypeOf(electron)?.constructor?.name);
process.exit(0);
