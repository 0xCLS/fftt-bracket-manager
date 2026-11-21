/** Pure grouping and filtering of already-authorized staff events. */
const rank = ['recent','current','planned','completed','archived'];
const labels = {recent:'Recently opened',current:'Active events',planned:'Upcoming and draft events',completed:'Completed events',archived:'Archived events'};
const group = e => e.lifecycle === 'active' ? 'current' : e.lifecycle === 'complete' ? 'completed' : e.lifecycle === 'archived' ? 'archived' : 'planned';
export function organizeEventChoices(events, recentId) {
  const all = [...new Map((events ?? []).filter(e=>e?.eventId).map(e=>[e.eventId,e])).values()]
    .sort((a,b)=>String(b.date??'').localeCompare(String(a.date??'')) || String(a.name??'').localeCompare(String(b.name??'')) || a.eventId.localeCompare(b.eventId));
  const recent = all.find(e=>e.eventId===recentId);
  return rank.map(id=>({id,label:labels[id],events:id==='recent'?(recent?[recent]:[]):all.filter(e=>e!==recent && group(e)===id)}))
    .filter(g=>g.events.length);
}
export function searchEventChoices(groups, query) {
  const q=String(query??'').trim().toLocaleLowerCase();
  if(!q)return groups;
  return groups.map(g=>({...g,events:g.events.filter(e=>[e.name,e.date,e.lifecycle,e.role].some(v=>String(v??'').toLocaleLowerCase().includes(q)))}))
    .filter(g=>g.events.length);
}
