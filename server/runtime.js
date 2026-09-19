import path from 'node:path';

export function resolveRuntime(root,env) {
  const render=env.RENDER==='true', production=env.NODE_ENV==='production';
  if(render&&!production)throw new Error('Render exige NODE_ENV=production.');
  const origin=env.APP_ORIGIN || (render ? env.RENDER_EXTERNAL_URL : 'http://127.0.0.1:5173');
  if(!origin)throw new Error('Configure APP_ORIGIN ou RENDER_EXTERNAL_URL.');
  const url=new URL(origin);
  if(url.origin!==origin || url.username || url.password || (production&&url.protocol!=='https:'))throw new Error('Origem de producao deve usar HTTPS sem caminho.');
  const persistentRoot=path.resolve(env.PERSISTENT_ROOT || '/var/data/acores');
  const dataDir=path.resolve(env.DATA_DIR || (render ? path.join(persistentRoot,'data') : path.join(root,'data')));
  const authDir=path.resolve(env.WHATSAPP_AUTH_DIR || (render ? path.join(persistentRoot,'whatsapp') : env.DATA_DIR || production || env.NODE_ENV==='test' ? path.join(dataDir,'auth') : path.join(root,'server','auth')));
  if(render)for(const target of [dataDir,authDir]){
    const relative=path.relative(persistentRoot,target);
    if(!relative || relative.startsWith(`..${path.sep}`) || relative==='..' || path.isAbsolute(relative))throw new Error('Banco e autenticacao devem ficar dentro do disco persistente.');
  }
  const port=Number(env.PORT || (render ? 10000 : 3333));
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT invalida.');
  return {render,origin,persistentRoot,dataDir,authDir,port,host:env.BIND_HOST || (render ? '0.0.0.0' : '127.0.0.1'),trustProxy:env.TRUST_PROXY || (render ? '1' : '')};
}
