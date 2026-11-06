/** Pages Function entrypoint; never bundled into the public static Staff or Spectator sites. */
import {createStaffDirectoryHandler, createStaffDirectoryState} from '../../server/staff_directory/handler.mjs';
const state = createStaffDirectoryState(); // shared only within this isolate; contains no credentials or contact details
export function onRequest(context){
  return createStaffDirectoryHandler({env:context.env,fetchImpl:fetch,state})(context.request);
}
