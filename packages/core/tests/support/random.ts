export type Random = {
  fraction: () => number;
  integer: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
};

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const fraction = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const integer = (min: number, max: number) => min + Math.floor(fraction() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    const item = items[integer(0, items.length - 1)];
    if (item === undefined) {
      throw new RangeError("Cannot pick from an empty list");
    }
    return item;
  };
  return { fraction, integer, chance: (probability) => fraction() < probability, pick };
}
