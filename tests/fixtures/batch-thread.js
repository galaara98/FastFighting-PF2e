/**
 * Test fixture: the core's engine/batch-worker.js on a thread of node's worker_threads, as a browser's module Web Worker
 * runs it for the planner (the core's engine/batch-pool.js). Nothing of Foundry's here, as in a browser's worker. The
 * core is where Foundry has it beside this module (../../fast-fighting/scripts/), the tests' core here
 * (FASTFIGHTING_CORE, vitest.config.js).
 *
 * workerData.trap: a module url to import first, with Foundry's globals watched; it posts {type: "touched", names}, the
 * globals it read as it loaded, and does nothing else.
 */
import { parentPort, workerData } from "node:worker_threads";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const core = process.env.FASTFIGHTING_CORE;
const coreUrl = pathToFileURL(core.endsWith("/") || core.endsWith("\\") ? core : `${core}/`).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  const m = specifier.match(/^(?:\\.\\.\\/)+fast-fighting\\/scripts\\/(.*)$/);
  return next(m ? new URL(m[1], ${JSON.stringify(coreUrl)}).href : specifier, context);
}`)}`);

if ( workerData?.trap ) {
  const touched = new Set();
  for ( const name of ["game", "CONFIG", "canvas", "ui", "foundry", "Hooks", "CONST", "fromUuid", "ChatMessage", "Roll", "document", "window"] ) {
    Object.defineProperty(globalThis, name, { configurable: true, get: () => { touched.add(name); return undefined; } });
  }
  await import(workerData.trap);
  parentPort.postMessage({ type: "touched", names: [...touched] });
} else {
  const { batchHost } = await import("../../../fast-fighting/scripts/engine/batch-worker.js");
  const handle = batchHost(message => parentPort.postMessage(message));
  parentPort.on("message", handle);
}
