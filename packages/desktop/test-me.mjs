import * as m from "electron";
const me = m["module.exports"];
console.log("me type:", typeof me);
console.log("me keys:", me ? Object.keys(me).slice(0, 10) : "null");
console.log("me.app:", typeof me?.app);
console.log("me.app.isPackaged:", me?.app?.isPackaged);
process.exit(0);
