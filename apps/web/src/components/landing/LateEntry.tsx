import { Appear } from "@/components/ui/Appear";
import { Checks } from "./Checks";
import { RewardBars } from "./RewardBars";
import { ScallopPhoto } from "./ScallopPhoto";

export function LateEntry() {
  return (
    <section id="late" className="hairline-top px-[30px] pt-[100px] md:pt-[140px] lg:pt-40">
      <div className="shell flex flex-col gap-[100px] border-b border-ink pb-[100px] md:gap-[140px] md:pb-[140px] lg:gap-40 lg:pb-40">
        <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:gap-20">
          <Appear
            variant="pop"
            delay={0.1}
            className="w-full max-w-[560px] lg:w-[560px] lg:shrink-0"
          >
            <ScallopPhoto />
          </Appear>
          <Appear delay={0.2} className="flex flex-col gap-[30px] lg:w-[560px]">
            <div className="flex flex-col gap-[15px]">
              <h2 className="t-h2">Posted at 9:02. Taken at 9:40.</h2>
              <p className="t-body">
                Someone in your group posts a setup: long at 100, stop at 98, target at 106. You see
                it forty minutes later and the price is 105. Same idea, different trade: you would
                now risk seven to make one.
              </p>
              <p className="t-body">
                Cadence keeps the curator’s terms attached to the idea. Inside the entry range, it
                sizes the trade to your budget. Outside it, it says no and tells you why.
              </p>
            </div>
            <RewardBars />
          </Appear>
        </div>
        <Checks />
      </div>
    </section>
  );
}
