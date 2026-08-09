import electron from 'electron';
console.log('type:', typeof electron);
console.log('keys:', Object.keys(electron).slice(0, 10));
console.log('default.app:', typeof electron.default?.app);
process.exit(0);
