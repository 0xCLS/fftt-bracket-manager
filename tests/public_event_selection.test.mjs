import test from 'node:test';
import assert from 'node:assert/strict';
import {pickEvent} from '../app/public_core.mjs';
test('public selection honors explicit IDs and ranks active events without modifying data', () => {
  const old={id:'old',status:'complete',updatedAt:'2026-01-01'}, active={id:'active',status:'active',updatedAt:'2026-02-01'};
  const events=[old,active];
  assert.equal(pickEvent(events,'old'),old);
  assert.equal(pickEvent(events),active);
  assert.deepEqual(events,[old,active]);
});
