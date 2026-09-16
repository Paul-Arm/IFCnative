import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const page = new URL('../dist/index.html', import.meta.url);
createServer(async (req, res) => {
  if (!['/', '/index.html'].includes(new URL(req.url, 'http://localhost').pathname)) {
    res.writeHead(404).end(); return;
  }
  try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(await readFile(page)); }
  catch { res.writeHead(500).end('Bitte zuerst npm run build ausführen.'); }
}).listen(5284, '127.0.0.1', () => console.log('VDC-Add-on Vorschau: http://127.0.0.1:5284'));
