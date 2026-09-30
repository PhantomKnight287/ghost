// Webhook receiver for e2e.mjs: keeps every delivery and lists them on GET /deliveries.
import { createServer } from 'node:http';

const deliveries = [];
createServer((req, res) => {
  if (req.method === 'GET') return res.end(JSON.stringify(deliveries));
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    deliveries.push({ headers: req.headers, body: Buffer.concat(chunks).toString('base64') });
    res.end('ok');
  });
}).listen(8080);
