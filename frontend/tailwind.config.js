/** @type {import('tailwindcss').Config} */

/**
 * Every colour resolves to a CSS variable rather than a hex value.
 *
 * That indirection is what makes the dark theme a variable swap instead of a
 * rewrite. The application already contains around a thousand `gray-*`
 * utilities and two hundred `brand-*` ones written before any of this existed;
 * pointing those scales at variables means all of them theme correctly without
 * a single page being touched.
 *
 * The `<alpha-value>` slot matters: it is what keeps `bg-gray-900/60` and
 * `ring-brand/12` working. A variable holding a hex string would break every
 * translucent surface in the app.
 */
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const ramp = (prefix) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
      .filter((step) => step !== 950 || prefix === 'ink')
      .map((step) => [step, channel(`${prefix}-${step}`)]),
  );

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Class-based rather than media-based: the app carries an explicit
  // light / dark / system control, and `system` is implemented by writing the
  // resolved class onto <html>. Media-only would make the toggle a lie.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The neutral scale the whole application already speaks in.
        gray: ramp('ink'),
        ink: ramp('ink'),

        brand: {
          ...ramp('jade'),
          DEFAULT: channel('brand'),
          strong: channel('brand-strong'),
          soft: channel('brand-soft'),
          // What sits on top of the accent. White on light-mode jade, near
          // black on the lifted dark-mode jade, because white would fail
          // contrast there.
          fg: channel('brand-fg'),
          // Retained so pre-existing markup keeps working while it is swept.
          dark: channel('brand-strong'),
          light: channel('brand-soft'),
        },

        canvas: channel('canvas'),
        // Deliberately outside the themed ramp: see --scrim in index.css.
        scrim: channel('scrim'),
        surface: {
          DEFAULT: channel('surface'),
          raised: channel('surface-raised'),
          sunken: channel('surface-sunken'),
        },

        /*
         * Semantic families, mapped onto the names the codebase already uses.
         * Roughly a hundred and fifty `red-*`, `emerald-*` and `amber-*`
         * utilities were written across the app for errors, confirmations and
         * warnings; pointing those at semantic tokens themes them all rather
         * than leaving a light-mode alert glowing on a dark page.
         */
        positive: { fg: channel('positive-fg'), bg: channel('positive-bg') },
        caution: { fg: channel('caution-fg'), bg: channel('caution-bg') },
        critical: { fg: channel('critical-fg'), bg: channel('critical-bg') },

        red: {
          50: channel('critical-bg'),
          100: channel('critical-bg'),
          600: channel('critical-fg'),
          700: channel('critical-fg'),
          800: channel('critical-fg'),
          900: channel('critical-fg'),
        },
        emerald: {
          50: channel('positive-bg'),
          100: channel('positive-bg'),
          600: channel('positive-fg'),
          700: channel('positive-fg'),
          800: channel('positive-fg'),
          900: channel('positive-fg'),
        },
        green: {
          50: channel('positive-bg'),
          100: channel('positive-bg'),
          600: channel('positive-fg'),
          700: channel('positive-fg'),
          800: channel('positive-fg'),
        },
        amber: {
          50: channel('caution-bg'),
          100: channel('caution-bg'),
          200: channel('caution-bg'),
          600: channel('caution-fg'),
          700: channel('caution-fg'),
          800: channel('caution-fg'),
          900: channel('caution-fg'),
        },
        blue: {
          50: channel('brand-soft'),
          800: channel('brand-strong'),
        },
      },

      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'calc(var(--radius-lg) + 0.25rem)',
      },

      /*
       * Shadows tinted to the page rather than to black, and kept shallow.
       * Deep drop shadows are how a light interface announces that it was
       * designed in 2014.
       */
      boxShadow: {
        btn: '0 1px 2px 0 rgb(var(--shadow-color) / 0.14)',
        card: '0 1px 2px -1px rgb(var(--shadow-color) / 0.08), 0 2px 8px -2px rgb(var(--shadow-color) / 0.06)',
        lifted:
          '0 2px 4px -2px rgb(var(--shadow-color) / 0.10), 0 12px 28px -8px rgb(var(--shadow-color) / 0.14)',
        pop: '0 8px 40px -12px rgb(var(--shadow-color) / 0.28)',
      },

      fontFamily: {
        sans: ['Geist Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'ui-monospace', 'monospace'],
      },

      // A real scale rather than Tailwind's defaults at display sizes: the
      // large steps get tighter tracking and shorter leading, which is what
      // makes a headline read as one object instead of a stack of lines.
      fontSize: {
        display: ['clamp(2.25rem, 1.6rem + 2.6vw, 3.5rem)', { lineHeight: '1.04', letterSpacing: '-0.032em' }],
        hero: ['clamp(1.75rem, 1.3rem + 1.8vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.028em' }],
      },

      transitionTimingFunction: {
        // The one easing curve in the app. Fast out, settled in.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      opacity: { 12: '0.12' },

      maxWidth: { content: '1400px' },
    },
  },
  plugins: [],
};
