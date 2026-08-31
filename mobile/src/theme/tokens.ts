/**
 * The WOW palette, ported from the web app's index.css.
 *
 * Same three tiers, same names, same values — deliberately, because two
 * products that share a brand and disagree about what "brand" means is the
 * failure this is meant to avoid. When a colour changes it changes in both
 * files, and the names matching is what makes that a mechanical job rather
 * than an archaeological one.
 *
 * Colours are RGB triples rather than hex strings for the reason index.css
 * stores channels rather than hex: half the design needs a colour at partial
 * opacity — scrims over photographs, pressed states, translucent headers — and
 * a hex string cannot be composed with an alpha without string surgery at the
 * call site. `rgba(token, 0.55)` reads as what it is.
 */

export type Channels = readonly [number, number, number];

export const rgb = (c: Channels): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export const rgba = (c: Channels, alpha: number): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

// ---------------------------------------------------------------- tier 1 --
// Primitives. Named for what they are, never for where they are used.

const lightInk = {
  50: [250, 247, 249],
  100: [243, 238, 241],
  200: [230, 222, 227],
  300: [202, 190, 197],
  400: [158, 144, 152],
  500: [120, 107, 115],
  600: [92, 81, 88],
  700: [70, 61, 67],
  800: [47, 40, 45],
  900: [29, 24, 28],
  950: [18, 14, 17],
} as const;

/** Inverted, but hand-set rather than mirrored, so hierarchy survives. */
const darkInk = {
  50: [28, 22, 26],
  100: [38, 30, 35],
  200: [52, 43, 49],
  300: [76, 64, 72],
  400: [112, 98, 107],
  500: [150, 136, 145],
  600: [180, 168, 175],
  700: [208, 198, 204],
  800: [228, 221, 225],
  900: [243, 238, 241],
  950: [250, 247, 249],
} as const;

/**
 * Rose. Asked for by name in the brief, with an example that is a deep magenta
 * rather than a pastel — the right instinct, because a pale pink cannot carry a
 * button and an interface built from it has nothing to point with. The pale end
 * does the surfaces; the deep end does the work.
 */
const lightRose = {
  50: [253, 242, 246],
  100: [251, 228, 237],
  200: [246, 194, 214],
  300: [238, 151, 184],
  400: [226, 96, 145],
  500: [196, 30, 99],
  600: [163, 22, 79],
  700: [134, 18, 64],
  800: [108, 15, 52],
  900: [84, 12, 41],
} as const;

const darkRose = {
  50: [46, 16, 29],
  100: [61, 20, 37],
  200: [84, 26, 50],
  300: [116, 35, 68],
  400: [168, 55, 102],
  500: [232, 105, 158],
  600: [242, 141, 184],
  700: [247, 175, 205],
  800: [250, 205, 224],
  900: [252, 228, 238],
} as const;

// ---------------------------------------------------------------- tier 2 --
// Semantic tokens. Screens only ever read these.

export interface Theme {
  readonly dark: boolean;
  readonly ink: Record<keyof typeof lightInk, Channels>;
  readonly rose: Record<keyof typeof lightRose, Channels>;

  readonly canvas: Channels;
  readonly surface: Channels;
  readonly surfaceRaised: Channels;
  readonly surfaceSunken: Channels;
  readonly border: Channels;
  readonly borderStrong: Channels;

  readonly brand: Channels;
  readonly brandStrong: Channels;
  readonly brandSoft: Channels;
  /** What sits ON the accent: white on light, near-black on dark, because the
   *  accent lifts in dark mode and white on it fails contrast. */
  readonly brandFg: Channels;
  readonly focus: Channels;

  readonly positiveFg: Channels;
  readonly positiveBg: Channels;
  readonly cautionFg: Channels;
  readonly cautionBg: Channels;
  readonly criticalFg: Channels;
  readonly criticalBg: Channels;

  readonly shadowColor: Channels;
  /**
   * The one colour that does not invert.
   *
   * A scrim exists to keep white text legible over a photograph. Everything
   * else here flips between themes, which is right for anything sitting on the
   * page and exactly wrong for anything sitting on an image: invert the scrim
   * and the dark overlay becomes a light one, taking the caption with it.
   */
  readonly scrim: Channels;
}

export const lightTheme: Theme = {
  dark: false,
  ink: lightInk,
  rose: lightRose,

  canvas: [253, 247, 250],
  surface: [255, 253, 254],
  surfaceRaised: [255, 255, 255],
  surfaceSunken: [250, 240, 245],
  border: lightInk[200],
  borderStrong: lightInk[300],

  brand: lightRose[500],
  brandStrong: lightRose[600],
  brandSoft: lightRose[50],
  brandFg: [255, 255, 255],
  focus: lightRose[400],

  positiveFg: [21, 94, 76],
  positiveBg: [226, 243, 237],
  cautionFg: [124, 74, 12],
  cautionBg: [250, 240, 222],
  criticalFg: [176, 42, 28],
  criticalBg: [253, 232, 228],

  // Tinted to the ground rather than pure black: a black shadow on a
  // pink-white canvas reads as a hole punched in the page.
  shadowColor: [42, 22, 32],
  scrim: [14, 8, 11],
};

export const darkTheme: Theme = {
  dark: true,
  ink: darkInk,
  rose: darkRose,

  canvas: [18, 12, 16],
  surface: [28, 20, 25],
  surfaceRaised: [36, 26, 32],
  surfaceSunken: [22, 15, 19],
  border: [48, 37, 44],
  borderStrong: [68, 54, 62],

  brand: darkRose[500],
  brandStrong: darkRose[600],
  brandSoft: darkRose[100],
  brandFg: [24, 8, 15],
  focus: darkRose[400],

  positiveFg: [126, 214, 186],
  positiveBg: [17, 48, 40],
  cautionFg: [226, 186, 116],
  cautionBg: [54, 41, 18],
  criticalFg: [250, 160, 146],
  criticalBg: [64, 26, 22],

  shadowColor: [0, 0, 0],
  scrim: [14, 8, 11],
};

/** Inputs and chips, buttons, cards. The same 8/12/16 scale the web app uses. */
export const radius = { sm: 8, md: 12, lg: 16 } as const;

/**
 * The spacing step. Four points, like Tailwind's, so a gap named here and a gap
 * named in the web app describe the same distance.
 */
export const space = (steps: number): number => steps * 4;
