console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);
import __cjs_mod__ from "node:module";
const e = __cjs_mod__.createRequire(import.meta.url)("electron");
console.log("type:", typeof e, "app:", typeof e?.app);
process.exit(0);
