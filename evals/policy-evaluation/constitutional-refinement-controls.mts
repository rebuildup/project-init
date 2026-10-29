#!/usr/bin/env -S bun
import { runControls } from '../shared/controls.mts';

process.exitCode = runControls(import.meta.dirname, 'constitutional-refinement-grade.mts', [
  ['constitutional negative', 'fixtures/constitutional-refinement-negative.txt', 'FAIL'],
  ['constitutional regression', 'fixtures/constitutional-refinement-regression.txt', 'FAIL'],
  ['constitutional positive', 'fixtures/constitutional-refinement-positive.txt', 'PASS'],
]);
