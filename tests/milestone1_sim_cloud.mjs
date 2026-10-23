/** In-process GoTrue/PostgREST-shaped disposable cloud for Milestone 1 acceptance tests.
 * Fictional data only. Reached solely through an injected fetch: NO socket, host
 * lookup, hosted project, email, or real credential is ever used. The real
 * PKCE guard, transports and sessions run against it, so server behaviors the
 * clients must survive (single-use codes, revocation, stale versions, dropped
 * responses) are enforced HERE, not trusted from the client under test.
 */
import {createHash,randomUUID} from 'node:crypto';
export const HOST='https://copmkalfkkrkzheohwuc.supabase.co';
export const EVENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_EVENT='abababab-abab-4aba-8aba-abababababab';
const b64=o=>Buffer.from(typeof o==='string'?o:JSON.stringify(o)).toString('base64url');
const PRIVATE_CANARIES=Object.freeze(['canary-contact@private.invalid','734-555-0199','CANARY-RATING-4']);
export {PRIVATE_CANARIES};
const uid=n=>{const h=n.toString(16).padStart(8,'0');return `${h}-1111-4111-8111-${h.padStart(12,'0')}`;};
const res=(status,body,headers={})=>({status,json:async()=>body,
 headers:{get:k=>headers[String(k).toLowerCase()]??null}});
