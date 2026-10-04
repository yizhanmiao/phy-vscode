import { parentPort } from 'node:worker_threads';
import { computeFns, type ComputeName } from '../compute';

parentPort!.on('message', ({ name, args }: { name: ComputeName; args: unknown[] }) => {
  try {
    const result = (computeFns[name] as (...a: unknown[]) => unknown)(...args);
    const transfer = ArrayBuffer.isView(result) && result.buffer instanceof ArrayBuffer ? [result.buffer] : [];
    parentPort!.postMessage({ result }, transfer);
  } catch (e) {
    parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
});
