/** Private Organizer-controlled Auth invite and directory metadata. Never expose secret credentials to clients.
 * Requires a dedicated Staff host + a separately installed SUPABASE_ADMIN_SECRET.
 * Existing per-event grant/revoke RPCs remain the only authority for event permissions.
 */
import {C3_HOST} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
const JWT=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i;
const EMAIL=/^[^@\s<>]{1,64}@[^@\s<>]{1,190}$/;
const ORIGIN=/^https:\/\/(?:[a-z0-9-]+\.pages\.dev|fftt-staff\.clslifestyle\.com)$/;
const cors=origin=>({'content-type':'application/json','cache-control':'no-store','vary':'Origin',
  'access-control-allow-origin':origin});
const reply=(status,code,origin,extra={})=>new Response(JSON.stringify({code,...extra}),{status,headers:cors(origin)});
const err=(status,code)=>({status,code});
function safeName(value) {
  const v=typeof value==='string'?value.trim():'';
  return v.length>=2&&v.length<=120&&!/[\r\n<>{}\u0000-\u001f]/.test(v)?v:null;
}
export function createStaffDirectoryHandler({env={},fetchImpl=fetch}={}) {
  const {STAFF_ORIGIN, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ADMIN_SECRET, STAFF_INVITE_REDIRECT_ENABLED}=env;
  const configured=ORIGIN.test(STAFF_ORIGIN??'')&&SUPABASE_URL===C3_HOST
    &&/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(SUPABASE_PUBLISHABLE_KEY??'')
    &&typeof SUPABASE_ADMIN_SECRET==='string'&&SUPABASE_ADMIN_SECRET.length>32;
  async function request(path,token,method='GET',body=null,admin=false){
    const key=admin?SUPABASE_ADMIN_SECRET:SUPABASE_PUBLISHABLE_KEY;
    // The host is hard-pinned. No URL from the browser is ever used for server egress.
    const res=await fetchImpl(C3_HOST+path,{method,redirect:'manual',
      headers:{apikey:key,...(admin&&key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+(admin?key:token)}),Accept:'application/json',
        ...(body===null?{}:{'Content-Type':'application/json'})},
      ...(body===null?{}:{body:JSON.stringify(body)})});
    return res;
  }
  async function checkedJson(res){
    if(!res||res.status!==200) throw err(res?.status===401?401:503,'unavailable');
    try{return await res.json();}catch{throw err(503,'unavailable');}
  }
  async function authorize(token,eventId){
    const user=await checkedJson(await request('/auth/v1/user',token));
    if(!UUID.test(user?.id??'')||user?.is_anonymous===true)throw err(401,'unauthorized');
    const role=await checkedJson(await request('/rest/v1/rpc/fftt_staff_role_v1',token,'POST',{p_event_id:eventId}));
    if(role!=='organizer')throw err(403,'forbidden');
    // Account administration is not delegated merely because someone is a scorer or an event manager.
    const events=await checkedJson(await request('/rest/v1/rpc/fftt_my_events_v4',token,'POST',{}));
    if(!Array.isArray(events)||!events.some(e=>e.event_id===eventId&&e.role==='organizer'&&e.can_create===true))
      throw err(403,'forbidden');
  }
  async function accounts(){
    const users=[];
    for(let page=1;page<=10;page++){
      const r=await checkedJson(await request('/auth/v1/admin/users?per_page=100&page='+page,null,'GET',null,true));
      if(!Array.isArray(r.users)||r.users.length>100)throw err(503,'unavailable');
      users.push(...r.users);
      if(r.users.length<100)break;
      if(page===10)throw err(503,'unavailable'); // fail rather than deliver a misleading partial directory
    }
    return users;
  }
  async function patch(id,metadata){
    const res=await request('/auth/v1/admin/users/'+encodeURIComponent(id),null,'PUT',
      {app_metadata:metadata},true);
    if(res.status!==200)throw err(503,'unavailable');
  }
  return async function handle(req){
    if(!configured||typeof fetchImpl!=='function')return reply(503,'not-configured',STAFF_ORIGIN||'');
    const origin=req.headers.get('origin');
    if(origin!==STAFF_ORIGIN||new URL(req.url).origin!==STAFF_ORIGIN)return reply(403,'forbidden',STAFF_ORIGIN);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors(STAFF_ORIGIN),
      'access-control-allow-methods':'POST','access-control-allow-headers':'authorization, content-type'}});
    if(req.method!=='POST')return reply(405,'method-not-allowed',STAFF_ORIGIN);
    const auth=req.headers.get('authorization')||'';
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!JWT.test(token)||token.length>10000)return reply(401,'unauthorized',STAFF_ORIGIN);
    if(!/^application\/json\b/i.test(req.headers.get('content-type')||''))return reply(415,'unsupported',STAFF_ORIGIN);
    let body;
    try{const raw=await req.text();if(raw.length>2048)return reply(413,'too-large',STAFF_ORIGIN);body=JSON.parse(raw);}catch{return reply(400,'invalid',STAFF_ORIGIN);}
    if(!body||Array.isArray(body)||typeof body!=='object'
      ||!['list','add','archive'].includes(body.action)||!UUID.test(body.event_id??'')
      ||Object.keys(body).some(k=>!['action','event_id','name','email'].includes(k))
      ||(body.action==='list'&&('email'in body||'name'in body))
      ||(body.action==='archive'&&'name'in body)
      ||(body.action==='add'&&!safeName(body.name))
      ||(body.action!=='list'&&(typeof body.email!=='string'||!EMAIL.test(body.email))))
      return reply(400,'invalid',STAFF_ORIGIN);
    try{
      await authorize(token,body.event_id);
      const all=await accounts();
      if(body.action==='list'){
        const people=all.filter(u=>u.app_metadata?.fftt_staff_directory===true&&u.deleted_at==null)
          .map(u=>({email:String(u.email||'').toLowerCase(),name:String(u.app_metadata?.fftt_staff_name||u.email||'').slice(0,120),
            verified:!!u.email_confirmed_at,provisioned:true}))
          .filter(p=>EMAIL.test(p.email)).slice(0,200);
        return reply(200,'ok',STAFF_ORIGIN,{people});
      }
      const email=body.email.toLowerCase();
      let user=all.find(u=>String(u.email||'').toLowerCase()===email&&u.deleted_at==null);
      if(body.action==='archive'){
        if(!user)return reply(200,'ok',STAFF_ORIGIN,{status:'archived'});
        await patch(user.id,{...user.app_metadata,fftt_staff_directory:false});
        return reply(200,'ok',STAFF_ORIGIN,{status:'archived'});
      }
      let status='existing';
      if(!user){
        // An incorrect Auth redirect silently falls back to the Supabase Site URL. Gate until the allowed
        // Staff invite callback URL has been verified in Supabase Auth redirect settings.
        if(STAFF_INVITE_REDIRECT_ENABLED!=='true')throw err(503,'invite-not-configured');
        const target=STAFF_ORIGIN+'/app/staff-invite.html';
        const r=await request('/auth/v1/invite?redirect_to='+encodeURIComponent(target),null,'POST',{email,data:{name:body.name}},true);
        if(r.status===429)throw err(429,'rate-limited');
        if(r.status!==200)throw err(503,'invite-not-confirmed');
        try{user=await r.json();}catch{throw err(503,'invite-not-confirmed');}
        if(user?.user)user=user.user;
        status='invited';
      }
      if(!UUID.test(user?.id??''))throw err(503,'invite-not-confirmed');
      await patch(user.id,{...user.app_metadata,fftt_staff_directory:true,fftt_staff_name:body.name});
      return reply(200,'ok',STAFF_ORIGIN,{status});
    }catch(e){
      return reply(e?.status===403?403:e?.status===401?401:e?.status===429?429:503,
        e?.code==='invite-not-confirmed'?'invite-not-confirmed':e?.status===429?'rate-limited':'unavailable',STAFF_ORIGIN);
    }
  };
}
