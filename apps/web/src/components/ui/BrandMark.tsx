import mark from "@/assets/brand/cadence-mark.webp";

export function BrandMark() {
  return (
    <a href="#top" className="inline-flex items-center gap-2.5" aria-label="Cadence, back to top">
      <img src={mark} alt="" width={28} height={29} className="h-[29px] w-7" />
      <span className="text-[26px] leading-none font-medium tracking-[-0.04em]">Cadence</span>
    </a>
  );
}
