import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
console.log("resolve electron:", req.resolve("electron"));
console.log("resolve electron.mjs:", req.resolve("electron/electron.mjs"));
process.exit(0);
