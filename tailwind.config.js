/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f0f',
          secondary: '#1a1a1a',
          tertiary: '#252525',
          hover: '#2a2a2a'
        },
        accent: {
          DEFAULT: '#f59e0b',
          hover: '#d97706',
          muted: 'rgba(245, 158, 11, 0.15)'
        },
        text: {
          primary: '#f5f5f5',
          secondary: '#a3a3a3',
          muted: '#737373'
        }
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
