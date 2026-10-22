import { Appear } from "@/components/ui/Appear";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { toneText, type Tone } from "@/components/ui/tones";

type Measure = {
  label: string;
  tone: Tone;
};

const measures: readonly Measure[] = [
  { label: "Plans published", tone: "peach" },
  { label: "Orders placed on Strike", tone: "lavender" },
  { label: "Exits verified", tone: "sky" },
  { label: "Late entries declined", tone: "mint" },
  { label: "Duplicate orders sent", tone: "blush" },
];

const notYetMeasured = "—";

export function Numbers() {
  return (
    <div className="flex flex-col gap-10 lg:gap-[50px]">
      <SectionHeader
        width="narrow"
        title="Measured on Strike mainnet."
        intro={
          <>
            Counted from Cadence’s own records of <strong>real orders</strong>. A dash means nothing
            has been measured yet.
          </>
        }
      />
      <ul className="mx-auto flex max-w-[960px] flex-wrap justify-center gap-[25px]">
        {measures.map((measure, index) => (
          <li key={measure.label}>
            <Appear variant="pop" delay={0.2 + index * 0.15}>
              <div className="flex h-[92px] items-center gap-[13px] rounded-pill border border-ink bg-paper px-[25px] py-[19px] transition-transform duration-[250ms] ease-linear hover:-rotate-5">
                <span className={`t-numeral ${toneText[measure.tone]}`}>{notYetMeasured}</span>
                <span className="t-body w-[140px] pb-[3px] leading-[1.25]">{measure.label}</span>
              </div>
            </Appear>
          </li>
        ))}
      </ul>
    </div>
  );
}
