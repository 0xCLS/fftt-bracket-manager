"""Routing is fail-closed for ambiguous history and protected changes."""
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ci_impact', ROOT / 'tools' / 'ci_impact.py')
impact = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(impact)
BASE, BEFORE, HEAD, MERGE = ('a'*40, 'b'*40, 'c'*40, 'd'*40)

def route(files, patches=None, event='pull_request', action='opened', before=BEFORE, after=HEAD, base=BASE, head=HEAD, ancestor=True, checkout=None, prefix_same=True, sources=None, pinned_blob=impact.TV_EVIDENCE_BLOB):
    patches=patches or {}; checkout=checkout or (after if event == 'push' else head)
    def fake(*args):
        if args[0]=='cat-file': return ''
        if args[:2]==('rev-parse','HEAD'): return checkout
        if args[0]=='rev-parse': return pinned_blob
        if args[:2]==('merge-base','--is-ancestor'):
            if not ancestor: raise subprocess.CalledProcessError(1,args)
            return ''
        if args[0]=='merge-base': return MERGE
        if args[0]=='show':
            ref, path = args[1].split(':', 1)
            if sources and path in sources:
                return sources[path][1 if ref == head else 0]
            return ('prefix' if prefix_same or args[1].startswith(MERGE) else 'changed')+'export function pickEvent(events, wanted) { return null; }'
        if args[0]=='diff' and '--name-only' in args: return '\n'.join(files)
        if args[0]=='diff' and '--unified=0' in args: return patches.get(args[-1],'+ color: red;')
        raise AssertionError(args)
    with patch.object(impact,'git',side_effect=fake):
        return impact.classify(event,action,before,after,base,head)[0]

class ImpactTests(unittest.TestCase):
    def test_new_and_updated_visual_pr(self):
        self.assertEqual(route(['app/app.css']),'ui-visual')
        self.assertEqual(route(['app/app.css'],action='synchronize'),'ui-visual')
    def test_public_and_organizer(self):
        self.assertEqual(route(['app/tv.mjs'],{'app/tv.mjs':'+ h("span", {text: "Welcome"})'}, sources={'app/tv.mjs': (TV_OLD, TV_NEW)}),'public-ui')
        self.assertEqual(route(['app/tv.css']),'public-ui')
        self.assertEqual(route(['app/assets/emblem.webp']),'ui-visual')
        self.assertEqual(route(['app/view_players.mjs'],{'app/view_players.mjs':'+ h("span", {text: "Players"})'}),'organizer-ui')
    def test_selection_only_and_feed_changes(self):
        self.assertEqual(route(['app/public_core.mjs'],{'app/public_core.mjs':'+ return events.find(e => e.id === wanted);'}),'public-ui')
        self.assertEqual(route(['app/public_core.mjs'],prefix_same=False),'full')
        self.assertEqual(route(['app/public_core.mjs'],{'app/public_core.mjs':'+ fetch("/private")'}),'full')
    def test_cumulative_sensitive_history_never_escaped_by_later_visual(self):
        # Cumulative diff includes an earlier change regardless of previous check outcomes.
        for prior in ('failed','pending','missing','success'):
            self.assertEqual(route(['app/app.css','contracts/gameday_engine.mjs'],action='synchronize'),'full',prior)
    def test_sensitive_unknown_and_ambiguous(self):
        for path in ['supabase/migrations/01.sql','server/a.mjs','functions/api/a.js','contracts/gameday_engine.mjs','app/session.mjs','tools/ci_impact.py','.github/workflows/browser-tests.yml','app/game_tiles.mjs','new-file.js']:
            self.assertEqual(route([path]),'full',path)
        self.assertEqual(route(['app/tv.mjs'],{'app/tv.mjs':'+ fetch("/x")'}),'full')
        self.assertEqual(route(['app/tv.mjs'],{'app/tv.mjs':'+ submitResult()'}),'full')
        self.assertEqual(route(['app/tv.mjs'],{'app/tv.mjs':'+ canPublish = true;'}),'full')
        self.assertEqual(route(['app/tv.mjs'],{'app/tv.mjs':'+ m.winnerName = other;'}),'full')
        self.assertEqual(route(['app/app.css'],{'app/app.css':'+ .live {display:none}'}),'full')
    def test_invalid_ranges_force_full(self):
        for kw in ({'base':''},{'head':'0'*39},{'checkout':BEFORE},{'action':'synchronize','before':''},{'action':'synchronize','after':BASE},{'action':'synchronize','ancestor':False}):
            self.assertEqual(route(['app/app.css'],**kw),'full',kw)
        self.assertEqual(route([]),'full')
    def test_main_and_manual(self):
        self.assertEqual(route(['app/app.css'],event='push'),'ui-visual')
        self.assertEqual(route(['app/app.css','contracts/gameday_engine.mjs'],event='push'),'full')
        self.assertEqual(route(['app/app.css'],event='push',ancestor=False),'full')
        self.assertEqual(route(['app/app.css'],event='workflow_dispatch'),'full')
        self.assertEqual(route(['docs/readme.md']),'docs')



