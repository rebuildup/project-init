#!/usr/bin/env -S bun
import { runControls } from '../shared/controls.mts';

process.exitCode = runControls(import.meta.dirname, 'grade.mts', [
  ['negative control', 'fixtures/negative.txt', 'FAIL'],
  ['regression control', 'fixtures/regression.txt', 'FAIL'],
  ['positive control', 'fixtures/positive.txt', 'PASS'],
]);
