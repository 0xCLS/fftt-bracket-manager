/** The staff-directory Function is optional until explicitly activated; no admin key reaches a browser. */
const EMAIL = /^[^@\s<>]{1,64}@[^@\s<>]{1,190}$/;
export class StaffDirectoryError extends Error {
  constructor(kind='unavailable'){super('Staff directory request failed');this.name='StaffDirectoryError';this.kind=kind;}
}
export function createStaffDirectoryClient({fetchImpl, basePath='/api/staff-directory'}={}) {
  if(typeof fetchImpl!=='function'||basePath!=='/api/staff-directory') throw new StaffDirectoryError('unavailable');
  return Object.freeze({
    async request(token, action, {eventId,name,email}={}) {
      if(typeof token!=='string'||!token.includes('.')||token.length>10000) throw new StaffDirectoryError('forbidden');
      if(!['list','add','archive'].includes(action)) throw new StaffDirectoryError('validation');
      const body={action,event_id:eventId};
      if(action!=='list'){
        if(typeof email!=='string'||!EMAIL.test(email.trim())) throw new StaffDirectoryError('validation');
        body.email=email.trim().toLowerCase();
      }
      if(action==='add'){
        if(typeof name!=='string'||!name.trim()||name.length>120) throw new StaffDirectoryError('validation');
        body.name=name.trim();
      }
      let response;
      try {
        response=await fetchImpl(basePath,{method:'POST',credentials:'omit',cache:'no-store',
          redirect:'error',referrerPolicy:'no-referrer',
          headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify(body)});
      } catch { throw new StaffDirectoryError('network'); }
      if(response.status===401||response.status===403) throw new StaffDirectoryError('forbidden');
      if(response.status===429) throw new StaffDirectoryError('rate-limited');
      if(response.status!==200) throw new StaffDirectoryError('unavailable');
      let result;
      try{result=await response.json();}catch{throw new StaffDirectoryError('malformed');}
      if(!result||typeof result!=='object'||Array.isArray(result)) throw new StaffDirectoryError('malformed');
      if(action==='list'){
        if(!Array.isArray(result.people)||result.people.length>200)throw new StaffDirectoryError('malformed');
        for(const p of result.people){
          if(typeof p.email!=='string'||!EMAIL.test(p.email)||typeof p.name!=='string'||p.name.length>120
            ||typeof p.verified!=='boolean'||typeof p.provisioned!=='boolean') throw new StaffDirectoryError('malformed');
        }
      } else if(result.status!=='existing'&&result.status!=='invited'&&result.status!=='archived') throw new StaffDirectoryError('malformed');
      return result;
    },
  });
}