export function createSimCloud({clock={t:1_700_000_000_000}}={}){
 const now=()=>clock.t;
 const users=new Map(),byEmail=new Map(),grants=new Map(),tokens=new Map();
 const links=new Map(),codes=new Map(),lastLink=new Map(),events=new Map();
 const families=new Map(),refreshTokens=new Map(),emailCodes=new Map(),attempts=new Map();
 const log=[],clients=new Map();
 let seq=1000;
 const addUser=(email,password)=>{const id=uid(++seq);users.set(id,{id,email,password,revokedBefore:0});byEmail.set(email,id);return id;};
 /** Sliding-window limiter; returns seconds to wait (0 = allowed). Counts every call. */
 const limited=(key,max,windowMs)=>{
  const hits=(attempts.get(key)??[]).filter(t=>now()-t<windowMs);
  hits.push(now());attempts.set(key,hits);
  return hits.length>max?Math.max(1,Math.ceil((hits[0]+windowMs-now())/1000)):0;
 };
 const player=(n,name)=>({id:uid(n),name,contact:PRIVATE_CANARIES[0],phone:PRIVATE_CANARIES[1],rating:PRIVATE_CANARIES[2]});
 const mkEvent=(id,pairs)=>{
  const e={id,name:'Synthetic Fellowship Open',date:'2099-01-01',revision:1,generation:1,
   lifecycle:'active',published:false,matches:new Map(),decisions:new Map()};
  pairs.forEach(([a,b],i)=>{
   e.matches.set(uid(5000+i),{id:uid(5000+i),code:`C-0-${i}`,version:0,status:'pending',
    bracket:'championship',round:0,slot:i,p1:player(10+i*2,a),p2:player(11+i*2,b),
    winner:null,scores:''});
  });
  events.set(id,e);return e;
 };
 mkEvent(EVENT,[['Ada Quill','Bo Marsh'],['Cy Dunn','Dee Reeve']]);
 mkEvent(OTHER_EVENT,[['Eli Fox','Fay Gold']]);
 const authUser=(token)=>{
  const t=tokens.get(token);if(!t)return null;
  const u=users.get(t.userId);
  if(!u||now()>=t.expiresAt||t.issuedAt<u.revokedBefore)return null;
  return {user:u,reported:t.reportAs??u.id,family:t.family??null};
 };
 const role=(userId,eventId)=>grants.get(userId+'|'+eventId)??null;
 const bearer=init=>(init?.headers?.Authorization||'').replace(/^Bearer /,'');
 function mintToken(userId,family=null){
  const token=`${b64('{"alg":"HS256"}')}.${b64({sub:userId,n:++seq})}.${b64('sig'+seq)}`;
  tokens.set(token,{userId,family,issuedAt:now(),expiresAt:now()+api.jwtTtlMs});return token;
 }
 const newFamily=userId=>{const f={id:'f'+(++seq),userId,revoked:false,created:now()};families.set(f.id,f);return f;};
 /** A GoTrue-shaped session: short access JWT plus a rotating refresh token. */
 function issue(family){
  const refresh='r'+(++seq).toString(36)+randomUUID().replace(/-/g,'').slice(0,10);
  refreshTokens.set(refresh,{family:family.id,usedAt:null,child:null});
  return {access_token:mintToken(family.userId,family.id),token_type:'bearer',
   expires_in:Math.floor(api.jwtTtlMs/1000),refresh_token:refresh,
   user:{id:family.userId,email:users.get(family.userId).email}};
 }
 const familyAlive=f=>f&&!f.revoked&&f.created>=users.get(f.userId).revokedBefore;
 const deskRows=(e)=>[...e.matches.values()].filter(m=>m.status==='pending').map(m=>({
  event_id:e.id,bracket_generation:e.generation,match_id:m.id,match_code:m.code,
  match_version:m.version,bracket:m.bracket,round_number:m.round,slot:m.slot,
  player_1_id:m.p1.id,player_2_id:m.p2.id,player_1_name:m.p1.name,player_2_name:m.p2.name,
  is_championship_final:false,table_number:1}));
 const publicRows=()=>[...events.values()].filter(e=>e.published).map(e=>({
  event_id:e.id,event_name:e.name,event_date:e.date,status:e.lifecycle,
  updated_at:new Date(now()).toISOString(),
  brackets:[{name:'championship',matches:[...e.matches.values()].map(m=>({
   match_id:m.code,bracket:'championship',round:m.round,slot:m.slot,
   player_1_name:m.p1.name,player_2_name:m.p2.name,
   winner_name:m.winner,game_scores:m.scores,status:m.status}))}]}));
 async function handle(client,url,init){
  const u=new URL(url),path=u.pathname,method=init?.method||'GET';
  log.push({client,method,path,authz:Boolean(init?.headers?.Authorization)});
  if(!url.startsWith(HOST+'/'))throw new TypeError('sim: unexpected origin');
  if(!init?.headers?.apikey)return res(401,{});
  const forced=clients.get(client).failNext.get(path);
  if(forced){clients.get(client).failNext.delete(path);return res(forced.status,{},forced.headers);}
  await api.hooks.before?.(path,client);
  const body=init?.body?JSON.parse(init.body):null;
  if(path==='/auth/v1/signup')return res(422,{error_code:'signup_disabled'});
  if(path==='/auth/v1/token'&&u.search==='?grant_type=password'){
   const email=String(body?.email||'').toLowerCase();
   const wait=limited('ip|'+client,12,300_000)||limited('pw|'+email,5,60_000);
   if(wait)return res(429,{error_code:'over_request_rate_limit'},{'retry-after':String(wait)});
   const id=byEmail.get(email),usr=id&&users.get(id);
   // identical answer for an unknown account and a wrong password
   if(!usr||usr.password===undefined||usr.password!==body.password)return res(400,{error_code:'invalid_credentials'});
   return res(200,issue(newFamily(id)));
  }
  if(path==='/auth/v1/token'&&u.search==='?grant_type=refresh_token'){
   const rec=refreshTokens.get(body?.refresh_token),fam=rec&&families.get(rec.family);
   if(!rec||!familyAlive(fam))return res(400,{error_code:'refresh_token_not_found'});
   if(rec.usedAt!==null){
    if(now()-rec.usedAt<=10_000&&rec.child){ // GoTrue's reuse interval
     return res(200,{access_token:mintToken(fam.userId,fam.id),token_type:'bearer',
      expires_in:Math.floor(api.jwtTtlMs/1000),refresh_token:rec.child,
      user:{id:fam.userId,email:users.get(fam.userId).email}});
    }
    fam.revoked=true; // stolen-or-duplicated refresh token: the whole family dies
    return res(400,{error_code:'refresh_token_already_used'});
   }
   if(api.forceRefreshUser)fam.userId=api.forceRefreshUser; // models an identity switch behind the token
   rec.usedAt=now();const out=issue(fam);rec.child=out.refresh_token;
   if(api.lieRefreshUserId)out.user.id=api.lieRefreshUserId; // response names someone else; the token is still valid
   return res(200,out);
  }
  if(path==='/auth/v1/logout'){
   const a=authUser(bearer(init));if(!a)return res(401,{});
   const scope=u.searchParams.get('scope')||'global';
   if(scope==='global'){for(const f of families.values())if(f.userId===a.user.id)f.revoked=true;}
   else if(a.family)families.get(a.family).revoked=true;
   return res(204,null);
  }
  if(path==='/auth/v1/verify'){
   const rec=emailCodes.get(body?.email);
   if(!rec||body.type!=='email')return res(400,{error_code:'otp_expired'});
   if(rec.failures>=5)return res(429,{error_code:'over_request_rate_limit'},{'retry-after':'60'});
   if(now()-rec.issuedAt>api.otpTtlMs||rec.code!==body.token){rec.failures++;return res(400,{error_code:'otp_expired'});}
   emailCodes.delete(body.email);
   return res(200,issue(newFamily(byEmail.get(body.email))));
  }
  if(path==='/auth/v1/otp'&&body.code_challenge===undefined){
   if(body.create_user!==false)return res(400,{});
   const id=byEmail.get(body.email);
   if(!id)return res(422,{error_code:'otp_disabled'});
   const wait=lastLink.has('c|'+body.email)&&now()-lastLink.get('c|'+body.email)<60_000;
   if(wait)return res(429,{},{'retry-after':'60'});
   lastLink.set('c|'+body.email,now());
   emailCodes.set(body.email,{code:String(100000+(++seq*7919)%900000),issuedAt:now(),failures:0});
   return res(200,{});
  }
  if(path==='/auth/v1/otp'){
   if(body.create_user!==false||body.code_challenge_method!=='s256')return res(400,{});
   const id=byEmail.get(body.email);
   if(!id)return res(422,{});
   if(lastLink.has(body.email)&&now()-lastLink.get(body.email)<60_000)return res(429,{});
   lastLink.set(body.email,now());
   links.set(body.email,{challenge:body.code_challenge,redirect:u.searchParams.get('redirect_to'),
    userId:id,consumed:false});
   return res(200,{});
  }
  if(path==='/auth/v1/token'&&u.search==='?grant_type=pkce'){
   const c=codes.get(body.auth_code);
   if(!c||c.used||now()-c.issuedAt>300_000)return res(400,{});
   c.used=true;
   const challenge=createHash('sha256').update(body.code_verifier).digest('base64url');
   if(challenge!==c.challenge)return res(400,{});
   const u2=users.get(c.userId);
   return res(200,{access_token:mintToken(c.userId),token_type:'bearer',expires_in:3600,
    refresh_token:'sim-refresh-never-stored',user:{id:c.userId,email:u2.email}});
  }
  if(path==='/auth/v1/user'){
   const a=authUser(bearer(init));if(!a)return res(401,{});
   if(a.family&&!familyAlive(families.get(a.family)))return res(401,{});
   return res(200,{id:a.reported,is_anonymous:false});
  }
  if(path==='/rest/v1/fftt_public_results_v1')return res(200,publicRows());
  if(path.startsWith('/rest/v1/rpc/')){
   const a=authUser(bearer(init));if(!a)return res(401,{});
   const e=events.get(body?.p_event_id);
   const r=e?role(a.user.id,e.id):null;
   if(!r)return res(403,{});
   if(path.endsWith('/fftt_staff_role_v1'))return res(200,r);
   if(path.endsWith('/fftt_matchdesk_v1')){api.hooks.onMatchdesk?.(e);return res(200,deskRows(e));}
   if(path.endsWith('/fftt_score_decision_snapshot_v2'))
    return res(200,{event_id:e.id,revision:e.revision,generation:e.generation,
     lifecycle:e.lifecycle,submission_id:null,decision:null});
  }
  return res(404,{});
 }
 const api={
  EVENT,OTHER_EVENT,log,clock,now,
  /** Test hook: run server-side mutations in the middle of a client read. */
  hooks:{},
  jwtTtlMs:3600_000,otpTtlMs:3600_000,forceRefreshUser:null,lieRefreshUserId:null,
  addUser,
  /** The 6-digit code the person would read from the email (test accessor). */
  peekCode:email=>emailCodes.get(email)?.code??null,
  /** Test accessor: the newest access token minted for a user. */
  latestToken:userId=>[...tokens].reverse().find(([,t])=>t.userId===userId)?.[0]??null,
  familyCount:()=>[...families.values()].filter(f=>!f.revoked).length,
  setPassword:(userId,password)=>{users.get(userId).password=password;},
  grant:(userId,eventId,r)=>grants.set(userId+'|'+eventId,r),
  revokeGrant:(userId,eventId)=>grants.delete(userId+'|'+eventId),
  revokeSessions:userId=>{users.get(userId).revokedBefore=now()+1;},
  /** A token that keeps validating but now reports another identity (account change). */
  swapIdentity:(token,otherUserId)=>{tokens.get(token).reportAs=otherUserId;},
  userId:email=>byEmail.get(email),
  event:id=>events.get(id),
  publish:id=>{events.get(id).published=true;},
  /** Simulates the person opening the email link ONCE; the 2nd open is an error redirect. */
  openEmailLink(email){
   const l=links.get(email);if(!l)return null;
   const target=new URL(l.redirect);
   if(l.consumed){target.hash='#error=access_denied&error_code=otp_expired';
    target.searchParams.set('error','access_denied');return target.href;}
   l.consumed=true;
   const code=randomUUID();
   codes.set(code,{userId:l.userId,challenge:l.challenge,issuedAt:now(),used:false});
   const state=target.searchParams.get('state');
   target.search='';target.searchParams.set('code',code);target.searchParams.set('state',state);
   return target.href;
  },
  client(name){
   if(!clients.has(name))clients.set(name,{online:true,failNext:new Map()});
   const c=clients.get(name);
   return {
    fetch:async(url,init)=>{
     if(!c.online)throw new TypeError('sim: network down');
     return handle(name,url,init);
    },
    setOnline:v=>{c.online=v;},
    failNext:(path,status=500,headers={})=>c.failNext.set(path,{status,headers}),
   };
  },
  /** Server-side score decision; idempotent per submission, durable on rejection. */
  submitScore(token,intent){
   const a=authUser(token);if(!a)throw new Error('sim: unauthorized');
   const e=events.get(intent.eventId);
   if(!e||!role(a.user.id,e.id))throw new Error('sim: forbidden');
   const prior=e.decisions.get(intent.submissionId);
   if(prior)return {status:prior.status,revision:prior.eventRevision,generation:e.generation,replay:true};
   const m=e.matches.get(intent.matchId);
   if(!m||intent.bracketGeneration!==e.generation)throw new Error('sim: bad intent');
   let d;
   if(intent.expectedMatchVersion!==m.version||m.status!=='pending'){
    d={id:intent.submissionId,matchId:m.id,status:'rejected',reason:'stale-match-version',
     matchVersion:m.version,eventRevision:e.revision,generation:e.generation,actor:a.user.id};
   }else{
    m.version++;m.status='complete';e.revision++;
    m.winner=intent.winnerId===m.p1.id?m.p1.name:m.p2.name;m.scores=intent.gameScores;
    d={id:intent.submissionId,matchId:m.id,status:'accepted',reason:null,
     matchVersion:m.version,eventRevision:e.revision,generation:e.generation,actor:a.user.id};
   }
   e.decisions.set(intent.submissionId,d);
   return {status:d.status,revision:d.eventRevision,generation:e.generation};
  },
  /** Actor-owned decision snapshot (ScoreSession wire shape). */
  ownSnapshot(token,{eventId,submissionId}){
   const a=authUser(token);if(!a)throw new Error('sim: unauthorized');
   const e=events.get(eventId);
   if(!e||!role(a.user.id,e.id))throw new Error('sim: forbidden');
   const d=submissionId?e.decisions.get(submissionId):null;
   const own=d&&d.actor===a.user.id?{id:d.id,matchId:d.matchId,status:d.status,
    reason:d.reason,matchVersion:d.matchVersion,eventRevision:d.eventRevision,
    generation:d.generation}:null;
   return {eventId:e.id,revision:e.revision,generation:e.generation,lifecycle:e.lifecycle,decision:own};
  },
  scoreSubmitCount:()=>[...events.values()].reduce((n,e)=>n+e.decisions.size,0),
  deskRows:id=>deskRows(events.get(id)),
  tokenFor:(userId)=>mintToken(userId),
 };
 return api;
}
