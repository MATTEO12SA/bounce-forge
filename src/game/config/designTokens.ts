export const TOKENS = {
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 40,
    xxl: 64
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 20
  },
  shadow: {
    soft: { dx: 0, dy: 4, blur: 12, color: '#000814', alpha: 0.35 },
    elev: { dx: 0, dy: 8, blur: 22, color: '#000814', alpha: 0.45 }
  },
  font: {
    family: 'Arial, sans-serif',
    title: { size: 92, weight: '900' },
    h1: { size: 64, weight: '900' },
    h2: { size: 40, weight: '900' },
    label: { size: 28, weight: '800' },
    body: { size: 26, weight: '700' },
    value: { size: 24, weight: '900' }
  }
} as const;

export type SpacingKey = keyof typeof TOKENS.spacing;
export type RadiusKey = keyof typeof TOKENS.radius;
