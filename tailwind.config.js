/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/**/*.{html,js,ejs}',
    './public/**/*.{html,js}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#2563eb',
        background: '#f8f9fa',
        text: '#374151',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
  // Optimize for production
  future: {
    removeDeprecatedGapUtilities: true,
    purgeLayersByDefault: true,
  },
  // Disable features we're not using to improve build time
  corePlugins: {
    // Disable any unused features
    container: false,
    objectFit: false,
    objectPosition: false,
  },
  // Enable JIT mode for faster builds
  mode: 'jit',
}