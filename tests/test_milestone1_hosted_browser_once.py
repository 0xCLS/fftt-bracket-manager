"""No-network source and safety-gate tests for the M1 browser operator."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

import milestone1_hosted_browser_once as runner

class TestOneTimeBrowserOperator(unittest.TestCase):
 def test_default_dry_run_has_no_auth_marker_or_browser(self):
  with patch.object(runner.sys,"argv",["milestone1_hosted_browser_once.py"]),\
       patch.object(runner.auth,"exchange_link",side_effect=AssertionError("auth should not run")) as auth,\
       patch.object(runner,"guarded_incident_marker",side_effect=AssertionError("no marker")):
   with contextlib.redirect_stdout(io.StringIO()) as text:
    runner.main()
   self.assertIn("DRY RUN: no Auth calls",text.getvalue())
   self.assertEqual(auth.call_count,0)

 def test_only_pinned_new_fixture_accepted(self):
  good=str(uuid.uuid4())
  with self.assertRaisesRegex(runner.Stop,"NOT the approved"):
   runner.pin(good,runner.EVENT_DIGEST)
  with self.assertRaisesRegex(runner.Stop,"invalid"):
   runner.pin("not-a-uuid",runner.MATCH_DIGEST)
  self.assertNotEqual(runner.EVENT_DIGEST,runner.MATCH_DIGEST)
  self.assertIn("fictional hosted fixture #3",runner.__doc__)

 def test_private_incident_record_is_exclusive_0600_and_no_credentials(self):
  with tempfile.TemporaryDirectory() as td:
   dest=Path(td)/"fftt-marker.json"
   ids={"SCOREKEEPER_A":str(uuid.uuid4()),
        "SCOREKEEPER_B":str(uuid.uuid4())}
   with patch.object(runner,"saved_marker",return_value=dest):
    with contextlib.redirect_stdout(io.StringIO()):
     runner.guarded_incident_marker(ids)
    self.assertEqual(dest.stat().st_mode&0o777,0o600)
    raw=dest.read_text()
    self.assertNotIn("sb_secret_",raw)
    self.assertNotIn("access_token",raw)
    self.assertNotIn("Bearer ",raw)
    data=json.loads(raw)
    self.assertEqual(data["private_submissions"],ids)
    with self.assertRaisesRegex(runner.Stop,"already exists"):
     runner.guarded_incident_marker(ids)
    self.assertEqual(data,json.loads(dest.read_text()))

 def test_incomplete_and_duplicate_ids_refuse_marker(self):
  with tempfile.TemporaryDirectory() as td:
   dest=Path(td)/"fftt-marker.json"
   same=str(uuid.uuid4())
   with patch.object(runner,"saved_marker",return_value=dest):
    for ids in [{"SCOREKEEPER_A":same},
                {"SCOREKEEPER_A":same,"SCOREKEEPER_B":same},
                {"SCOREKEEPER_A":"not-uuid","SCOREKEEPER_B":str(uuid.uuid4())}]:
     with self.assertRaises(runner.Stop):
      runner.guarded_incident_marker(ids)
     self.assertFalse(dest.exists())

 def test_only_new_fixture_and_two_browser_score_routes_are_defined(self):
  from inspect import getsource
  s=getsource(runner)
  self.assertIn('APP_RELATIVE="/rehearsals/c8/index.html"',s)
  self.assertIn("one-time",s.lower())
  self.assertIn('SCORE_RPC="/rest/v1/rpc/fftt_submit_match_result_v2"',s)
  self.assertNotIn("sb_secret_lup",s)
  self.assertNotIn("CREATE USER",s)
  self.assertNotIn("INSERT INTO",s)
  self.assertNotIn("supabase migration",s.lower())

if __name__=="__main__":unittest.main()
