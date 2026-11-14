import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const key = 'foxton-queue.json';
const conflict = 'A fila mudou. Confira a ordem e tente novamente.';
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request) {
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9-]{36})$/)?.[1];
    if (!token) return json({error:'Identificação inválida.'},401);
    if (!['GET','POST'].includes(request.method)) return json({error:'Método inválido.'},405);
    try {
      const blob = await get(key, {access:'private'});
      const {people, version} = blob
        ? await new Response(blob.stream).json()
        : {people:[],version:0};
      if (request.method === 'GET') {
        return json({version, people:people.map(p=>({name:p.name,mine:p.token===token}))});
      }
      const {action, name, version:expected} = await request.json() ?? {};
      if (expected !== version) return json({error:conflict},409);
      const index = people.findIndex(p=>p.token===token);
      const displayName = typeof name === 'string' ? name.trim() : '';
      if (action==='join' && index===-1 && displayName && displayName.length<=40) {
        if (people.length>=100 || people.some(p=>p.name.toLowerCase()===displayName.toLowerCase())) {
          return json({error:'Fila cheia ou nome já em uso.'},409);
        }
        people.push({token,name:displayName});
      } else if (action==='leave' && index>=0) {
        people.splice(index,1);
      } else if (action==='complete' && index===0) {
        people.push(people.shift());
      } else {
        return json({error:'Essa ação não está disponível para sua posição na fila.'},409);
      }
      await put(key, JSON.stringify({people,version:version+1}), {
        access:'private', contentType:'application/json', addRandomSuffix:false,
        ...(blob ? {allowOverwrite:true,ifMatch:blob.blob.etag} : {allowOverwrite:false})
      });
      return json({ok:true});
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || /already exists/i.test(error.message)) {
        return json({error:conflict},409);
      }
      if (error instanceof SyntaxError) return json({error:'Solicitação inválida.'},400);
      console.error(error.name);
      return json({error:'Fila temporariamente indisponível.'},503);
    }
  }
};
