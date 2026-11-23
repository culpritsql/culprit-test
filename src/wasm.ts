import {
  diffPlans,
  exportPlan,
  init,
  ParserError,
  parseDeadlock,
  parsePlan,
  type CompareContext,
  type CoreError,
  type Deadlock,
  type Engine,
  type ExportFile,
  type ExportFormat,
  type ExportOptions,
  type Plan,
  type PlanDiff,
} from "@culpritsql/plans";

export type PlanNode = Plan["root"];
export type PlanFacts = Plan["facts"];
export type PlanNodeFacts = PlanNode["facts"];
export type NodeRuntime = NonNullable<PlanNode["runtime"]>;
export type PlanWarning = Plan["warnings"][number];
export type PlanIndexHint = Plan["index_hints"][number];
export type PlanConversion = PlanFacts["conversions"][number];
export type NodeKind = PlanNode["kind"];
export type PlanKind = Plan["kind"];
export type PlanChange = PlanDiff["changes"][number];
export type ChangeKind = PlanChange["kind"];

export {
  diffPlans,
  exportPlan,
  init,
  ParserError,
  parseDeadlock,
  parsePlan,
  type CompareContext,
  type CoreError,
  type Deadlock,
  type Engine,
  type ExportFile,
  type ExportFormat,
  type ExportOptions,
  type Plan,
  type PlanDiff,
};

let initPromise: Promise<void> | null = null;
let wasmReady = false;

async function loadDefaultWasm(): Promise<void> {
  if (typeof import.meta.resolve === "function") {
    const entryUrl = import.meta.resolve("@culpritsql/plans");
    const wasmUrl = new URL("./native/culprit_wasm_bg.wasm", entryUrl);
    if (wasmUrl.protocol === "file:") {
      const { readFile } = await import("node:fs/promises");
      const module_or_path = await readFile(wasmUrl);
      await init({ module_or_path });
      return;
    }
    await init({ module_or_path: wasmUrl });
    return;
  }
  await init();
}

/**
 * Universal Node.js, Bun, and browser initializer for `@culpritsql/plans`.
 * Caches the initialization promise and resets it if instantiation fails so retries remain safe.
 */
export function ensureWasmInit(input?: Parameters<typeof init>[0]): Promise<void> {
  if (input !== undefined) {
    const customPromise = init(input).then(() => {
      wasmReady = true;
    });
    initPromise = customPromise.catch((err: unknown) => {
      initPromise = null;
      throw err;
    });
    return initPromise;
  }

  if (initPromise !== null) {
    return initPromise;
  }

  initPromise = loadDefaultWasm()
    .then(() => {
      wasmReady = true;
    })
    .catch((err: unknown) => {
      initPromise = null;
      throw err;
    });

  return initPromise;
}

/** Alias for `ensureWasmInit` for explicit test suite setup hooks (`beforeAll(() => initWasm())`). */
export const initWasm = ensureWasmInit;

/** True once the underlying `@culpritsql/plans` WebAssembly instance is ready for synchronous calls. */
export function isWasmReady(): boolean {
  return wasmReady;
}
