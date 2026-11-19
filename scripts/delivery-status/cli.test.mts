import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, redact, matchesReleasePr, paginate } from './delivery-status.mts';
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

test('pagination returns a complete, ordered multi-page inventory', () => {
  const seen: (string | null)[] = [];
  const pages = new Map<string, {nodes:number[];pageInfo:{hasNextPage:boolean;endCursor:string|null}}>([
    ['start',{nodes:[1,2],pageInfo:{hasNextPage:true,endCursor:'p1'}}],
    ['p1',{nodes:[3],pageInfo:{hasNextPage:true,endCursor:'p2'}}],
    ['p2',{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}],
  ]);
  const values=paginate<number>(after=>{
    seen.push(after);
    const page=pages.get(after??'start');
    if(!page)throw Error('unexpected cursor');
    return page;
  });
  assert.deepEqual(values,[1,2,3]);
  assert.deepEqual(seen,[null,'p1','p2']);
});
test('pagination rejects missing and repeated next-page cursors', () => {
  for(const bad of [null,'']){
    assert.throws(()=>paginate(()=>({nodes:[1],pageInfo:{hasNextPage:true,endCursor:bad}})),
      /incomplete GraphQL pagination/);
  }
  let n=0;
  assert.throws(()=>paginate(()=>{
    n++;
    return {nodes:[n],pageInfo:{hasNextPage:true,endCursor:'same'}};
  }),/incomplete GraphQL pagination/);
  assert.equal(n,2);
});
test('pagination rejects malformed pages, not just explicit failures', () => {
  assert.throws(()=>paginate<number>(()=>({
    nodes:[],pageInfo:null as unknown as {hasNextPage:boolean;endCursor:string|null},
  })),/invalid GraphQL pagination response/);
  assert.throws(()=>paginate<number>(()=>({
    nodes:null as unknown as number[],pageInfo:{hasNextPage:false,endCursor:null},
  })),/invalid GraphQL pagination response/);
});
test('pagination accepts a legitimately empty final page', () => {
  assert.deepEqual(paginate<number>(()=>({
    nodes:[],pageInfo:{hasNextPage:false,endCursor:null},
  })),[]);
});
