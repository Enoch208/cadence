import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import { useSmoothScroll } from "@/lib/use-smooth-scroll";
import { Closing } from "./Closing";
import { Hero } from "./Hero";
import { LateEntry } from "./LateEntry";
import { Navbar } from "./Navbar";
import { Questions } from "./Questions";
import { RealMoney } from "./RealMoney";
import { Showcase } from "./Showcase";
import { StepCards } from "./StepCards";
import { StrikeStatement } from "./StrikeStatement";

export function Landing() {
  const reduceMotion = useReducedMotion();
  useSmoothScroll(reduceMotion !== true);
  return (
    <LazyMotion features={domAnimation} strict>
      <Navbar />
      <main>
        <Hero />
        <StepCards />
        <Showcase />
        <StrikeStatement />
        <RealMoney />
        <LateEntry />
        <Questions />
      </main>
      <Closing />
    </LazyMotion>
  );
}
