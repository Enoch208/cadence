import type { ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";
import { appear } from "@/lib/motion";

const start = {
  up: { opacity: 0, y: 20 },
  rise: { opacity: 0, y: 10 },
  pop: { opacity: 0, scale: 0.95 },
  fade: { opacity: 0 },
} as const;

type AppearProps = {
  children: ReactNode;
  variant?: keyof typeof start;
  delay?: number;
  className?: string;
  inline?: boolean;
};

const settled = { opacity: 1, y: 0, scale: 1 };

export function Appear({
  children,
  variant = "up",
  delay = 0,
  className,
  inline = false,
}: AppearProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return inline ? (
      <span className={className}>{children}</span>
    ) : (
      <div className={className}>{children}</div>
    );
  }
  const shared = {
    className,
    initial: start[variant],
    whileInView: settled,
    viewport: { once: true, amount: 0 },
    transition: appear(delay),
  };
  return inline ? <m.span {...shared}>{children}</m.span> : <m.div {...shared}>{children}</m.div>;
}
