setTimeout(() => {
  console.log("process.type:", process.type);
  console.log("process.versions.electron:", process.versions.electron);
  import("electron").then(m => {
    console.log("typeof m.default:", typeof m.default);
    console.log("m.default?.app:", typeof m.default?.app);
    process.exit(0);
  });
}, 100);
