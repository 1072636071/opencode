setTimeout(async () => {
  const m = await import("electron");
  console.log("keys:", Object.keys(m));
  console.log("default keys:", m.default ? Object.keys(m.default).slice(0, 10) : "null");
  console.log("m.app:", typeof m.app);
  console.log("m.default.app:", typeof m.default?.app);
  process.exit(0);
}, 100);
