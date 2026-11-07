import test from 'node:test';
import assert from 'node:assert/strict';
import {pickEvent, isShowcase, SHOWCASE_EVENT_ID} from '../app/public_core.mjs';
const demo = {id: SHOWCASE_EVENT_ID, status:'active', updatedAt:'2026-12-01T00:00:00Z'};
const real = {id:'real-public', status:'complete', updatedAt:'2026-01-01T00:00:00Z'};
test('default selection prefers a published real event even over a newer active demo', () => {
  assert.equal(pickEvent([demo,real]).id, real.id);
  assert.equal(pickEvent([real,demo],demo.id).id, demo.id);
  assert.equal(pickEvent([real,demo],real.id).id, real.id);
  assert.equal(pickEvent([demo]).id, demo.id);
  assert.equal(pickEvent([],demo.id),null);
  assert.equal(isShowcase(demo),true); assert.equal(isShowcase(real),false);
});
test('normal real event ordering is preserved and unknown links cannot promote demo', () => {
  const active = {...real,id:'active',status:'active'};
  assert.equal(pickEvent([demo,real,active],'unknown'),null);
  assert.equal(pickEvent([demo],'unpublished-real'),null);
  assert.equal(pickEvent([real,active]).id,'active');
});

test('homepage offers a separate explicit fictional demo without changing registration', async () => {
  const {readFile} = await import('node:fs/promises');
  const html = await readFile(new URL('../public-site/index.html', import.meta.url),'utf8');
  assert.match(html, /href="https:\/\/fftt-games\.clslifestyle\.com\/app\/spectator\?e=9c25613c-6543-4d6c-84cf-97ba49017509"[^>]*>View Demo Tournament/);
  assert.match(html, /href="https:\/\/forms\.gle\/tZ9dizzfecyhHUxw8"/);
  assert.match(html, /href="https:\/\/fftt-games\.clslifestyle\.com\/app\/spectator"/);
});
