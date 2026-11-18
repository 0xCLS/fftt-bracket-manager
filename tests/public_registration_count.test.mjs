import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalName,countUniqueRegistrations,localVerifiedDate} from '../tools/ops/update_public_registration_count.mjs';
const header=['Timestamp','Full Name'];
test('dedupes full names and ignores blanks',()=>assert.equal(countUniqueRegistrations([header,['1',' Ada  Smith '],['2','ada smith'],['3','Bea Jones'],['','']]),2));
test('uses approved aliases without exposing names to the public output',()=>{
  assert.equal(canonicalName('Michael A Smith'),canonicalName('Michael Smith'));
  assert.equal(canonicalName("Ki’re Eder"),canonicalName('KiRe Eder'));
  assert.equal(canonicalName('Machai Brown'),canonicalName('Mekhai Brown'));
});
test('fails closed for bad header or empty roster',()=>{
  assert.throws(()=>countUniqueRegistrations([['Email','Full Name'],['x','Ada']]),/headings/);
  assert.throws(()=>countUniqueRegistrations([header,['','']]),/safe bounds/);
});
test('verification date uses Detroit-local calendar',()=>assert.equal(localVerifiedDate(new Date('2026-11-17T04:15:00Z')),'2026-11-16'));
