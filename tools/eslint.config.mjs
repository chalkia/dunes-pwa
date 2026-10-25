// Φύλακας «ανύπαρκτες μεταβλητές»: no-undef σε όλα τα αρχεία της εφαρμογής.
// Οι καθολικές «L» (Leaflet) και «JSZip» φορτώνονται από τα lib/ με κλασικά <script>.
import globals from 'globals';

const common = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none' }],
  'no-empty': 'error',
  'no-redeclare': 'error',
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
};

export default [
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, L: 'readonly', JSZip: 'readonly' },
    },
    rules: common,
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.serviceworker } },
    rules: common,
  },
];
