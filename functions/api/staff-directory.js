/** Pages Function entrypoint; never bundled into the public static Staff or Spectator sites. */
import {createStaffDirectoryHandler} from '../../server/staff_directory/handler.mjs';
export function onRequest(context){
  return createStaffDirectoryHandler({env:context.env,fetchImpl:fetch})(context.request);
}
