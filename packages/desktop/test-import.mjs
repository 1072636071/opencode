import electron from 'electron';
console.log('type:', typeof electron);
console.log('app:', typeof electron?.app);
console.log('isPackaged:', electron?.app?.isPackaged);
process.exit(0);
