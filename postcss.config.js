const path = require('path');

module.exports = {
  plugins: {
    'tailwindcss': {
      config: path.resolve(__dirname, 'tailwind.config.js')
    },
    'autoprefixer': {},
    ...(process.env.NODE_ENV === 'production'
      ? {
          'cssnano': {
            preset: ['default', {
              discardComments: {
                removeAll: true,
              },
              normalizeWhitespace: false,
              minifyFontValues: {
                removeQuotes: false
              }
            }],
          },
          '@fullhuman/postcss-purgecss': {
            content: [
              './views/**/*.{html,js,ejs}',
              './public/**/*.{html,js}'
            ],
            defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || []
          }
        }
      : {}),
  },
}