TV_OLD = (
    "import {h} from './dom.mjs';\n"
    "function tally(m) { return null; }\n"
    "function drawConnections() { return; }\n"
    "startPublicFeed({onUpdate: update});\n"
)
TV_NEW = (
    "import {h} from './dom.mjs';\n"
    "function tally(m) { return null; }\n"
    "function winDots(m) { return h('span', {class:'win-dot', text:'Verified'}); }\n"
    "function drawConnections() { return; }\n"
    "startPublicFeed({onUpdate: update});\n"
)
TV_TEST_OLD = "test('privacy', () => { assert.equal(1, 1); });\ntest('layout', () => { assert.ok(true); });\n"
TV_TEST_NEW = TV_TEST_OLD + "test('a11y', () => { assert.ok(true); });\n"

class TvRoutingTests(unittest.TestCase):
    def test_whole_visual_pr_uses_public_ui_lane(self):
        files = ['app/tv.css', 'app/tv.mjs', 'tests/e2e/tv_presentation.test.mjs',
                 '.github/workflows/tv-presentation.yml', 'docs/tv-review.md']
        sources = {'app/tv.mjs': (TV_OLD, TV_NEW),
                   'tests/e2e/tv_presentation.test.mjs': (TV_TEST_OLD, TV_TEST_NEW)}
        self.assertEqual(route(files, sources=sources,
                               patches={'app/tv.mjs':"+ function winDots(m) { return h('span'); }",
                                        'app/tv.css':"+ .score {filter: drop-shadow(0 2px 6px #123); opacity:1}"}),
                         'public-ui')

    def test_unmodified_visual_css_does_not_force_full_ci(self):
        self.assertEqual(route(['app/tv.css'], patches={'app/tv.css':"+ .score {color: #fff;}"}), 'public-ui')
        self.assertEqual(route(['app/tv.css'], event='push', patches={'app/tv.css':"+ .score {color: #fff;}"}), 'public-ui')
        self.assertEqual(route(['app/tv.css'], patches={'app/tv.css':"+ .spinner {border-top-color:transparent}"}), 'public-ui')

    def test_tv_hiding_resources_or_live_status_is_full(self):
        for css in ('+ .feed-status{display:none}', '+ .badge{visibility:hidden}',
                    '+ .badge{opacity:0}', '+ .tile{filter:blur(6px)}',
                    '+ .tile{background-image:url(https://remote.invalid/img)}'):
            self.assertEqual(route(['app/tv.css'], patches={'app/tv.css':css}), 'full', css)

    def test_tv_feed_and_sensitive_code_still_full(self):
        sources = {'app/tv.mjs': (TV_OLD, TV_NEW)}
        for line in ('+ fetch("/api")', '+ document.cookie', '+ startPublicFeed({})',
                     '+ board.private.email', '+ localStorage.setItem("key", "value")'):
            self.assertEqual(route(['app/tv.mjs'], sources=sources,
                                   patches={'app/tv.mjs': line}), 'full', line)
        unsafe = TV_NEW.replace("startPublicFeed({onUpdate: update});",
                                "startPublicFeed({onUpdate: leak});")
        self.assertEqual(route(['app/tv.mjs'],
                               sources={'app/tv.mjs': (TV_OLD, unsafe)},
                               patches={'app/tv.mjs':"+ function winDots(m) { return h('span'); }"}), 'full')
        unsafe_import = TV_NEW.replace("import {h}", "import {privateData,h}")
        self.assertEqual(route(['app/tv.mjs'],
                               sources={'app/tv.mjs': (TV_OLD, unsafe_import)},
                               patches={'app/tv.mjs':"+ function winDots(m) { return h('span'); }"}), 'full')

    def test_test_coverage_must_remain_present(self):
        for newer in ("test('layout', () => { assert.ok(true); });",
                      "test('privacy', () => {});\ntest('layout', () => {});",
                      TV_TEST_NEW+"test.skip('bypass', () => {});"):
            self.assertEqual(route(['tests/e2e/tv_presentation.test.mjs'],
                                   sources={'tests/e2e/tv_presentation.test.mjs': (TV_TEST_OLD, newer)}),
                             'full', newer)

    def test_screenshot_workflow_is_pinned_and_scoring_never_fast(self):
        self.assertEqual(route(['.github/workflows/tv-presentation.yml']), 'public-ui')
        self.assertEqual(route(['.github/workflows/tv-presentation.yml'],
                               pinned_blob='0'*40), 'full')
        for path in ('contracts/gameday_public.mjs', 'app/staff.mjs',
                     'supabase/proposals/GAMEDAY_V6_GAME_PROGRESS_DO_NOT_APPLY.sql',
                     '.github/workflows/browser-tests.yml', 'tests/e2e/gameday_v6_browser.test.mjs'):
            self.assertEqual(route(['app/tv.css', path]), 'full', path)


class ReuseTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('ci_reuse',ROOT/'tools'/'ci_reuse.py')
        self.mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(self.mod)
        self.env=patch.dict('os.environ',{'GITHUB_REPOSITORY':'owner/repo'}); self.env.start()
        self.addCleanup(self.env.stop)
        self.pulls=[{'number':60,'merged_at':'now','merge_commit_sha':HEAD,'base':{'ref':'main'},'head':{'sha':BEFORE,'repo':{'full_name':'owner/repo'}}}]
        self.commits={HEAD:'tree',BEFORE:'tree'}
        self.runs=[{'id':1,'head_sha':BEFORE,'event':'pull_request','path':'.github/workflows/browser-tests.yml','status':'completed','conclusion':'success','pull_requests':[{'number':60,'base':{'sha':BASE},'head':{'sha':BEFORE}}]}]
        self.jobs={1:[{'name':n,'status':'completed','conclusion':'success'} for n in self.mod.REQUIRED]}
    def check(self,**kw):
        args={'before':BASE,'after':HEAD,'pulls':self.pulls,'commits':self.commits,'runs':self.runs,'jobs':self.jobs,'changed':['contracts/gameday_engine.mjs'],'base_ancestor':True};args.update(kw)
        return self.mod.proof(**args)
    def test_identical_merged_tree_requires_all_full_jobs(self):
        self.assertTrue(self.check())
        self.jobs[1][0]['conclusion']='failure'; self.assertFalse(self.check())
        self.jobs[1][0]['conclusion']='success'; self.jobs[1][0]['status']='in_progress'; self.assertFalse(self.check())
        self.assertFalse(self.check(jobs={}))
        self.runs[0]['status']='in_progress'; self.assertFalse(self.check())
    def test_tree_provenance_and_policy_changes_fail_closed(self):
        self.assertFalse(self.check(commits={HEAD:'one',BEFORE:'different'}))
        self.assertFalse(self.check(changed=['.github/workflows/browser-tests.yml']))
        self.assertFalse(self.check(changed=['tests/test_ci_impact.py']))
        self.assertFalse(self.check(pulls=[]))
        self.assertFalse(self.check(base_ancestor=False))
        self.runs[0]['pull_requests'][0]['base']['sha']=HEAD; self.assertFalse(self.check())
        self.assertFalse(self.check(before=''))

class RealHistoryTests(unittest.TestCase):
    def test_cumulative_pr_range_keeps_earlier_sensitive_change(self):
        with tempfile.TemporaryDirectory() as directory:
            def run(*args):
                return subprocess.check_output(['git','-C',directory,*args],text=True,stderr=subprocess.DEVNULL).strip()
            run('init'); run('config','user.email','fixture@example.invalid'); run('config','user.name','Fixture')
            root=pathlib.Path(directory); (root/'app').mkdir(); (root/'contracts').mkdir()
            (root/'app/app.css').write_text('.box { color: red; }\n'); (root/'contracts/gameday_engine.mjs').write_text('initial\n')
            run('add','.'); run('commit','-m','base'); base=run('rev-parse','HEAD')
            (root/'contracts/gameday_engine.mjs').write_text('sensitive\n'); run('add','.'); run('commit','-m','sensitive'); before=run('rev-parse','HEAD')
            (root/'app/app.css').write_text('.box { color: blue; }\n'); run('add','.'); run('commit','-m','visual'); head=run('rev-parse','HEAD')
            def real_git(*args): return run(*args)
            with patch.object(impact,'git',side_effect=real_git):
                self.assertEqual(impact.classify('pull_request','synchronize',before,head,base,head)[0],'full')
                self.assertEqual(impact.classify('push','',before,head)[0],'ui-visual')

if __name__=='__main__': unittest.main()
