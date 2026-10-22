import { Fragment } from "react";
import { m, useReducedMotion } from "motion/react";
import { appear, framerTween } from "@/lib/motion";

type WordRevealProps = {
  text: string;
  delay: number;
  tween?: boolean;
};

export function WordReveal({ text, delay, tween = false }: WordRevealProps) {
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");
  return words.map((word, index) => {
    const wordDelay = delay + index * 0.1;
    return (
      <Fragment key={`${word}-${String(index)}`}>
        <m.span
          className="inline-block"
          initial={reduceMotion ? false : { opacity: 0.001, filter: "blur(1px)", y: 10 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={tween ? framerTween(wordDelay) : appear(wordDelay)}
        >
          {word}
        </m.span>
        {index < words.length - 1 ? " " : null}
      </Fragment>
    );
  });
}
