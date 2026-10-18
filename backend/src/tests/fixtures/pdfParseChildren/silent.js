// Takes the file and never answers: the runner's deadline must end it.
process.on('message', () => {});
setInterval(() => {}, 1000);
process.send({ ready: true });
