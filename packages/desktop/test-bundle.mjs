// 模拟 main bundle 的 shim
import __cjs_mod__ from "node:module";
const __opencode_electron__ = __cjs_mod__.createRequire(import.meta.url)("electron");
const { app } = __opencode_electron__;
console.log("type:", typeof __opencode_electron__);
console.log("app:", typeof app);
console.log("app.isPackaged:", app?.isPackaged);
process.exit(0);
