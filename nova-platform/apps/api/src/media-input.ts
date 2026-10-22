import {z} from 'zod';
// Control API/HLS callbacks have no connection UUID: MediaMTX sends JSON null.
export const mediaAuthorizationInput=z.object({
  user:z.string().max(300).nullish(),password:z.string().max(500).nullish(),
  token:z.string().max(5000).nullish(),ip:z.string().nullish(),
  action:z.enum(['publish','read','playback','api','metrics','pprof']),
  path:z.string().max(200).nullish(),protocol:z.string().nullish(),
  id:z.string().uuid().nullish(),query:z.string().max(6000).nullish()
});
