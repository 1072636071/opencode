console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);
const electron = require("electron");
console.log("type:", typeof electron);
console.log("app:", typeof electron?.app);
process.exit(0);
