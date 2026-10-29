#!/usr/bin/env -S bun
import { runControls } from '../shared/controls.mts';

process.exitCode = runControls(import.meta.dirname, 'grade.mts', [
  ['linear release positive control', 'fixtures/positive.txt', 'PASS'],
  ['linear release negative control', 'fixtures/negative.txt', 'FAIL'],
  ['linear release regression control', 'fixtures/regression.txt', 'FAIL'],
], 'PLAIN');
