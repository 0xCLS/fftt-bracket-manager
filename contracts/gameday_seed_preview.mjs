/** PREVIEW ONLY: deterministic post-bye matchup analysis, not used by the live Staff app or server.
 * This does not change the official engine, consolation eligibility, scoring or tournament results. */
import {seedSlots} from './gameday_engine.mjs';

function rankOrder(groupCount) {
  let order=[1];
  for(let n=2;n<=groupCount;n*=2)order=order.flatMap(seed=>[seed,n+1-seed]);
  return order;
}
const severeCount = (groups,byes,groupCount,rating) => {
  let total=0;
  for(let i=0;i<byes;i++){
    const opponent=groups[groupCount-1-i];
    if(opponent?.length!==2)continue;
    const gap=rating.get(groups[i][0])-Math.max(...opponent.map(id=>rating.get(id)));
    if(gap>=3)total++;
  }
  return total;
};

/** Return a tested alternative, not an instruction to build a live bracket.
 * Retains all byes and first-round pairings; only permutes which opening pair
 * faces a seeded bye. Reverts to the original if the target mismatch count
 * fails to improve. Brackets with more byes than played first-round matches
 * (e.g. 33 of 64 slots) remain on standard seeding. */
export function previewRefinedSeedSlots(players){
  const baseline=seedSlots(players), size=baseline.length,byes=baseline.filter(id=>id===null).length;
  const groupCount=size/2, order=rankOrder(groupCount);
  const rating=new Map(players.map(p=>[p.id,p.rating]));
  const old=Array.from({length:groupCount},()=>null);
  order.forEach((rank,i)=>{old[rank-1]=baseline.slice(i*2,i*2+2).filter(Boolean);});
  const initial=severeCount(old,byes,groupCount,rating);
  const unchanged=()=>({baseline,slots:[...baseline],changed:false,byes,severeBaseline:initial,severeProposed:initial});
  const pairCount=groupCount-byes;
  if(byes===0||byes>pairCount)return unchanged();
  const pairs=old.slice(byes);
  if(pairs.some(g=>g?.length!==2))return unchanged();
  const remaining=pairs.map((_,i)=>i),chosen=new Map();
  // Give the less-strong bye seeds first choice. Target a post-bye
  // opponent around two levels below: neither a guaranteed mismatch
  // nor an unnecessarily early near-equal match for the top seed.
  for(let i=byes-1;i>=0;i--){
    const r=rating.get(old[i][0]);
    const cost=j=>{
      const high=Math.max(...pairs[j].map(id=>rating.get(id)));
      const gap=r-high;
      return Math.max(0,gap-2)*100+Math.max(0,1-gap)*30+Math.abs(gap-2)*4;
    };
    let best=remaining[0];
    for(const j of remaining)if(cost(j)<cost(best))best=j;
    remaining.splice(remaining.indexOf(best),1);
    chosen.set(groupCount-1-i,pairs[best]);
  }
  const updated=Array(groupCount).fill(null);
  for(let i=0;i<byes;i++)updated[i]=old[i];
  for(const [i,pair] of chosen)updated[i]=pair;
  let next=0;
  for(let i=byes;i<groupCount;i++)if(!updated[i])updated[i]=pairs[remaining[next++]];
  const revised=severeCount(updated,byes,groupCount,rating);
  if(revised>=initial)return unchanged();
  const slots=Array(size).fill(null);
  order.forEach((rank,i)=>{const g=updated[rank-1];slots[i*2]=g[0];slots[i*2+1]=g[1]??null;});
  return {baseline,slots,changed:true,byes,severeBaseline:initial,severeProposed:revised};
}
