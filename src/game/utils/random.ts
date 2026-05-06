export interface RandomSource {
  next(): number;
}

export interface WeightedItem<T> {
  item: T;
  weight: number;
}

export const nativeRandom: RandomSource = {
  next: () => Math.random()
};

export class SeededRandom implements RandomSource {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export function chance(probability: number, rng: RandomSource = nativeRandom): boolean {
  return rng.next() < Math.min(Math.max(probability, 0), 1);
}

export function pickWeighted<T>(items: Array<WeightedItem<T>>, rng: RandomSource): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty weighted item list');
  }

  const totalWeight = items.reduce((total, item) => total + Math.max(item.weight, 0), 0);

  if (totalWeight <= 0) {
    return items[0].item;
  }

  let roll = rng.next() * totalWeight;

  for (const weighted of items) {
    roll -= Math.max(weighted.weight, 0);

    if (roll <= 0) {
      return weighted.item;
    }
  }

  return items[items.length - 1].item;
}
