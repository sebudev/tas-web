/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // design system tas-web (CSS variables — otomatis ikut tema dark/light)
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        card: 'var(--card)',
        line: 'var(--border)',
        txt: { DEFAULT: 'var(--text)', dim: 'var(--text-dim)' },
        accent: { DEFAULT: 'var(--accent)', two: 'var(--accent-2)' },
      },
      borderRadius: { xl2: '14px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
