/**
 * Cosmetic skins for the paddle, the ball and its trail. Each one (except the defaults) is
 * unlocked by a trophy, so collecting trophies changes how the game looks. Pure data: no Phaser,
 * shared by the game and the interface.
 */

export type SkinSlot = 'paddle' | 'ball' | 'trail';
export const SKIN_SLOTS: readonly SkinSlot[] = ['paddle', 'ball', 'trail'];

export interface PaddleLook {
  /** Body gradient, top to bottom. */
  body: readonly [string, string, string];
  edge: string;
  /** End caps gradient, top to bottom. */
  caps: readonly [string, string];
  /** Soft glow around the paddle (rgb triplet). */
  glow: readonly [number, number, number];
  /** Thin shine line across the body. */
  shine: string;
}

export interface BallLook {
  /** Halo colour (rgb triplet). */
  halo: readonly [number, number, number];
  /** Core gradient, centre to edge. */
  core: readonly [string, string, string];
  /** Optional ring drawn around the core. */
  ring?: string;
}

export interface TrailLook {
  /** One colour, or several picked at random (rainbow). Empty = no trail. */
  tints: readonly number[];
  lifespan: number;
  scale: number;
  alpha: number;
}

export interface SkinDef<L> {
  id: string;
  /** Trophy that unlocks it; none = available from the start. */
  trophy?: string;
  look: L;
}

export const PADDLE_SKINS: readonly SkinDef<PaddleLook>[] = [
  {
    id: 'forge',
    look: {
      body: ['#fffaf0', '#e9dfcb', '#a8987a'],
      edge: '#ffb423',
      caps: ['#ffd27a', '#e07b10'],
      glow: [255, 170, 40],
      shine: 'rgba(255, 255, 255, 0.55)'
    }
  },
  {
    id: 'steel',
    trophy: 'chapter-1',
    look: {
      body: ['#f2f6fa', '#b9c6d3', '#6f7f90'],
      edge: '#8fbbe0',
      caps: ['#d6e6f5', '#4f6f8f'],
      glow: [143, 187, 224],
      shine: 'rgba(255, 255, 255, 0.7)'
    }
  },
  {
    id: 'neon',
    trophy: 'combo-50',
    look: {
      body: ['#2a1438', '#1a0d26', '#0f0818'],
      edge: '#ff4fd8',
      caps: ['#7cf7ff', '#1aa7c9'],
      glow: [255, 79, 216],
      shine: 'rgba(124, 247, 255, 0.8)'
    }
  },
  {
    id: 'gold',
    trophy: 'first-gold',
    look: {
      body: ['#fff4c2', '#f5c84a', '#a8761a'],
      edge: '#fff0a0',
      caps: ['#fffbe0', '#d39a1e'],
      glow: [255, 210, 80],
      shine: 'rgba(255, 255, 255, 0.75)'
    }
  },
  {
    id: 'crystal',
    trophy: 'all-mechanisms',
    look: {
      body: ['#e8fbff', '#9fe3f0', '#4aa9c4'],
      edge: '#c9f6ff',
      caps: ['#ffffff', '#6fd0e6'],
      glow: [120, 220, 255],
      shine: 'rgba(255, 255, 255, 0.9)'
    }
  },
  {
    id: 'obsidian',
    trophy: 'endless-10',
    look: {
      body: ['#4a3f52', '#241d2a', '#0d0a10'],
      edge: '#ff6b3d',
      caps: ['#ff9a5c', '#a3290f'],
      glow: [255, 90, 40],
      shine: 'rgba(255, 140, 90, 0.5)'
    }
  },
  {
    id: 'warden',
    trophy: 'boss-slayer',
    look: {
      body: ['#5a1a22', '#3a0d13', '#1a0508'],
      edge: '#ff4d5e',
      caps: ['#ffb423', '#9b2335'],
      glow: [255, 77, 94],
      shine: 'rgba(255, 180, 35, 0.7)'
    }
  },
  {
    id: 'diamond',
    trophy: 'all-diamond',
    look: {
      body: ['#ffffff', '#dff4ff', '#9ccbe8'],
      edge: '#bff0ff',
      caps: ['#ffffff', '#8fd8ff'],
      glow: [190, 240, 255],
      shine: 'rgba(255, 255, 255, 1)'
    }
  }
];

