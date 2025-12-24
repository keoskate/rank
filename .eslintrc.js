module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier', // Must be last to override other configs
  ],
  plugins: ['react', 'react-hooks', 'react-compiler', 'prettier'],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // React rules
    'react/prop-types': 'off', // Turn off prop-types since we're not using them
    'react/react-in-jsx-scope': 'off', // Not needed in React 17+
    'react/jsx-uses-react': 'off', // Not needed in React 17+
    'react/jsx-uses-vars': 'error',

    // React Hooks rules
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Compiler rules
    'react-compiler/react-compiler': 'error',

    // General JavaScript rules
    'no-unused-vars': [
      'warn',
      {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    'no-console': 'off', // Allow console for this project
    'no-debugger': 'warn',
    'no-undef': 'error',
    'prefer-const': 'warn',
    'no-var': 'error',

    // Prettier integration
    'prettier/prettier': 'error',
  },
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      alias: {
        map: [
          ['@', './react-client/src'],
          ['@components', './react-client/src/Components'],
          ['@common', './react-client/src/Components/common'],
          ['@pages', './react-client/src/Components/pages'],
          ['@charts', './react-client/src/Components/charts'],
          ['@trading', './react-client/src/Components/trading'],
          ['@simulator', './react-client/src/Components/simulator'],
          ['@contexts', './react-client/src/contexts'],
          ['@hooks', './react-client/src/hooks'],
          ['@utils', './react-client/src/utils'],
          ['@config', './react-client/src/config'],
          ['@mvp', './react-client/src/mvp'],
        ],
        extensions: ['.js', '.jsx', '.json'],
      },
    },
  },
  ignorePatterns: [
    'node_modules/',
    'build/',
    'dist/',
    'bundle.js',
    '*.min.js',
    '.eslintcache',
  ],
};
