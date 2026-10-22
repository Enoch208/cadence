import Lenis from "lenis";
import { useEffect } from "react";

export function useSmoothScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const lenis = new Lenis({ lerp: 0.1, autoRaf: true, anchors: true });
    return () => {
      lenis.destroy();
    };
  }, [enabled]);
}
