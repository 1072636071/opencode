import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const e = req("electron");
console.log("type:", typeof e);
console.log("typeof e === 'string':", typeof e === 'string');
if (typeof e === 'object') {
  console.log("app:", typeof e.app);
  console.log("app.isPackaged:", e.app?.isPackaged);
}
process.exit(0);
