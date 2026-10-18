// Takes the file and ends without an answer.
process.once('message', () => process.exit(3));
process.send({ ready: true });
