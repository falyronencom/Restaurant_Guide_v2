// Takes the file and grows its V8 heap until the --max-old-space-size the
// runner set stops it.
process.once('message', () => {
  const hold = [];
  for (;;) {
    hold.push(new Array(1e5).fill(hold.length));
  }
});
process.send({ ready: true });
