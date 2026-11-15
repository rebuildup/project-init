import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, redact, matchesReleasePr } from './delivery-status.mts';
test('missing or option-looking --repo value is argument error', () => {
  assert.throws(() => parseArgs(['--repo']), /requires owner\/name/);
  assert.throws(() => parseArgs(['--repo', '--json']), /requires owner\/name/);
  assert.deepEqual(parseArgs(['--repo','owner/repo','--json']).repos, ['owner/repo']);
});
test('both report formats mask token-shaped PR titles/check names', () => {
  const token = 'ghp_' + 'A'.repeat(30);
  assert.equal(redact('PR title: '+ token), 'PR title: [REDACTED]');
  assert.equal(redact(JSON.stringify({check:token})), JSON.stringify({check:'[REDACTED]'}));
});
test('fork PR with same branch name is not local release PR', () => {
  const pr = {headRefName:'release-0-9-0',baseRefName:'main',isCrossRepository:true};
  assert.equal(matchesReleasePr(pr,'release-0-9-0','main'),false);
  assert.equal(matchesReleasePr({...pr,isCrossRepository:false},'release-0-9-0','main'),true);
});
