// Runs one custom arena's grade.ts away from Beagle's own thread, so a grader that spins can be
// stopped without stopping Beagle. Loaded with Node's own type stripping.
import { parentPort, workerData } from 'node:worker_threads';
try {
  const grade = (await import(workerData.url)).default;
  if (typeof grade !== 'function') throw new Error('grade.ts must export a default function (answer, truth) => number');
  parentPort.on('message', async ({ id, answer, truth }) => {
    try { parentPort.postMessage({ id, score: await grade(answer, truth) }); } catch (e) { parentPort.postMessage({ id, error: String(e?.message ?? e) }); }
  });
  parentPort.postMessage({ ready: true });
} catch (e) { parentPort.postMessage({ fatal: String(e?.message ?? e) }); }
