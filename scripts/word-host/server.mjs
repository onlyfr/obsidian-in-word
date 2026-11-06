import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.WORD_HOST_RUN_DIR;
if (!run) throw new Error('Use python scripts/word-host/run.py to start this test server');
const {createServer} = await import(pathToFileURL(path.join(repo, 'node_modules/vite/dist/node/index.js')));
const certs = path.join(os.homedir(), '.office-addin-dev-certs');
const server = await createServer({
  configFile: false,
  root: repo,
  server: {
    host: 'localhost', port: Number(process.env.WORD_HOST_PORT), strictPort: true,
    https: {key: fs.readFileSync(path.join(certs, 'localhost.key')), cert: fs.readFileSync(path.join(certs, 'localhost.crt'))},
  },
  plugins: [{
    name: 'word-host-acceptance',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        // Commands come only from the local runner's file. There is no HTTP command-submission endpoint.
        if (req.url === '/__test/command') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const command = path.join(run, 'command.json');
          res.end(fs.existsSync(command) ? fs.readFileSync(command, 'utf8') : 'null');
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
