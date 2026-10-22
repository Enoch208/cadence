import type { ReactNode } from "react";
import { Appear } from "./Appear";

const widths = {
  narrow: "max-w-[750px]",
  medium: "max-w-[800px]",
  wide: "max-w-[850px]",
} as const;

type SectionHeaderProps = {
  title: string;
  intro: ReactNode;
  width: keyof typeof widths;
};

export function SectionHeader({ title, intro, width }: SectionHeaderProps) {
  return (
    <Appear
      delay={0.1}
      className={`mx-auto flex flex-col items-center gap-[15px] text-center ${widths[width]}`}
    >
      <h2 className="t-h2">{title}</h2>
      <p className="t-intro">{intro}</p>
    </Appear>
  );
}
