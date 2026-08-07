import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST=path.resolve('apps/web/dist'); const API={host:'157.245.35.226',port:80};
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  if(req.url.startsWith('/v1')||req.url.startsWith('/docs')){const ch=[];req.on('data',c=>ch.push(c));
    req.on('end',()=>{const body=Buffer.concat(ch);const h={...req.headers,host:API.host};delete h['accept-encoding'];
      const p=http.request({...API,path:req.url,method:req.method,headers:h},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});
      p.on('error',e=>{res.writeHead(502);res.end(String(e));});if(body.length)p.write(body);p.end();});return;}
  let f=path.join(DIST,req.url.split('?')[0]);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){if(path.extname(f)&&path.extname(f)!=='.html'){res.writeHead(404);return res.end('nf');}f=path.join(DIST,'index.html');}
  res.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
}).listen(5199,()=>console.log('preview 5199'));