export const BALL_SKINS: readonly SkinDef<BallLook>[] = [
  {
    id: 'ember',
    look: { halo: [255, 160, 50], core: ['#ffffff', '#fff4d6', '#ffc65a'] }
  },
  {
    id: 'ice',
    trophy: 'chapter-2',
    look: { halo: [120, 200, 255], core: ['#ffffff', '#dff3ff', '#7cc4f2'] }
  },
  {
    id: 'plasma',
    trophy: 'balls-30',
    look: { halo: [200, 90, 255], core: ['#ffffff', '#f0d6ff', '#b65cff'], ring: '#f3c6ff' }
  },
  {
    id: 'toxic',
    trophy: 'risk-taker',
    look: { halo: [120, 255, 90], core: ['#ffffff', '#e2ffd0', '#6fe04a'] }
  },
  {
    id: 'sun',
    trophy: 'all-combos',
    look: { halo: [255, 110, 30], core: ['#fffbe6', '#ffd23f', '#ff6a1a'], ring: '#ffe28a' }
  },
  {
    id: 'void',
    trophy: 'purist',
    look: { halo: [150, 120, 255], core: ['#1a1030', '#3b2a6b', '#8c7dff'], ring: '#c9bfff' }
  },
  {
    id: 'diamond',
    trophy: 'first-diamond',
    look: { halo: [190, 240, 255], core: ['#ffffff', '#ecfaff', '#a8e4ff'], ring: '#ffffff' }
  }
];

export const TRAIL_SKINS: readonly SkinDef<TrailLook>[] = [
  { id: 'ember', look: { tints: [0xffb44a], lifespan: 110, scale: 0.2, alpha: 0.2 } },
  { id: 'none', look: { tints: [], lifespan: 0, scale: 0, alpha: 0 } },
  {
    id: 'frost',
    trophy: 'chapter-3',
    look: { tints: [0x9fe3ff], lifespan: 150, scale: 0.22, alpha: 0.25 }
  },
  {
    id: 'comet',
    trophy: 'explosions-25',
    look: { tints: [0xff7a2a, 0xffd25a], lifespan: 240, scale: 0.3, alpha: 0.3 }
  },
  {
    id: 'sparks',
    trophy: 'combo-100',
    look: { tints: [0xff4fd8, 0x7cf7ff], lifespan: 180, scale: 0.18, alpha: 0.4 }
  },
  {
    id: 'rainbow',
    trophy: 'challenges-60',
    look: {
      tints: [0xff5a5a, 0xffb423, 0xfff05a, 0x5fe0a8, 0x5ab4ff, 0xb65cff],
      lifespan: 200,
      scale: 0.24,
      alpha: 0.35
    }
  }
];

export type SkinChoice = Record<SkinSlot, string>;
export const DEFAULT_SKINS: SkinChoice = { paddle: 'forge', ball: 'ember', trail: 'ember' };

const CATALOGUE: Record<SkinSlot, readonly SkinDef<unknown>[]> = {
  paddle: PADDLE_SKINS,
  ball: BALL_SKINS,
  trail: TRAIL_SKINS
};

export function skinsFor(slot: SkinSlot): readonly SkinDef<unknown>[] {
  return CATALOGUE[slot];
}

export function isSkinUnlocked(
  slot: SkinSlot,
  id: string,
  achievements: Readonly<Record<string, number>>
): boolean {
  const skin = CATALOGUE[slot].find((item) => item.id === id);
  return Boolean(skin && (!skin.trophy || achievements[skin.trophy]));
}

/** Keeps known ids only (anything else falls back to the default). */
export function sanitizeSkins(value: unknown): SkinChoice {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (slot: SkinSlot): string => {
    const id = source[slot];
    return typeof id === 'string' && CATALOGUE[slot].some((item) => item.id === id)
      ? id
      : DEFAULT_SKINS[slot];
  };
  return { paddle: pick('paddle'), ball: pick('ball'), trail: pick('trail') };
}

/** The skins actually used: a chosen skin that is (no longer) unlocked falls back to default. */
export function activeSkins(
  choice: SkinChoice,
  achievements: Readonly<Record<string, number>>
): SkinChoice {
  const pick = (slot: SkinSlot): string =>
    isSkinUnlocked(slot, choice[slot], achievements) ? choice[slot] : DEFAULT_SKINS[slot];
  return { paddle: pick('paddle'), ball: pick('ball'), trail: pick('trail') };
}

/** Skins that the given new trophies unlock (for the result screen). */
export function skinsUnlockedBy(
  trophies: readonly string[]
): Array<{ slot: SkinSlot; id: string }> {
  return SKIN_SLOTS.flatMap((slot) =>
    CATALOGUE[slot]
      .filter((skin) => skin.trophy && trophies.includes(skin.trophy))
      .map((skin) => ({ slot, id: skin.id }))
  );
}

export function paddleLook(id: string): PaddleLook {
  return (PADDLE_SKINS.find((skin) => skin.id === id) ?? PADDLE_SKINS[0]!).look;
}

export function ballLook(id: string): BallLook {
  return (BALL_SKINS.find((skin) => skin.id === id) ?? BALL_SKINS[0]!).look;
}

export function trailLook(id: string): TrailLook {
  return (TRAIL_SKINS.find((skin) => skin.id === id) ?? TRAIL_SKINS[0]!).look;
}
