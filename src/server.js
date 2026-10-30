'use strict';

/**
 * @module server
 * @description HTTP Web Workbench server for NexCC.
 * Serves the interactive visual workbench and provides REST APIs for
 * compiling, automata transformations, and grammar analysis.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { compile } = require('./nexcc');
const { compileRegexPipeline } = require('./automata');
const {
  Grammar,
  computeFirst,
  computeFollow,
  buildLL1Table,
  parseLL1,
  buildSLRTable,
  buildCLRTable,
  buildLALRTable,
  parseLR,
  actionToString
} = require('./grammar');

function createServer(port = 3000) {
  const publicDir = path.join(__dirname, '..', 'public');

  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // API: /api/compile
    if (req.method === 'POST' && url.pathname === '/api/compile') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const result = compile(payload.source || '', {
            optLevel: payload.optLevel || '-O2',
            runVM: payload.runVM !== false
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message, stack: err.stack }));
        }
      });
      return;
    }

    // API: /api/automata
    if (req.method === 'POST' && url.pathname === '/api/automata') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const pattern = payload.pattern || '[a-z]+';
          const testString = payload.testString || '';

          const { ast, nfa, dfa, minDfa } = compileRegexPipeline(pattern);
          const nfaSim = nfa.simulate(testString);
          const dfaSim = dfa.simulate(testString);
          const minDfaSim = minDfa.simulate(testString);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            pattern,
            testString,
            ast,
            nfa: nfa.toJSON(),
            dfa: dfa.toJSON(),
            minDfa: minDfa.toJSON(),
            simulation: {
              testString,
              nfaAccept: nfaSim,
              dfaAccept: dfaSim,
              minDfaAccept: minDfaSim,
              agrees: (nfaSim === dfaSim) && (dfaSim === minDfaSim)
            }
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // API: /api/grammar
    if (req.method === 'POST' && url.pathname === '/api/grammar') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const grammarText = payload.grammar || 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
          const tokens = payload.tokens || ['id', '+', 'id', '*', 'id'];

          const g = Grammar.fromString(grammarText);
          const first = computeFirst(g);
          const follow = computeFollow(g, first);

          // Serialize first and follow sets
          const firstObj = {};
          for (const [k, v] of first) firstObj[k] = Array.from(v);
          const followObj = {};
          for (const [k, v] of follow) followObj[k] = Array.from(v);

          // LL(1)
          const ll1 = buildLL1Table(g, first, follow);
          const ll1Trace = parseLL1(ll1.table, g, tokens);

          // LR Family
          const slr = buildSLRTable(g, follow);
          const clr = buildCLRTable(g);
          const lalr = buildLALRTable(g);
          const lrTrace = parseLR(lalr.actionTable, lalr.gotoTable, g, tokens);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            terminals: Array.from(g.terminals),
            nonTerminals: Array.from(g.nonTerminals),
            first: firstObj,
            follow: followObj,
            ll1: {
              conflicts: ll1.conflicts,
              isLL1: ll1.conflicts.length === 0,
              trace: ll1Trace.trace,
              accepted: ll1Trace.accepted
            },
            slr: {
              statesCount: slr.itemSets.length,
              conflicts: slr.conflicts
            },
            clr: {
              statesCount: clr.itemSets.length,
              conflicts: clr.conflicts
            },
            lalr: {
              statesCount: lalr.itemSets.length,
              conflicts: lalr.conflicts,
              trace: lrTrace.trace,
              accepted: lrTrace.accepted
            }
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Static files
    let filePath = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(publicDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    });
  });

  return {
    server,
    start: () => new Promise((resolve) => {
      server.listen(port, () => {
        resolve(`http://localhost:${port}`);
      });
    })
  };
}

module.exports = { createServer };
