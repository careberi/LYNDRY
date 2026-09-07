// A ONE-OFF AUDIT CONFIG. Not part of the build and not a dependency.
//
// It exists because a real bug shipped that a linter would have caught in a
// second: a `const` was read three lines above where it was declared, which
// JavaScript allows you to write and then throws on at runtime. It only fired
// when there was an issue to close, so it charged a customer's card and THEN
// returned {"error":"internal_error"}.
//
// To run it, install eslint just for the run and throw it away after:
//
//   npm install --no-save eslint
//   npx eslint --config eslint.audit.config.mjs src scripts
//
// Everything in here is a rule about code that cannot work, never a rule about
// style - this codebase has a house style and it is not eslint's business.
//
// EXPECTED HITS, both harmless: booking.js and partners.js each reference a
// module-level const inside a function defined above it. The module finishes
// loading before anything calls them, so the value is always there. Anything
// NEW in that list is worth reading properly.

export default [
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', process: 'readonly',
                 console: 'readonly', __dirname: 'readonly', Buffer: 'readonly',
                 fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly',
                 clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
                 URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly',
                 crypto: 'readonly', structuredClone: 'readonly' },
    },
    rules: {
      // THE BUG THAT CHARGED A CARD AND THEN 500'd.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': 'error',
      'getter-return': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-dupe-else-if': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'require-atomic-updates': 'off',
    },
  },
];
