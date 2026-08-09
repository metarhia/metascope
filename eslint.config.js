'use strict';

const init = require('eslint-config-metarhia');

module.exports = [
  ...init,
  {
    ignores: ['test/fixtures/**'],
  },
  {
    rules: {
      quotes: [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: true },
      ],
    },
  },
];
