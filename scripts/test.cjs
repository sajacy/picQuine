'use strict';
const {execFileSync} = require('node:child_process');
const {readdirSync, readFileSync} = require('node:fs');
const {resolve} = require('node:path');
process.chdir(resolve(__dirname, '../src'));
const runtime = [
  ...readFileSync('index.html', 'utf8').matchAll(/<script src="([^"]+)"/g),
].map((match) => match[1]);
for (const path of runtime) {
  execFileSync(process.execPath, ['--check', path], {stdio: 'inherit'});
}
for (const test of readdirSync('../tests')
    .filter((path) => path.endsWith('.test.cjs'))
    .sort()) {
  execFileSync(process.execPath, [`../tests/${test}`], {stdio: 'inherit'});
}
console.log(
    `PASS: ${runtime.length} runtime syntax checks and all test suites`,
);
