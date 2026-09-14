import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoutPaths } from '../src/main/paths.ts';

test('scoutPaths lays out agentDir, projects and registry under the data root', () => {
  const p = scoutPaths('C:\\Users\\Dell\\AppData\\Roaming\\scout-ai');

  assert.equal(p.agentDir, 'C:\\Users\\Dell\\AppData\\Roaming\\scout-ai\\agent');
  assert.equal(p.registryFile, 'C:\\Users\\Dell\\AppData\\Roaming\\scout-ai\\registry.json');
  assert.ok(p.projectFile('p1').endsWith('projects\\p1\\project.json'));
});

test('effectiveCwd prefers the first bound folder, else the project home', () => {
  const p = scoutPaths('/data');

  assert.equal(p.effectiveCwd('p1', ['D:\\research']), 'D:\\research');
  assert.ok(p.effectiveCwd('p1', []).endsWith('projects\\p1\\home') || p.effectiveCwd('p1', []).endsWith('projects/p1/home'));
});
