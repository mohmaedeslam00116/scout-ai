import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scoutPaths } from '../src/main/paths.ts';

describe('scoutPaths', () => {
  const p = scoutPaths('C:\\userdata');

  it('roots everything under userData', () => {
    assert.equal(p.dataRoot, 'C:\\userdata');
    assert.equal(p.agentDir, 'C:\\userdata\\agent');
  });

  it('keeps the registry inside the projects dir (first-run flag = absence)', () => {
    assert.equal(p.registryFile, 'C:\\userdata\\projects\\registry.json');
  });

  it('lays out a project directory per ADR-0003 + decision #16', () => {
    assert.equal(p.projectDir('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34');
    assert.equal(p.projectFile('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34\\project.json');
    assert.equal(p.projectSessions('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34\\sessions');
    assert.equal(p.projectArtifacts('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34\\artifacts');
    assert.equal(p.projectRuns('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34\\runs');
    assert.equal(p.projectHome('p_ab12cd34'), 'C:\\userdata\\projects\\p_ab12cd34\\home');
  });

  it('mirrors the same layout for scratch at the root', () => {
    assert.equal(p.scratchDir, 'C:\\userdata\\scratch');
    assert.equal(p.scratchSessions, 'C:\\userdata\\scratch\\sessions');
    assert.equal(p.scratchArtifacts, 'C:\\userdata\\scratch\\artifacts');
    assert.equal(p.scratchRuns, 'C:\\userdata\\scratch\\runs');
    assert.equal(p.scratchHome, 'C:\\userdata\\scratch\\home');
  });

  it('effective cwd = first bound folder, else the project home', () => {
    assert.equal(p.effectiveCwd('p_x', []), 'C:\\userdata\\projects\\p_x\\home');
    assert.equal(p.effectiveCwd('p_x', ['D:\\research\\feeds', 'D:\\more']), 'D:\\research\\feeds');
  });
});
