from pathlib import Path
import os
from playwright.sync_api import sync_playwright
import json
HTML=(Path(__file__).resolve().parent.parent / 'index.html').read_text()
JAVASCRIPT='''({n}) => {
  const storage=()=>JSON.parse(localStorage.getItem('fftt_bracket_manager_v01'));
  document.querySelector('[data-tab=players]').click();
  document.querySelector('#bulkPlayers').value=Array.from({length:n},(_,i)=>`Player ${i+1},${1+(i%5)},provisional`).join('\\n');
  document.querySelector('#bulkAddBtn').click();
  document.querySelector('#buildChampBtn').click();
  const play=(type)=>{
    let count=0;
    while(true){
      const state=storage();
      const b=state[type];
      const q=b.rounds.flat().find(m=>m.p1&&m.p2&&!m.resolved);
      if(!q) return count;
      document.querySelector('[data-tab=desk]').click();
      const button=Array.from(document.querySelectorAll('.record-result')).find(e=>e.dataset.type===type&&e.dataset.id===q.id);
      if(!button)throw Error('NO BUTTON for '+type+' '+q.id);
      button.click();
      document.querySelector('#winnerChoices input[value="'+q.p1+'"]').checked=true;
      document.querySelector('#resultScore').value='';
      document.querySelector('#resultForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      if(++count>n*3)throw Error('LOOP');
    }
  };
  const c=play('championship');
  const state=storage();
  const ids=state.players.filter(p=>p.firstChampLoss).map(p=>p.id);
  let cons=0;
  if(ids.length>=2){
    document.querySelector('[data-tab=consolation]').click();
    document.querySelector('#buildConsBtn').click();
    cons=play('consolation');
  }
  const end=storage();
  const totalMatches=new Map(end.players.map(p=>[p.id,0]));
  for(const b of [end.championship,end.consolation])if(b)for(const m of b.rounds.flat())if(m.resolved&&m.winner&&!['BYE','EMPTY'].includes(m.score)){
    totalMatches.set(m.p1,totalMatches.get(m.p1)+1);
    totalMatches.set(m.p2,totalMatches.get(m.p2)+1);
  }
  return {n,champ:c,cons,consolationPool:ids.length,minimumMatches:Math.min(...totalMatches.values()),lessThan2:[...totalMatches].filter(([k,v])=>v<2),champion:end.championship.champion,consWinner:end.consolation?.champion??null,distinct:totalMatches.size};
}'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('FFTT_CHROMIUM_BIN') or None,headless=True,args=['--no-sandbox'])
 page=b.new_page(accept_downloads=True)
 for n in [2,3,4,5,6,7,8,9,12,16,17,24,30,31,32,33,48]:
  page.goto('about:blank')
  page.evaluate('''() => {window.__testStorage=new Map();Object.defineProperty(window,'localStorage',{configurable:true,get(){return {setItem:(k,v)=>window.__testStorage.set(k,v),getItem:k=>window.__testStorage.get(k)||null,removeItem:k=>window.__testStorage.delete(k),clear:()=>window.__testStorage.clear()}}});}''')
  page.set_content(HTML)
  result=page.evaluate(JAVASCRIPT,{'n':n})
  assert result['champ']==n-1, str(result)
  if n>2:
   assert result['cons']==result['consolationPool']-1,str(result)
   assert result['minimumMatches']>=2,str(result)
  print('PASS bracket:',json.dumps({k:result[k] for k in ('n','champ','cons','minimumMatches')}),flush=True)
 b.close()