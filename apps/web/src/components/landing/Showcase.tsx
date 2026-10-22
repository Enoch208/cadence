import { useRef, type ReactNode } from "react";
import { m } from "motion/react";
import { Appear } from "@/components/ui/Appear";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { toneFill, type Tone } from "@/components/ui/tones";
import { useDesktop } from "@/lib/use-media";
import { useStackGeometry, useStackScale } from "@/lib/use-stack-scale";
import { DeclinedPanel, ExitsPanel, PlanPanel, PreviewPanel } from "./ShowcasePanels";

type Moment = {
  category: string;
  title: string;
  copy: string;
  tone: Tone;
  panel: ReactNode;
};

const moments: readonly Moment[] = [
  {
    category: "Curator · one link",
    title: "Publish the plan",
    copy: "Market, direction, entry range, stop, target and an entry expiry. A correction becomes a new version, so nobody approves terms they never saw.",
    tone: "sky",
    panel: <PlanPanel />,
  },
  {
    category: "Member · your size",
    title: "Preview your trade",
    copy: "Cadence reads your account and the current market, then sizes the trade so its planned loss fits the budget you chose.",
    tone: "butter",
    panel: <PreviewPanel />,
  },
  {
    category: "Late · declined",
    title: "Late is not the same trade",
    copy: "Once the price leaves the entry range, the plan is declined in plain words, with the numbers that changed.",
    tone: "blush",
    panel: <DeclinedPanel />,
  },
  {
    category: "Strike · reconciled",
    title: "Exits verified on Strike",
    copy: "The order goes to Strike with its stop and target attached. Cadence shows a fill only after Strike confirms it.",
    tone: "mint",
    panel: <ExitsPanel />,
  },
];

const stickyTops = [
  "lg:top-[130px]",
  "lg:top-[160px]",
  "lg:top-[190px]",
  "lg:top-[220px]",
] as const;
const cardStep = 600;

type MomentCardProps = {
  moment: Moment;
  index: number;
  geometry: ReturnType<typeof useStackGeometry>;
  desktop: boolean;
};

function MomentCard({ moment, index, geometry, desktop }: MomentCardProps) {
  const scale = useStackScale(geometry, index, moments.length, cardStep);
  return (
    <m.article
      style={desktop ? { scale } : {}}
      className={`flex flex-col overflow-clip rounded-card border border-ink bg-paper lg:sticky lg:h-[560px] lg:flex-row lg:items-center lg:justify-center lg:gap-[120px] lg:p-[60px] ${stickyTops[index] ?? ""}`}
    >
      <div className="order-2 flex flex-col gap-[25px] p-[30px] md:px-10 md:pb-[50px] lg:order-1 lg:w-[360px] lg:p-0">
        <div className="flex flex-col gap-[15px]">
          <span className="t-meta">{moment.category}</span>
          <h3 className="t-title">{moment.title}</h3>
        </div>
        <p className="t-body">{moment.copy}</p>
      </div>
      <div
        className={`relative order-1 flex items-center justify-center overflow-hidden border-b border-ink px-4 pt-[92px] pb-10 md:h-[480px] md:p-0 lg:order-2 lg:h-[440px] lg:w-[600px] lg:rounded-card lg:border ${toneFill[moment.tone]}`}
      >
        <span className="absolute top-4 left-4 inline-flex h-8 items-center rounded-pill border border-ink bg-paper px-3 t-meta">
          Example
        </span>
        <div className="[zoom:0.78] md:[zoom:1]">{moment.panel}</div>
      </div>
    </m.article>
  );
}

export function Showcase() {
  const desktop = useDesktop();
  const list = useRef<HTMLDivElement>(null);
  const geometry = useStackGeometry(list);
  return (
    <section id="product" className="px-[30px] py-[100px] md:py-[140px] lg:py-40">
      <div className="shell flex flex-col gap-10 lg:gap-[60px]">
        <SectionHeader
          width="wide"
          title="One link. Four moments."
          intro={
            <>
              What the curator publishes, what each member sees, and what <strong>Strike</strong>{" "}
              confirms.
            </>
          }
        />
        <Appear delay={0.25}>
          <div ref={list} className="flex flex-col gap-[30px] lg:gap-10">
            {moments.map((moment, index) => (
              <MomentCard
                key={moment.title}
                moment={moment}
                index={index}
                geometry={geometry}
                desktop={desktop}
              />
            ))}
          </div>
        </Appear>
      </div>
    </section>
  );
}
