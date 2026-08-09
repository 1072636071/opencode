console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);
import electron from "electron";
console.log("typeof electron:", typeof electron);
console.log("app:", typeof electron?.app);
process.exit(0);
