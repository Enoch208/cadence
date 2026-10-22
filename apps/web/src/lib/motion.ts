import type { Transition } from "motion/react";

export const appear = (delay: number): Transition => ({
  type: "spring",
  bounce: 0.2,
  duration: 1.2,
  delay,
});

export const settle: Transition = { type: "spring", bounce: 0, duration: 0.8 };

export const framerTween = (delay: number): Transition => ({
  type: "tween",
  duration: 0.5,
  ease: [0.44, 0, 0.56, 1],
  delay,
});
