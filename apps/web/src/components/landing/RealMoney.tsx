import { useRef } from "react";
import { m } from "motion/react";
import executeIcon from "@/assets/landing/icon-execute.webp";
import previewIcon from "@/assets/landing/icon-preview.webp";
import stopwatch from "@/assets/landing/doodle-stopwatch.webp";
import target from "@/assets/landing/doodle-target.webp";
import { Appear } from "@/components/ui/Appear";
import { Button } from "@/components/ui/Button";
import { toneFill, type Tone } from "@/components/ui/tones";
import { links } from "@/lib/links";
import { useDesktop } from "@/lib/use-media";
import { useStackGeometry, useStackScale } from "@/lib/use-stack-scale";
import { Numbers } from "./Numbers";

type Check = {
  icon: string;
  title: string;
  copy: string;
  tone: Tone;
};

const checks: readonly Check[] = [
  {
    icon: stopwatch,
    title: "Check the window",
    copy: "Expired, withdrawn or outside its entry range: the plan is declined before anything is sized.",
    tone: "peach",
  },
  {
    icon: previewIcon,
    title: "Size to your budget",
    copy: "Quantity rounds down to the market’s step. It never rounds up to reach a minimum.",
    tone: "mint",
  },
  {
    icon: target,
    title: "Place with exits",
    copy: "A limit entry capped at the plan’s price, with the stop and target attached on Strike.",
    tone: "blush",
  },
  {
    icon: executeIcon,
    title: "Reconcile every fill",
    copy: "When a response is unclear, Cadence asks Strike what happened before it sends anything again.",
    tone: "sky",
  },
];

const promises = [
  "Bounded entry price",
  "Stop and target on Strike",
  "Never a second order",
  "Pause at any time",
];

const stickyTops = [
  "lg:top-[160px]",
  "lg:top-[185px]",
  "lg:top-[210px]",
  "lg:top-[235px]",
] as const;
const cardStep = 364;

type CheckCardProps = {
  check: Check;
  index: number;
  geometry: ReturnType<typeof useStackGeometry>;
  desktop: boolean;
};

function CheckCard({ check, index, geometry, desktop }: CheckCardProps) {
  const scale = useStackScale(geometry, index, checks.length, cardStep);
  return (
    <m.article
      style={desktop ? { scale } : {}}
      className={`flex flex-col gap-[30px] rounded-card border border-ink p-[30px] lg:sticky lg:h-[334px] lg:p-10 ${stickyTops[index] ?? ""} ${toneFill[check.tone]}`}
    >
      <div className="flex items-start justify-between">
        <span className="flex size-[72px] items-center justify-center rounded-[36px] border border-ink bg-paper">
          <img src={check.icon} alt="" className="h-12 w-auto" />
        </span>
        <span className="t-body">({String(index + 1).padStart(2, "0")})</span>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="t-card">{check.title}</h3>
        <p className="t-body">{check.copy}</p>
      </div>
    </m.article>
  );
}

export function RealMoney() {
  const desktop = useDesktop();
  const list = useRef<HTMLDivElement>(null);
  const geometry = useStackGeometry(list);
  return (
    <section
      id="real-money"
      className="hairline-top bg-lavender px-[30px] py-[100px] md:py-[140px] lg:py-40"
    >
      <div className="shell flex flex-col gap-[100px] lg:gap-40">
        <div className="flex flex-col gap-[50px] md:gap-[60px] lg:flex-row lg:items-start lg:justify-between lg:gap-[120px]">
          <Appear
            delay={0.1}
            className="flex flex-col gap-[35px] lg:sticky lg:top-[180px] lg:w-[540px]"
          >
            <div className="flex flex-col gap-[15px]">
              <h2 className="t-h2">Built for real money.</h2>
              <p className="t-body">
                Every approval is checked twice: once when you preview, and again the moment before
                the order leaves. If anything changed in between, nothing is sent, and you see why.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
              {promises.map((promise) => (
                <li key={promise} className="t-body flex gap-2">
                  <span aria-hidden="true">↳</span>
                  {promise}
                </li>
              ))}
            </ul>
            <div>
              <Button href={links.repository} external>
                Read the code
              </Button>
            </div>
          </Appear>
          <Appear delay={0.25} className="lg:w-[540px]">
            <div ref={list} className="grid grid-cols-1 gap-[30px] md:grid-cols-2 lg:grid-cols-1">
              {checks.map((check, index) => (
                <CheckCard
                  key={check.title}
                  check={check}
                  index={index}
                  geometry={geometry}
                  desktop={desktop}
                />
              ))}
            </div>
          </Appear>
        </div>
        <Numbers />
      </div>
    </section>
  );
}
