#!/usr/bin/env node
'use strict';

require('../lib/app.js')
  .main(process.argv.slice(2))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
