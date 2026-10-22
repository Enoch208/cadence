import strikeMark from "@/assets/brand/strike-mark.png";
import strikeLogoWhite from "@/assets/brand/strike-logo-white.svg";
import { Appear } from "@/components/ui/Appear";
import { RouteButton } from "@/components/ui/Button";
import { CircleBadge } from "@/components/ui/CircleBadge";
import { links } from "@/lib/links";

function ChatBubble() {
  return (
    <svg viewBox="0 0 79 61" aria-hidden="true" className="h-[61px] w-[79px]">
      <path
        d="M10 1 H69 A9 9 0 0 1 78 10 V40 A9 9 0 0 1 69 49 H30 L16 60 L18 49 H10 A9 9 0 0 1 1 40 V10 A9 9 0 0 1 10 1 Z"
        className="fill-paper stroke-paper"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {[24, 39.5, 55].map((x) => (
        <circle key={x} cx={x} cy="25" r="5" className="fill-butter stroke-ink" strokeWidth="1" />
      ))}
    </svg>
  );
}

function HandArrow() {
  return (
    <svg viewBox="0 0 43 36" aria-hidden="true" className="h-9 w-[43px] rotate-[-105deg]">
      <path
        d="M3 33 C 10 18, 22 8, 38 5 M38 5 L 29 2 M38 5 L 33 13"
        className="fill-none stroke-paper"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const footerLinks = [
  { label: "GitHub", href: links.repository },
  { label: "X", href: links.x },
] as const;

export function Closing() {
  return (
    <footer className="relative bg-ink px-[30px] pt-[130px] text-paper md:pt-[140px] lg:pt-40">
      <Appear
        variant="fade"
        delay={0.3}
        className="absolute top-0 right-[30px] -translate-y-1/2 lg:right-[calc(50%-640px)]"
      >
        <CircleBadge text="BUILT ON STRIKE · BUILT ON STRIKE · " tone="butter" className="relative">
          <img src={strikeMark} alt="" className="size-9 rounded-full md:size-11" />
        </CircleBadge>
      </Appear>
      <div className="shell flex flex-col items-center gap-[140px] lg:gap-[170px]">
        <div className="flex max-w-[600px] flex-col items-center gap-[45px] text-center">
          <Appear variant="pop" delay={0.1}>
            <ChatBubble />
          </Appear>
          <div className="flex flex-col items-center gap-[50px]">
            <div className="flex flex-col gap-10">
              <Appear delay={0.2}>
                <h2 className="t-display">Got a setup worth sharing?</h2>
              </Appear>
              <Appear delay={0.3}>
                <p className="t-lead">
                  Publish it once. Every member gets a plan sized to their own account, or a plain
                  reason why not.
                </p>
              </Appear>
            </div>
            <div className="relative">
              <Appear variant="rise" delay={0.4}>
                <RouteButton to="/app">Open the app</RouteButton>
              </Appear>
              <Appear
                variant="fade"
                delay={0.6}
                className="absolute top-[-6px] left-[calc(100%+18px)] hidden w-[170px] items-start gap-1 md:flex"
              >
                <HandArrow />
                <span className="t-hand -rotate-10 pt-6 text-left">try it in replay, no money</span>
              </Appear>
            </div>
          </div>
        </div>
        <Appear
          variant="rise"
          delay={0.1}
          className="flex w-full flex-col items-center gap-5 border-t border-paper py-10 md:flex-row md:justify-between"
        >
          <p className="t-body flex flex-wrap items-center justify-center gap-x-2">
            © 2026 Cadence. Orders are placed on
            <img
              src={strikeLogoWhite}
              alt="Strike"
              width={112}
              height={16}
              className="h-4 w-auto"
            />
          </p>
          <ul className="flex gap-[30px] md:gap-10">
            {footerLinks.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="t-nav transition-colors duration-[250ms] ease-framer hover:text-paper/60"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </Appear>
      </div>
    </footer>
  );
}
