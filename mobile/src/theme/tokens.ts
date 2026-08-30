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
  50: [244, 247, 245],
  100: [233, 238, 236],
  200: [214, 222, 219],
  300: [180, 191, 187],
  400: [138, 152, 148],
  500: [102, 116, 112],
  600: [77, 91, 87],
  700: [58, 71, 67],
  800: [37, 47, 45],
  900: [22, 30, 28],
  950: [12, 18, 17],
} as const;

/** Inverted, but hand-set rather than mirrored, so hierarchy survives. */
const darkInk = {
  50: [18, 26, 24],
  100: [27, 37, 34],
  200: [38, 51, 47],
  300: [58, 74, 69],
  400: [92, 111, 105],
  500: [132, 150, 144],
  600: [165, 180, 175],
  700: [196, 208, 204],
  800: [220, 229, 226],
  900: [238, 244, 242],
  950: [247, 250, 249],
} as const;

const lightJade = {
  50: [232, 244, 240],
  100: [200, 231, 221],
  200: [148, 210, 192],
  300: [94, 185, 161],
  400: [47, 155, 128],
  500: [30, 122, 100],
  600: [23, 95, 79],
  700: [18, 76, 63],
  800: [14, 61, 51],
  900: [11, 48, 40],
} as const;

const darkJade = {
  50: [15, 41, 35],
  100: [18, 56, 47],
  200: [22, 82, 68],
  300: [34, 116, 96],
  400: [58, 155, 130],
  500: [92, 194, 165],
  600: [130, 214, 190],
  700: [168, 230, 212],
  800: [200, 240, 228],
  900: [224, 248, 241],
} as const;

// ---------------------------------------------------------------- tier 2 --
// Semantic tokens. Screens only ever read these.

export interface Theme {
  readonly dark: boolean;
  readonly ink: Record<keyof typeof lightInk, Channels>;
  readonly jade: Record<keyof typeof lightJade, Channels>;

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
  jade: lightJade,

  canvas: lightInk[50],
  surface: [253, 254, 253],
  surfaceRaised: [255, 255, 255],
  surfaceSunken: [238, 243, 241],
  border: lightInk[200],
  borderStrong: lightInk[300],

  brand: lightJade[500],
  brandStrong: lightJade[600],
  brandSoft: lightJade[50],
  brandFg: [255, 255, 255],
  focus: lightJade[400],

  positiveFg: [21, 94, 76],
  positiveBg: [226, 243, 237],
  cautionFg: [124, 74, 12],
  cautionBg: [250, 240, 222],
  criticalFg: [154, 44, 38],
  criticalBg: [251, 232, 230],

  // Tinted to the ground rather than pure black: a black shadow on a
  // green-grey canvas reads as a hole punched in the page.
  shadowColor: [22, 30, 28],
  scrim: [8, 12, 11],
};

export const darkTheme: Theme = {
  dark: true,
  ink: darkInk,
  jade: darkJade,

  canvas: [10, 15, 14],
  surface: [18, 25, 23],
  surfaceRaised: [24, 34, 31],
  surfaceSunken: [13, 19, 18],
  border: [35, 46, 43],
  borderStrong: [52, 66, 62],

  brand: darkJade[500],
  brandStrong: darkJade[600],
  brandSoft: darkJade[100],
  brandFg: [8, 14, 12],
  focus: darkJade[400],

  positiveFg: [126, 214, 186],
  positiveBg: [17, 48, 40],
  cautionFg: [226, 186, 116],
  cautionBg: [54, 41, 18],
  criticalFg: [246, 165, 158],
  criticalBg: [60, 26, 24],

  shadowColor: [0, 0, 0],
  scrim: [8, 12, 11],
};

/** Inputs and chips, buttons, cards. The same 8/12/16 scale the web app uses. */
export const radius = { sm: 8, md: 12, lg: 16 } as const;

/**
 * The spacing step. Four points, like Tailwind's, so a gap named here and a gap
 * named in the web app describe the same distance.
 */
export const space = (steps: number): number => steps * 4;
