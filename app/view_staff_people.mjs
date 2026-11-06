/** One full-width People card. Auth state is read-only; event grants are server-authoritative. */
import {STAFF_ROLES, planStaffChange} from '../contracts/staff_people.mjs';
const roleLabel={scorekeeper:'Scorekeeper',bracket_manager:'Bracket Manager',organizer:'Organizer'};
// What the Organizer is told for each add outcome. "Sent" means the Auth service issued a message, not that it was delivered or opened.
const INVITE_NOTES={
  reinvited:'A new invitation was sent to this existing account. The link works for one hour and replaces the previous link. No event access was granted.',
  'recently-sent':'An invitation was sent to this account a few minutes ago, so no new message was sent. That link still works until it expires. Try again in about ten minutes if it was not used.',
  'in-progress':'An invitation for this account is already being sent. Wait a moment and refresh before trying again.',
  uncertain:'The service could not confirm whether a new invitation was sent. Do not send another yet: wait about ten minutes, ask the person whether a new email arrived, then try again.'};
export function createStaffPeopleView({core,s,h,pill,result,confirmDialog,openDialog,rerender}) {
  let layout='people', query='';
  const edits=new Map();
  // Native role selects manage their own popup. Close assignment disclosures before
  // another control takes focus or receives a pointer, without rebuilding the rows.
  const closeAssignments = except => {
    for (const menu of document.querySelectorAll('.people-event-dropdown[open]')) {
      if (menu !== except) menu.open = false;
    }
  };
  document.addEventListener('pointerdown', ev => closeAssignments(ev.target.closest?.('.people-event-dropdown')));
  document.addEventListener('focusin', ev => closeAssignments(ev.target.closest?.('.people-event-dropdown')));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeAssignments(); });
  const events=()=>s.events.filter(e=>e.role==='organizer'&&e.lifecycle!=='archived');
  function pending(p) {
    // Start from the server's actual grants only. An unassigned person has no events and no role until someone chooses them.
    if(!edits.has(p.email)) edits.set(p.email,{selected:new Set(Object.keys(p.assignments)),
      role:p.assignments[s.eventId]??Object.values(p.assignments)[0]??''});
    return edits.get(p.email);
  }
  function addModal(){
    openDialog((dlg,close)=>{
      const name=h('input',{type:'text',required:true,maxlength:120,autocomplete:'name',placeholder:'Full name'});
      const email=h('input',{type:'email',required:true,autocomplete:'email',autocapitalize:'none',placeholder:'volunteer@example.org'});
      const status=h('p',{class:'status','aria-live':'polite'});
      const submit=h('button',{type:'submit',class:'primary',text:'Find or invite staff member'});
      const form=h('form',{class:'dlg',on:{submit:async ev=>{
        ev.preventDefault();if(!name.value.trim()||!email.validity.valid){status.textContent='Enter a name and a valid email.';return;}
        submit.disabled=true;status.textContent='Verifying the account and invitation…';
        const r=await core.actions.addStaffPerson(name.value,email.value);
        if(r.ok&&r.res?.status==='uncertain'){status.textContent=INVITE_NOTES.uncertain;return;}  // keep the dialog open; do not invite a retry
        if(r.ok){result(r,INVITE_NOTES[r.res?.status]??'Staff member added to the directory.');edits.clear();close();rerender();}
        else{status.textContent=r.message??'Account setup was not confirmed. No event access was granted.';submit.disabled=false;}
      }}},
      h('h3',{text:'Add staff member'}),h('p',{class:'help',text:'One account works across events. Invitations require the protected Organizer service; no event role is granted automatically.'}),
      h('label',{},'Name'),name,h('label',{},'Email'),email,status,
      h('div',{class:'dlg-actions'},h('button',{type:'button',text:'Cancel',on:{click:close}}),submit));
      dlg.append(form);
    },{label:'Add staff member'});
  }
  function confirmRemoval(p, available) {
    return new Promise(resolve=>{
      let answered=false;
      const assignments=Object.entries(p.assignments).map(([id,role])=>{
        const e=available.find(item=>item.eventId===id);
        return (e ? e.name+' · '+e.date : 'Unknown event')+' — '+(roleLabel[role]??role);
      });
      const dlg=openDialog((d,close)=>{
        const answer=value=>{answered=true;resolve(value);close();};
        d.append(h('div',{class:'dlg people-remove-dialog'},
          h('h3',{text:'Remove staff member?'}),
          h('p',{class:'people-remove-email'},h('span',{text:'Account email'}),h('strong',{text:p.email})),
          h('p',{class:'notice warn',text:'The directory entry will be archived and the event assignments below will be revoked. The login and historical records remain.'}),
          h('p',{text:'Event assignments to revoke:'}),
          assignments.length?h('ul',{},assignments.map(text=>h('li',{text}))):h('p',{text:'No active event assignments.'}),
          h('div',{class:'dlg-actions'},h('button',{type:'button',text:'Cancel',on:{click:()=>answer(false)}}),
            h('button',{type:'button',class:'danger',text:'Remove staff member',on:{click:()=>answer(true)}}))));
      },{label:'Remove staff member'});
      dlg.addEventListener('close',()=>{if(!answered)resolve(false);});
    });
  }
  function personRow(p) {
    const d=pending(p), available=events(), editable=s.staffDirectory.status==='ready';
    // No role chosen yet means there is nothing valid to save (an unassigned person must get an explicit role).
    const change=()=>STAFF_ROLES.includes(d.role)?planStaffChange(p,[...d.selected],d.role,available):{changed:false,revoke:[],grant:[]};
    const summary=h('span',{class:'people-event-summary-text',text:d.selected.size===0?'No events':
      [...d.selected].map(id=>available.find(e=>e.eventId===id)?.name??'Event').join(', ')});
    const menu=h('div',{class:'people-event-menu'},
      h('p',{class:'people-event-heading',text:'ASSIGNED EVENTS'}),
      available.map(e=>h('label',{class:'people-event-option'},
        h('input',{type:'checkbox',checked:d.selected.has(e.eventId),disabled:!editable,on:{change:ev=>{
          if(ev.target.checked)d.selected.add(e.eventId);else d.selected.delete(e.eventId);
          summary.textContent=d.selected.size?[...d.selected].map(id=>available.find(a=>a.eventId===id)?.name??'Event').join(', '):'No events';
          save.disabled=!change().changed||!p.verified||!editable||!core.canWrite();
        }}}),
        h('span',{},h('strong',{text:e.name}),h('small',{text:e.date})))),
      h('p',{class:'help',text:'Uncheck an event and Save to revoke only that event’s access.'}));
    const details=h('details',{class:'people-event-dropdown'},
      h('summary',{'aria-label':'Events assigned to '+p.name},summary),menu);
    const role=h('select',{'aria-label':'Role for '+p.name,class:'people-role-control',disabled:!editable,on:{change:ev=>{
      d.role=ev.target.value;save.disabled=!change().changed||!p.verified||!editable||!core.canWrite();
    }}},d.role===''?h('option',{value:'',selected:true,disabled:true,text:'Select role'}):null,
      STAFF_ROLES.map(v=>h('option',{value:v,selected:d.role===v,text:roleLabel[v]})));
    const save=h('button',{type:'button',class:'small primary',text:'Save',disabled:!change().changed||!p.verified||!editable||!core.canWrite(),
      on:{click:async()=>{
        const plan=change();if(!plan.changed)return;
        const names=ids=>ids.map(id=>available.find(e=>e.eventId===id)?.name??'Unknown event').join(', ');
        const msg=[
          plan.revoke.length?'Remove access: '+names(plan.revoke)+'.':'',
          plan.grant.length?'Grant '+roleLabel[d.role]+' access: '+names(plan.grant)+'.':''
        ].filter(Boolean).join(' ');
        if(!(await confirmDialog('Save staff assignments?',msg,'Save changes',{danger:plan.revoke.length>0})))return;
        save.disabled=true;
        const r=await core.actions.saveStaffPerson(p,Array.from(d.selected),d.role);
        if(r.ok){edits.delete(p.email);result(r,'Event access updated.');rerender();}  // repaint from the reloaded server grants, not the stale edit
        else{result(r);save.disabled=false;}
      }}});
    const remove=h('button',{type:'button',class:'people-remove',text:'×',title:'Remove '+p.name+' from staff directory',
      'aria-label':'Remove '+p.name+' from staff directory',disabled:!editable||!core.canWrite(),on:{click:async()=>{
        if(!(await confirmRemoval(p,available)))return;
        const r=await core.actions.removeStaffPerson(p);
        if(r.ok){edits.delete(p.email);result(r,'Staff member removed from the directory.');}
        else result(r);
      }}});
    return h('article',{class:'people-row','data-person':p.email},
      h('div',{class:'people-identity'},h('span',{class:'people-avatar','aria-hidden':'true',
        text:p.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase()}),
        h('div',{class:'people-name-wrap'},h('strong',{class:'people-name',text:p.name}),
          h('span',{class:'people-email',text:p.email})),
        pill(p.verified?'Verified':p.provisioned?'Invitation pending':'Identity unverified',p.verified?'good':'warn')),
      h('div',{class:'people-event-cell'},h('label',{class:'people-field-label',text:'Event assignment'}),details),
      h('div',{class:'people-role-cell'},h('label',{class:'people-field-label',text:'Role'}),role),
      h('div',{class:'people-action-cell'},save,remove));
  }
  return function viewStaffPeople(){
    if(s.staffDirectory.status==='idle'&&!s.paused&&core.connection()==='live')queueMicrotask(()=>{if(s.staffDirectory.status==='idle'&&!s.paused)void core.actions.loadStaffDirectory();});
    const people=s.staffDirectory.people??[];
    const filtered=people.filter(p=>p.name.toLowerCase().includes(query)||p.email.includes(query));
    const title=h('h2',{text:'People'});
    const list=h('div',{class:'people-list'});
    if(layout==='people')list.append(...filtered.map(personRow));
    else for(const e of events()){
      const group=filtered.filter(p=>p.assignments[e.eventId]);
      list.append(h('h3',{class:'people-event-section-title',text:e.name+' · '+e.date}),
        ...(group.length?group.map(personRow):s.staffDirectory.status==='ready'?[h('p',{class:'help',text:'No staff currently assigned to this event.'})]:[]));
    }
    if(!filtered.length)list.append(h('p',{class:'empty-state',text:s.staffDirectory.status==='error'?'Staff access is unavailable. Refresh to try again.':s.staffDirectory.status==='ready'?'No staff members match your search.':'Loading staff…'}));
    const search=h('input',{type:'search',value:query,placeholder:'Search by name or email','aria-label':'Search staff members',
      on:{input:ev=>{query=ev.target.value.toLowerCase();for(const row of list.querySelectorAll('[data-person]')){
        const p=people.find(x=>x.email===row.dataset.person);
        row.hidden=!!p&&!(p.name.toLowerCase().includes(query)||p.email.includes(query));}
      }}});
    const viewMode=v=>h('button',{type:'button',class:'small',
      'aria-pressed':String(layout===v),text:v==='people'?'People':'By event',
      on:{click:()=>{layout=v;rerender();}}});
    return h('section',{class:'card people-directory-card'},
      h('div',{class:'people-heading'},
        h('div',{},title,h('p',{class:'help',text:'One identity across events. Access is granted and revoked per event.'})),
        h('div',{class:'people-controls'},h('div',{class:'people-mode-switch',role:'group','aria-label':'Staff directory view'},viewMode('people'),viewMode('event')),
          h('button',{type:'button',class:'primary',text:'+ Add Staff',disabled:s.staffDirectory.status!=='ready',on:{click:addModal}}))),
      s.staffDirectory.error?h('p',{class:'notice warn',text:s.staffDirectory.error}):null,
      h('div',{class:'people-search-row'},search,
        h('button',{type:'button','data-read-retry':'true',text:'Refresh',disabled:s.paused,on:{click:()=>{edits.clear();void core.actions.loadStaffDirectory();}}})),
      h('div',{class:'people-colheads'},h('span',{text:'PERSON'}),h('span',{text:'EVENT ASSIGNMENT'}),h('span',{text:'ROLE'}),h('span',{text:'ACTIONS'})),
      list,h('p',{class:'help people-footer',text:'Uncheck an event and Save to remove only its access. The × removes a person from the directory without deleting their login or past results.'}));
  };
}
