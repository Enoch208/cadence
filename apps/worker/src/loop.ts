import type { WorkerDeps } from "./deps";
import { logFailure } from "./log";
import { runPass } from "./pass";

export type WorkerLoop = { stop(): Promise<void> };

type Control = { stopping: boolean; wake: (() => void) | null };

export function startWorkerLoop(deps: WorkerDeps, options: { intervalMs: number }): WorkerLoop {
  const control: Control = { stopping: false, wake: null };

  const rest = () =>
    new Promise<boolean>((resolve) => {
      if (control.stopping) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        resolve(true);
      }, options.intervalMs);
      control.wake = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });

  const running = (async () => {
    do {
      try {
        await runPass(deps);
      } catch (error) {
        logFailure("A worker pass", error);
      }
    } while (await rest());
  })();

  return {
    stop: async () => {
      control.stopping = true;
      control.wake?.();
      await running;
    },
  };
}
