export type Tone = "sky" | "butter" | "mint" | "blush" | "peach" | "lime" | "lavender";

export const toneFill: Record<Tone, string> = {
  sky: "bg-sky",
  butter: "bg-butter",
  mint: "bg-mint",
  blush: "bg-blush",
  peach: "bg-peach",
  lime: "bg-lime",
  lavender: "bg-lavender",
};

export const toneText: Record<Tone, string> = {
  sky: "text-sky",
  butter: "text-butter",
  mint: "text-mint",
  blush: "text-blush",
  peach: "text-peach",
  lime: "text-lime",
  lavender: "text-lavender",
};

export type PressableTone = "sky" | "butter" | "mint";

export const pressableFill: Record<PressableTone, string> = {
  sky: "bg-sky hover:bg-sky-deep",
  butter: "bg-butter hover:bg-butter-deep",
  mint: "bg-mint hover:bg-mint-deep",
};
