import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.WORD_HOST_RUN_DIR;
if (!run) throw new Error('Use python scripts/word-host/run.py to start this test server');
const {createServer} = await import(pathToFileURL(path.join(repo, 'node_modules/vite/dist/node/index.js')));
const certs = path.join(os.homedir(), '.office-addin-dev-certs');
const completed = new Set();
const server = await createServer({
  configFile: false,
  root: repo,
  optimizeDeps: {include: ['@lezer/markdown']},
  server: {
    host: 'localhost', port: Number(process.env.WORD_HOST_PORT), strictPort: true,
    https: {key: fs.readFileSync(path.join(certs, 'localhost.key')), cert: fs.readFileSync(path.join(certs, 'localhost.crt'))},
  },
  plugins: [{
    name: 'word-host-acceptance',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        if (req.url === '/__test/ime') {
          // Read-only development transport. Watch append notifications; do not poll Word or replay history as live input.
          res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'});
          const file = path.join(run, 'native-ime.jsonl');
          let offset = 0, pending = '', initial = true;
          const flush = () => {
            if (!fs.existsSync(file)) return;
            const size = fs.statSync(file).size;
            if (size <= offset) return;
            const fd = fs.openSync(file, 'r');
            try {
              const chunk = Buffer.alloc(size - offset); fs.readSync(fd, chunk, 0, chunk.length, offset); offset = size;
              const lines = (pending + chunk.toString('utf8')).split('\n'); pending = lines.pop();
              const frames = lines.filter(Boolean).map(line => JSON.parse(line));
              if (initial && frames.length) { res.write(`data: ${JSON.stringify({...frames.at(-1), snapshot: true})}\n\n`); initial = false; }
              else for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
            } finally { fs.closeSync(fd); }
          };
          const watcher = fs.watch(run, (_event, name) => { if (String(name) === 'native-ime.jsonl') { try { flush(); } catch { res.destroy(); } } });
          req.on('close', () => watcher.close());
          flush(); return;
        }
        // Commands come only from the local runner's file. There is no HTTP command-submission endpoint.
        if (req.url === '/__test/command') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const command = path.join(run, 'command.json');
          const job = fs.existsSync(command) ? JSON.parse(fs.readFileSync(command, 'utf8')) : null;
          // A task pane reopened with its document must not replay a previously completed mutation command.
          res.end(job && !completed.has(job.id) ? JSON.stringify(job) : 'null');
          return;
        }
        if (req.url === '/__test/result' && req.method === 'POST') {
          try {
            let body = '';
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 8 * 1024 * 1024) throw new Error('Test result exceeds 8 MiB');
            }
            const result = JSON.parse(body);
            fs.appendFileSync(path.join(run, 'results.jsonl'), JSON.stringify(result) + '\n');
            completed.add(result.id);
            res.end('ok');
          } catch (e) { res.statusCode = 400; res.end(String(e)); }
          return;
        }
        next();
      });
    },
  }],
});
await server.listen();
fs.writeFileSync(path.join(run, 'server-ready'), 'ready');
console.log(`Word host acceptance server on ${process.env.WORD_HOST_PORT}`);
