import type { WorkerDeps } from "./deps";
import { logFailure } from "./log";
import { runNotifier, type NotifierDeps } from "./notify";
import { runPass } from "./pass";

export type WorkerLoop = { stop(): Promise<void> };

type Control = { stopping: boolean; wakes: Set<() => void> };

type LoopOptions = { intervalMs: number; notifier?: NotifierDeps | null };

function repeat(
  control: Control,
  intervalMs: number,
  what: string,
  step: () => Promise<unknown>,
): Promise<void> {
  const rest = () =>
    new Promise<boolean>((resolve) => {
      if (control.stopping) {
        resolve(false);
        return;
      }
      const wake = () => {
        clearTimeout(timer);
        control.wakes.delete(wake);
        resolve(false);
      };
      const timer = setTimeout(() => {
        control.wakes.delete(wake);
        resolve(true);
      }, intervalMs);
      control.wakes.add(wake);
    });

  return (async () => {
    do {
      try {
        await step();
      } catch (error) {
        logFailure(what, error);
      }
    } while (await rest());
  })();
}

export function startWorkerLoop(deps: WorkerDeps, options: LoopOptions): WorkerLoop {
  const control: Control = { stopping: false, wakes: new Set() };
  const { notifier = null } = options;
  const running = [
    repeat(control, options.intervalMs, "A worker pass", () => runPass(deps)),
    ...(notifier === null
      ? []
      : [repeat(control, options.intervalMs, "A notifier pass", () => runNotifier(notifier))]),
  ];

  return {
    stop: async () => {
      control.stopping = true;
      for (const wake of [...control.wakes]) {
        wake();
      }
      await Promise.all(running);
    },
  };
}
