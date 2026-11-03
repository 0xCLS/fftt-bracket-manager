/** Explicit implicit-flow invite acceptance. No token is stored, logged or sent to a third-party origin. */
import {C3_HOST} from '../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {PUBLISHABLE_KEY} from './config.mjs';
import {$} from './dom.mjs';
const jwt=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const allowed=location.protocol==='https:'&&
  ['fftt-staff.clslifestyle.com','fftt-staff.pages.dev','fftt3-staff-stg.pages.dev'].includes(location.hostname);
const fragment=new URLSearchParams(location.hash.slice(1));
const type=fragment.get('type');
let token=fragment.get('access_token');
// Strip token material from the address bar immediately. We never persist refresh tokens.
history.replaceState(null,'',location.pathname);
const status=$('status'),form=$('finish'),button=$('savePassword');
if(!allowed||type!=='invite'||!token||!jwt.test(token)||token.length>10000){
  token=null;status.textContent='This invitation is invalid or has expired. Please ask the Organizer for a fresh invitation.';
}else{
  form.hidden=false;
  status.textContent='Invite verified locally. Set a new password to finish account setup.';
}
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!token||!allowed)return;
  const password=$('newPassword').value,again=$('repeatPassword').value;
  if(password.length<12||password.length>128||password!==again){
    status.textContent='Use at least 12 characters and make sure both passwords match.';return;
  }
  button.disabled=true;status.textContent='Saving your password…';
  try{
    const res=await fetch(C3_HOST+'/auth/v1/user',{method:'PUT',redirect:'error',credentials:'omit',
      cache:'no-store',referrerPolicy:'no-referrer',headers:{apikey:PUBLISHABLE_KEY,Authorization:'Bearer '+token,
      'Content-Type':'application/json'},body:JSON.stringify({password})});
    if(res.status!==200)throw Error('update-failed');
    token=null;$('newPassword').value='';$('repeatPassword').value='';
    form.hidden=true;status.textContent='Password saved. Open Staff sign-in and use your email and new password.';
  }catch{
    status.textContent='Password setup could not be confirmed. The invitation may have expired. Contact the Organizer; do not keep retrying an uncertain request.';
  }finally{button.disabled=false;}
});
