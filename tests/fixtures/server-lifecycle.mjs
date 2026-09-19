// Windows cannot deliver a POSIX SIGTERM through kill; exercise the real handler over IPC.
process.on('message', (message) => {
  if (message === 'terminate') process.emit('SIGTERM');
});
await import('../../server/index.js');
process.send?.('started');
