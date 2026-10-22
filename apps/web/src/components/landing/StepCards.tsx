import { m, useScroll, useSpring, useTransform } from "motion/react";
import executeIcon from "@/assets/landing/icon-execute.webp";
import previewIcon from "@/assets/landing/icon-preview.webp";
import publishIcon from "@/assets/landing/icon-publish.webp";
import { ArrowLink } from "@/components/ui/ArrowLink";
import type { PressableTone } from "@/components/ui/tones";
import { useDesktop } from "@/lib/use-media";

type Fan = "left" | "centre" | "right";

type Step = {
  fan: Fan;
  icon: string;
  title: string;
  copy: string;
  href: string;
  tone: PressableTone;
};

const steps: readonly Step[] = [
  {
    fan: "left",
    icon: publishIcon,
    title: "Publish a plan",
    copy: "Entry range, stop, target and an expiry, shared as one link.",
    href: "#product",
    tone: "sky",
  },
  {
    fan: "centre",
    icon: previewIcon,
    title: "Preview for me",
    copy: "The size that fits your account, before anything is placed.",
    href: "#late",
    tone: "butter",
  },
  {
    fan: "right",
    icon: executeIcon,
    title: "Execute on Strike",
    copy: "One bounded order with its stop and target attached.",
    href: "#real-money",
    tone: "mint",
  },
];

const fanSpring = { damping: 80, stiffness: 300, mass: 1 };

function StepCard({ step }: { step: Step }) {
  return (
    <article className="flex h-full flex-col items-center gap-[25px] rounded-card border border-ink bg-paper px-[30px] pt-[30px] pb-[35px] text-center lg:px-10 lg:pt-10 lg:pb-[50px]">
      <img src={step.icon} alt="" className="h-[68px] w-auto" />
      <div className="flex flex-col gap-2">
        <h3 className="t-card">{step.title}</h3>
        <p className="t-body mx-auto max-w-[260px]">{step.copy}</p>
      </div>
      <ArrowLink href={step.href} label={step.title} tone={step.tone} />
    </article>
  );
}

export function StepCards() {
  const desktop = useDesktop();
  const { scrollY } = useScroll();
  const spread = useSpring(useTransform(scrollY, [0, 200], [380, 0]), fanSpring);
  const tilt = useSpring(useTransform(scrollY, [0, 200], [6, 0]), fanSpring);
  const leftX = spread;
  const rightX = useTransform(spread, (value) => -value);
  const leftRotate = useTransform(tilt, (value) => -value);

  const fanned = {
    left: { x: leftX, rotate: leftRotate, zIndex: 2 },
    centre: { x: 0, rotate: 0, zIndex: 1 },
    right: { x: rightX, rotate: tilt, zIndex: 2 },
  };

  return (
    <section id="how" aria-label="How Cadence works" className="relative px-[30px]">
      <div className="absolute inset-x-0 top-0 h-[150px] border-b border-ink bg-lavender lg:h-[170px]" />
      <div className="shell relative grid grid-cols-1 gap-[30px] md:grid-cols-2 lg:mx-auto lg:max-w-[1100px] lg:grid-cols-[repeat(3,340px)] lg:justify-center lg:gap-10">
        {steps.map((step) => (
          <m.div
            key={step.title}
            className={`lg:h-[340px] ${step.fan === "right" ? "md:col-span-2 lg:col-span-1" : ""}`}
            style={desktop ? fanned[step.fan] : {}}
          >
            <StepCard step={step} />
          </m.div>
        ))}
      </div>
    </section>
  );
}
