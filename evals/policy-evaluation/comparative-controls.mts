#!/usr/bin/env -S bun
import { runControls } from '../shared/controls.mts';

process.exitCode = runControls(import.meta.dirname, '../shared/record-grader.mts', [
  ['comparative negative control', 'fixtures/comparative-negative.txt', 'FAIL'],
  ['comparative regression control', 'fixtures/comparative-regression.txt', 'FAIL'],
  ['comparative positive control', 'fixtures/comparative-positive.txt', 'PASS'],
], 'EVAL', ['comparative-grade']);
