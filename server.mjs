import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/editor.html' : pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    const data = await readFile(file);
    response.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(8000, () => console.log('P3NROSE editor: http://localhost:8000/editor.html'));
