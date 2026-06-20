export type RandomSource = () => number;

export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function chooseByProbability<T>(
  items: T[],
  getProbability: (item: T) => number,
  rng: RandomSource
): T {
  const total = items.reduce((sum, item) => sum + getProbability(item), 0);
  const target = rng() * total;
  let cursor = 0;

  for (const item of items) {
    cursor += getProbability(item);
    if (cursor >= target) {
      return item;
    }
  }

  return items[items.length - 1];
}
