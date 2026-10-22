import { useCallback, useEffect, useRef, useState } from "react";

type Outcome<T> = { ok: true; data: T } | { ok: false; error: Error };

export type Resource<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; reload: () => void }
  | { status: "failed"; error: Error; reload: () => void };

export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const [round, setRound] = useState(0);
  const [settled, setSettled] = useState<{ token: string; outcome: Outcome<T> } | null>(null);
  const token = key === null ? null : `${key}#${String(round)}`;

  useEffect(() => {
    if (token === null) {
      return;
    }
    const controller = new AbortController();
    loader.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSettled({ token, outcome: { ok: true, data } });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setSettled({
            token,
            outcome: {
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [token]);

  const reload = useCallback(() => {
    setRound((value) => value + 1);
  }, []);

  if (token === null) {
    return { status: "idle" };
  }
  if (settled?.token !== token) {
    return { status: "loading" };
  }
  return settled.outcome.ok
    ? { status: "ready", data: settled.outcome.data, reload }
    : { status: "failed", error: settled.outcome.error, reload };
}
