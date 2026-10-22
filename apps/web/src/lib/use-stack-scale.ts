import { useLayoutEffect, useState, type RefObject } from "react";
import { useScroll, useSpring, useTransform, type MotionValue } from "motion/react";

type StackGeometry = {
  listTop: number;
  viewportHeight: number;
};

export function useStackGeometry(list: RefObject<HTMLElement | null>): StackGeometry | null {
  const [geometry, setGeometry] = useState<StackGeometry | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setGeometry({
        listTop: element.getBoundingClientRect().top + window.scrollY,
        viewportHeight: window.innerHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [list]);
  return geometry;
}

export function useStackScale(
  geometry: StackGeometry | null,
  index: number,
  count: number,
  step: number,
): MotionValue<number> {
  const { scrollY } = useScroll();
  const coveredBy = count - 1 - index;
  const target = useTransform(scrollY, (y) => {
    if (!geometry || coveredBy === 0) {
      return 1;
    }
    const nextCardEnters = geometry.listTop + (index + 1) * step - geometry.viewportHeight;
    const progress = Math.min(Math.max((y - nextCardEnters) / step, 0), coveredBy);
    return 1 - 0.05 * progress;
  });
  return useSpring(target, { damping: 60, stiffness: 500 });
}
