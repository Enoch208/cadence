import strikeLogo from "@/assets/brand/strike-logo.svg";
import { Appear } from "@/components/ui/Appear";
import { links } from "@/lib/links";

export function StrikeStatement() {
  return (
    <section
      id="strike"
      aria-label="Built on Strike"
      className="px-[30px] pb-[100px] md:pb-[140px] lg:pb-40"
    >
      <Appear
        delay={0.2}
        className="mx-auto flex max-w-[850px] flex-col items-center gap-[30px] px-2.5 pt-[5px] pb-2.5 text-center"
      >
        <a href={links.strike} target="_blank" rel="noreferrer" aria-label="Strike Finance">
          <img src={strikeLogo} alt="Strike" width={237} height={34} className="h-[34px] w-auto" />
        </a>
        <p className="t-quote max-w-[830px]">
          Strike holds the account, the market and the orders. Cadence decides whether a plan still
          fits you, then hands Strike one bounded order with its stop and target attached.
        </p>
        <div className="flex flex-col gap-[5px]">
          <span className="t-name">Strike Finance</span>
          <span className="t-body">
            The perpetuals exchange where every Cadence order is placed
          </span>
        </div>
      </Appear>
    </section>
  );
}
