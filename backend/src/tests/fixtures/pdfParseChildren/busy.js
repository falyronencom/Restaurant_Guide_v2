// Takes the file and keeps its own event loop busy without end — a parse that
// does not yield. Only the parent's deadline can stop it.
process.once('message', () => {
  for (;;) {
    Math.sqrt(Math.random());
  }
});
process.send({ ready: true });
