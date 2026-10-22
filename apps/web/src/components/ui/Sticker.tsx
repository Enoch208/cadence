import { toneFill, type Tone } from "./tones";

type StickerProps = {
  children: string;
  tone: Tone;
  className: string;
};

export function Sticker({ children, tone, className }: StickerProps) {
  return (
    <span
      className={`pointer-events-none inline-flex h-[46px] items-center whitespace-nowrap rounded-pill border border-ink px-[22px] t-sticker ${toneFill[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
