// Answers with what the child was started with: its environment's keys, its
// flags, its scheduling priority, and the size of the file it received.
import { getPriority } from 'os';

process.once('message', ({ pdf, maxPages, maxChars }) => {
  process.send({
    ok: true,
    text: JSON.stringify({
      envKeys: Object.keys(process.env),
      execArgv: process.execArgv,
      priority: getPriority(),
      bytes: pdf.length,
      maxPages,
      maxChars,
    }),
    numpages: 0,
  }, () => process.exit(0));
});
process.send({ ready: true });
