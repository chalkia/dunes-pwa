// Φύλακας «ανύπαρκτες μεταβλητές»: no-undef σε όλα τα αρχεία της εφαρμογής.
// Οι καθολικές «L», «JSZip», «qrcode», «jsQR» φορτώνονται από τα lib/ με κλασικά <script>.
// Ο φύλακας tools/check_all.mjs ελέγχει ότι κάθε τέτοιο αρχείο υπάρχει στο index.html και στο SHELL.
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
      globals: {
        ...globals.browser, L: 'readonly', JSZip: 'readonly', qrcode: 'readonly', jsQR: 'readonly',
      },
    },
    rules: common,
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.serviceworker } },
    rules: common,
  },
];
