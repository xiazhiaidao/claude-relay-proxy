const http = require('http');
const https = require('https');
const url = require('url');

const RELAY_TARGET = 'https://tokenrhythm.studio';
const PROXY_PORT = 5678;

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 30000,
});

const STRIP_ALL_BETAS = true;
const BETAS_TO_STRIP = [
  'interleaved-thinking-2025-05-14',
  'interleaved-thinking-2025-08-25',
  'thinking-token-count-2026-05-13',
];

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const targetUrl = new URL(parsed.pathname + (parsed.search || ''), RELAY_TARGET);

  const headers = { ...req.headers };
  headers['host'] = targetUrl.hostname;

  if (headers['anthropic-beta']) {
    if (STRIP_ALL_BETAS) {
      console.log(`[relay-proxy] stripped all betas (was: ${headers['anthropic-beta']})`);
      delete headers['anthropic-beta'];
    } else {
      const kept = headers['anthropic-beta']
        .split(',')
        .map(b => b.trim())
        .filter(b => !BETAS_TO_STRIP.includes(b));
      if (kept.length > 0) {
        headers['anthropic-beta'] = kept.join(',');
      } else {
        delete headers['anthropic-beta'];
      }
    }
  }

  delete headers['content-length'];
  delete headers['connection'];
  delete headers['accept-encoding'];

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    let modifiedBody = body;
    if (body.length > 0 && headers['content-type']?.includes('json')) {
      try {
        const parsed = JSON.parse(body.toString());
        if (parsed.messages) {
          const systemMsgs = [];
          const cleanMessages = [];
          for (const m of parsed.messages) {
            if (m.role === 'system') {
              systemMsgs.push(m);
            } else {
              cleanMessages.push(m);
            }
          }
          if (systemMsgs.length > 0) {
            if (!parsed.system) parsed.system = [];
            else if (typeof parsed.system === 'string') {
              parsed.system = [{ type: 'text', text: parsed.system }];
            }
            for (const sm of systemMsgs) {
              const text = typeof sm.content === 'string' ? sm.content
                : Array.isArray(sm.content) ? sm.content.map(c => c.text || '').join('\n') : '';
              parsed.system.push({ type: 'text', text });
            }
            parsed.messages = cleanMessages;
            console.log(`[relay-proxy] moved ${systemMsgs.length} system msg(s) to system param`);
          }
          console.log(`[relay-proxy] ${req.method} ${req.url} | model=${parsed.model} | messages:`,
            parsed.messages.map(m => `(${m.role})`).join(' '));
          console.log('[relay-proxy] top-level keys:', Object.keys(parsed).join(', '));

          const FIELDS_TO_STRIP = ['metadata', 'thinking', 'context_management', 'output_config'];
          for (const f of FIELDS_TO_STRIP) {
            if (parsed[f] !== undefined) {
              delete parsed[f];
            }
          }

          let strippedThinking = 0;
          for (const m of parsed.messages) {
            if (Array.isArray(m.content)) {
              const before = m.content.length;
              m.content = m.content.filter(c => c.type !== 'thinking');
              strippedThinking += before - m.content.length;
              if (m.content.length === 0) {
                m.content = [{ type: 'text', text: '' }];
              }
            }
          }
          if (strippedThinking > 0) {
            console.log(`[relay-proxy] stripped ${strippedThinking} thinking block(s) from messages`);
          }

          modifiedBody = Buffer.from(JSON.stringify(parsed));
        }
      } catch {}
    }

    if (modifiedBody.length > 0) {
      headers['content-length'] = Buffer.byteLength(modifiedBody);
    }

    const proxyReq = https.request(targetUrl, {
      method: req.method,
      headers: headers,
      agent: keepAliveAgent,
    }, proxyRes => {
      const respHeaders = { ...proxyRes.headers };
      delete respHeaders['content-encoding'];
      const isStream = headers['content-type']?.includes('json') &&
        modifiedBody.length > 0 &&
        JSON.parse(modifiedBody.toString()).stream === true;

      if (isStream && proxyRes.headers['content-type']?.includes('text/event-stream')) {
        delete respHeaders['content-length'];
        res.writeHead(proxyRes.statusCode, respHeaders);

        let sseBuf = '';
        const thinkingIdx = new Set();
        proxyRes.on('data', chunk => {
          sseBuf += chunk.toString();
          const events = sseBuf.split('\n\n');
          sseBuf = events.pop();

          for (const evt of events) {
            if (!evt.trim() || !evt.startsWith('data: ')) {
              res.write(evt + '\n\n');
              continue;
            }
            const jsonStr = evt.slice(6).trim();
            if (jsonStr === '[DONE]') {
              res.write(evt + '\n\n');
              continue;
            }
            try {
              const d = JSON.parse(jsonStr);
              if (d.type === 'content_block_start' && d.content_block?.type === 'thinking') {
                thinkingIdx.add(d.index);
                continue;
              }
              if (d.type === 'content_block_delta' && thinkingIdx.has(d.index)) {
                continue;
              }
              if (d.type === 'content_block_stop' && thinkingIdx.has(d.index)) {
                thinkingIdx.delete(d.index);
                continue;
              }
            } catch {}
            res.write(evt + '\n\n');
          }
        });
        proxyRes.on('end', () => {
          if (sseBuf.trim()) res.write(sseBuf + '\n\n');
          res.end();
        });
      } else if (proxyRes.headers['content-type']?.includes('json')) {
        const rChunks = [];
        proxyRes.on('data', c => rChunks.push(c));
        proxyRes.on('end', () => {
          let rBody = Buffer.concat(rChunks);
          try {
            const rParsed = JSON.parse(rBody.toString());
            if (rParsed.content && Array.isArray(rParsed.content)) {
              const before = rParsed.content.length;
              rParsed.content = rParsed.content.filter(c => c.type !== 'thinking');
              if (rParsed.content.length === 0) {
                rParsed.content = [{ type: 'text', text: '' }];
              }
              if (before !== rParsed.content.length) {
                console.log(`[relay-proxy] stripped ${before - rParsed.content.length} thinking block(s) from response`);
              }
              rBody = Buffer.from(JSON.stringify(rParsed));
            }
          } catch {}
          delete respHeaders['content-length'];
          respHeaders['content-length'] = Buffer.byteLength(rBody);
          res.writeHead(proxyRes.statusCode, respHeaders);
          res.end(rBody);
        });
      } else {
        res.writeHead(proxyRes.statusCode, respHeaders);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', err => {
      console.error(`[relay-proxy] error: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
    });

    if (modifiedBody.length > 0) proxyReq.write(modifiedBody);
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[relay-proxy] listening on http://127.0.0.1:${PROXY_PORT} -> ${RELAY_TARGET}`);
  console.log(`[relay-proxy] keepAlive: true | TCP_NODELAY: true`);

  const warmup = https.request(RELAY_TARGET, { method: 'HEAD', agent: keepAliveAgent }, r => {
    console.log(`[relay-proxy] warmup done (TLS connection established)`);
  });
  warmup.on('error', () => {});
  warmup.end();
});

server.on('connection', socket => socket.setNoDelay(true));
