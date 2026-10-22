import candles from "@/assets/landing/doodle-candles.webp";
import sparkles from "@/assets/landing/doodle-sparkles.webp";
import stopwatch from "@/assets/landing/doodle-stopwatch.webp";
import target from "@/assets/landing/doodle-target.webp";
import { Appear } from "@/components/ui/Appear";
import { Sticker } from "@/components/ui/Sticker";

export function HeroDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
      <Appear variant="pop" delay={0.8} className="absolute top-[24px] left-[-36px]">
        <img src={sparkles} alt="" className="absolute -top-9 -left-7 h-10 w-auto" />
        <Sticker tone="sky" className="-rotate-[12.5deg]">
          Built on Strike
        </Sticker>
      </Appear>
      <Appear variant="pop" delay={0.9} className="absolute top-[232px] right-[-48px]">
        <img src={target} alt="" className="absolute -top-9 -left-3 h-[34px] w-auto -rotate-6" />
        <Sticker tone="blush" className="rotate-[13deg]">
          Works in Telegram
        </Sticker>
      </Appear>
      <Appear variant="pop" delay={1.0} className="absolute top-[196px] left-[52px]">
        <img src={candles} alt="" className="h-[76px] w-auto -rotate-6" />
      </Appear>
      <Appear variant="pop" delay={1.1} className="absolute top-[4px] right-[62px]">
        <img src={stopwatch} alt="" className="h-[70px] w-auto rotate-[8deg]" />
      </Appear>
    </div>
  );
}
