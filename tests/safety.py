from pathlib import Path
import os
from playwright.sync_api import sync_playwright
import json
HTML=(Path(__file__).resolve().parent.parent / 'index.html').read_text()
BOOT='''() => {window.__testStorage=new Map();Object.defineProperty(window,'localStorage',{configurable:true,get(){return {setItem:(k,v)=>window.__testStorage.set(k,v),getItem:k=>window.__testStorage.get(k)||null,removeItem:k=>window.__testStorage.delete(k),clear:()=>window.__testStorage.clear()}}});}'''
KEY='fftt_bracket_manager_v01'

with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('FFTT_CHROMIUM_BIN') or None,headless=True,args=['--no-sandbox'])
 page=b.new_page(accept_downloads=True);page.goto('about:blank');page.evaluate(BOOT);page.set_content(HTML)
 get=lambda:page.evaluate('''key=>JSON.parse(localStorage.getItem(key))''',KEY)
 seen=[];accepts=[]
 def on_dialog(d):
  seen.append((d.type,d.message))
  d.accept() if (not accepts or accepts.pop(0)) else d.dismiss()
 page.on('dialog',on_dialog)
 page.evaluate('''() => {document.querySelector('[data-tab=players]').click();document.querySelector('#bulkPlayers').value='Alice,3\\nBob,2\\nCara,5\\nDan,4';document.querySelector('#bulkAddBtn').click();document.querySelector('#buildChampBtn').click();document.querySelector('[data-tab=desk]').click();document.querySelector('.record-result').click();document.querySelector('#winnerChoices input').checked=true;}''')
 page.locator('#resultScore').fill('banana'); page.locator('#resultForm button[type=submit]').click()
 assert sum(x['resolved'] for r in get()['championship']['rounds'] for x in r)==0
 assert seen and seen[-1][0]=='alert' and ('Use game scores' in seen[-1][1] or 'completed game scores' in seen[-1][1])
 print('PASS reject non-score',seen[-1][1])
 page.locator('#resultScore').fill('11-8, 8-11, 11-7'); page.locator('#resultForm button[type=submit]').click()
 assert sum(x['resolved'] for r in get()['championship']['rounds'] for x in r)==1
 print('PASS accept valid 2/3 score')
 page.locator('[data-tab=championship]').click()
 accepts.append(False);page.locator('#rebuildChampBtn').click()
 assert sum(x['resolved'] for r in get()['championship']['rounds'] for x in r)==1
 assert seen[-1][0]=='confirm' and 'Rebuild the championship' in seen[-1][1]
 print('PASS canceled destructive rebuild preserved results')
 page.locator('[data-tab=data]').click()
 with page.expect_download(timeout=5000) as d: page.locator('#exportBtn').click()
 save=Path('/tmp/fftt_valid_test_backup.json');d.value.save_as(save)
 assert json.loads(save.read_text())['championship']['rounds'][0][0]['score']=='11-8, 8-11, 11-7'
 print('PASS valid JSON export')
 page.locator('[data-tab=championship]').click();page.locator('#rebuildChampBtn').click()
 assert sum(x['resolved'] for r in get()['championship']['rounds'] for x in r)==0
 print('PASS accepted rebuild cleared recorded matches')
 page.locator('[data-tab=data]').click();page.locator('#importFile').set_input_files(str(save))
 page.wait_for_function('''key=>JSON.parse(localStorage.getItem(key))?.championship?.rounds[0]?.some(m=>m.score==='11-8, 8-11, 11-7')''',arg=KEY)
 print('PASS valid backup restored')
 before=get()
 bad=Path('/tmp/fftt_invalid_test_backup.json');bad.write_text(json.dumps({'version':'0.1','event':{'name':'X'},'players':[],'championship':{'rounds':'broken'}}))
 page.locator('#importFile').set_input_files(str(bad));page.wait_for_timeout(100)
 assert get()==before,'invalid import modified event state'
 assert seen[-1][0]=='alert' and 'Your existing event was not changed.' in seen[-1][1]
 print('PASS invalid backup rejected before mutation')
 # Score pointing to wrong winner must be rejected.
 page.locator('[data-tab=desk]').click();page.locator('.record-result').first.click()
 choices=page.locator('#winnerChoices input');choices.nth(1).check()
 page.locator('#resultScore').fill('11-8, 11-5')
 pre=get();page.locator('#resultForm button[type=submit]').click()
 assert get()==pre
 assert seen[-1][0]=='alert' and 'do not match the selected winner' in seen[-1][1]
 print('PASS reject inconsistent score/winner')
 b.close()