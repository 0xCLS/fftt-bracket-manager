/** Simulated password-login devices over the disposable SimCloud. Real transport, vault, session and
 * recovery controller; only the cloud is simulated. `reload()` models a page reload / discarded mobile
 * tab: a brand-new session object over the SAME tab storage.
 */
import {createMilestone1PasswordSupabaseTransport} from '../contracts/milestone1_password_transport.mjs';
import {createMilestone1StaffSessionVault} from '../contracts/milestone1_staff_session_vault.mjs';
import {createMilestone1PasswordStaffSession} from '../contracts/milestone1_password_session.mjs';
import {createMilestone1EmailCodeRecovery} from '../contracts/milestone1_email_code_recovery.mjs';
import {tabStorage} from './milestone1_sim_clients.mjs';
export const PW_KEY='sb_publishable_synthetic_test_key_1234';
export function makePasswordClient(cloud,name,{allowTabPersistence=false,storage=tabStorage(),...policy}={}){
 const net=cloud.client(name);
 const state={online:true};
 const transport=createMilestone1PasswordSupabaseTransport({publishableKey:PW_KEY,
  allowSyntheticAuthNetwork:true,fetchImpl:net.fetch});
 const make=()=>{
  const vault=createMilestone1StaffSessionVault({tabStorage:storage});
  const session=createMilestone1PasswordStaffSession({transport,isOnline:()=>state.online,now:cloud.now,
   vault,allowTabPersistence,...policy});
  const recovery=createMilestone1EmailCodeRecovery({transport,adopt:session.adoptVerifiedSession,now:cloud.now});
  return {session,recovery,vault};
 };
 const client={name,net,state,transport,storage,...make(),
  setOnline(v){state.online=v;net.setOnline(v);},
  /** A reload: new in-memory objects, same sessionStorage. */
  reload(){Object.assign(client,make());return client;},
  requests:path=>cloud.log.filter(l=>l.client===name&&(!path||l.path===path)).length,
 };
 return client;
}
