import __cjs_mod__ from "node:module";
const req = __cjs_mod__.createRequire(import.meta.url);
const e = req("electron");
console.log("type:", typeof e);
if (typeof e === "string") {
  console.log("STRING VALUE:", e);
} else {
  console.log("app:", typeof e?.app);
  console.log("isPackaged:", e?.app?.isPackaged);
}
process.exit(0);
