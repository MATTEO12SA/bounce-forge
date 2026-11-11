export interface ThemeDefinition {
  id: string;
  name: string;
  backgroundTop: number;
  backgroundBottom: number;
  primary: number;
  secondary: number;
  accent: number;
  danger: number;
  success: number;
  warning: number;
  surface: number;
  surfaceSoft: number;
  panel: number;
  panelStrong: number;
  border: number;
  borderDim: number;
  playfieldTop: number;
  playfieldBottom: number;
  playfieldGrid: number;
  railOuter: number;
  railInner: number;
  railEdge: number;
  wall: number;
  wallHighlight: number;
  brickStroke: number;
  text: string;
  textMuted: string;
  textDark: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'forge',
    name: 'Forge',
    backgroundTop: 0x13110d,
    backgroundBottom: 0x070605,
    primary: 0xffb423,
    secondary: 0xff7a1a,
    accent: 0xf4c95d,
    danger: 0xff4d3d,
    success: 0x61d394,
    warning: 0xffdc35,
    surface: 0x080808,
    surfaceSoft: 0x141414,
    panel: 0x151515,
    panelStrong: 0x242015,
    border: 0xffb423,
    borderDim: 0x6b5216,
    playfieldTop: 0x18150f,
    playfieldBottom: 0x0a0907,
    playfieldGrid: 0x3a2f14,
    railOuter: 0x1d1810,
    railInner: 0x3b2f17,
    railEdge: 0xffb423,
    wall: 0x5b5750,
    wallHighlight: 0xa8a092,
    brickStroke: 0x6b5216,
    text: '#f4f7fb',
    textMuted: '#a39a8a',
    textDark: '#111111'
  },
  {
    id: 'neon',
    name: 'Vector',
    backgroundTop: 0x060b19,
    backgroundBottom: 0x02040b,
    primary: 0x56f2ff,
    secondary: 0xa98cff,
    accent: 0x78ffcf,
    danger: 0xff638e,
    success: 0x78ffcf,
    warning: 0xf3dc75,
    surface: 0x07101c,
    surfaceSoft: 0x0e1930,
    panel: 0x111f35,
    panelStrong: 0x172a45,
    border: 0x6ee8ff,
    borderDim: 0x243c65,
    playfieldTop: 0x091329,
    playfieldBottom: 0x030711,
    playfieldGrid: 0x1b5275,
    railOuter: 0x060d18,
    railInner: 0x263a58,
    railEdge: 0x96f0ff,
    wall: 0x52677e,
    wallHighlight: 0xc4f5ff,
    brickStroke: 0xe2fcff,
    text: '#f8fbff',
    textMuted: '#a8bbd7',
    textDark: '#05101b'
  },
  {
    id: 'ember',
    name: 'Ion',
    backgroundTop: 0x071411,
    backgroundBottom: 0x020807,
    primary: 0x64e6d1,
    secondary: 0x7da7ff,
    accent: 0xa7ff7a,
    danger: 0xff6675,
    success: 0xa7ff7a,
    warning: 0xe8df74,
    surface: 0x071511,
    surfaceSoft: 0x0e221d,
    panel: 0x112b25,
    panelStrong: 0x183a32,
    border: 0x73ead8,
    borderDim: 0x24564d,
    playfieldTop: 0x0a1b18,
    playfieldBottom: 0x030b0a,
    playfieldGrid: 0x1f5e53,
    railOuter: 0x06120f,
    railInner: 0x263f3b,
    railEdge: 0xa8fff1,
    wall: 0x526b68,
    wallHighlight: 0xc9fff5,
    brickStroke: 0xe4fff9,
    text: '#f5fffb',
    textMuted: '#a7c7bd',
    textDark: '#041210'
  }
];

function requireDefaultTheme(): ThemeDefinition {
  const fallback = THEMES[0];

  if (!fallback) {
    throw new Error('THEMES must contain at least one theme.');
  }

  return fallback;
}

const DEFAULT_THEME: ThemeDefinition = requireDefaultTheme();

export function getTheme(themeId: string): ThemeDefinition {
  return THEMES.find((theme) => theme.id === themeId) ?? DEFAULT_THEME;
}
