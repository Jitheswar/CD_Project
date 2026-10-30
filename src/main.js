/**
 * NexCC — Interactive Optimizing Compiler & Compiler Construction Workbench
 * Main Entry Point
 */

'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../config/default.json');
const { compile } = require('./nexcc');
const { compileRegexPipeline } = require('./automata');
const { Grammar, computeFirst, computeFollow, buildLALRTable, parseLR } = require('./grammar');
const { createServer } = require('./server');

async function main() {
  console.log('================================================================');
  console.log('  NexCC — Interactive Optimizing Compiler & Workbench');
  console.log('  Department of CSE · A.Y. 2026 - 2027');
  console.log('  Students: N. Rithvik Sai & Ch. Jitheswar');
  console.log('  Guide:    Dr. Krishna Kishore');
  console.log('================================================================\n');

  // 1. Automata Demonstration
  console.log('--- [1] Automata Theory Lab: Regex -> NFA -> DFA -> Minimized DFA ---');
  const regexPattern = '(a|b)*abb';
  const autoRes = compileRegexPipeline(regexPattern);
  console.log(`Pattern: "${regexPattern}"`);
  console.log(`NFA States: ${autoRes.nfa.getStates().length}`);
  console.log(`DFA States: ${autoRes.dfa.states.size}`);
  console.log(`Minimized DFA States: ${autoRes.minDfa.states.size}`);
  console.log(`Simulate "aabb": ${autoRes.minDfa.simulate('aabb') ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`Simulate "abab": ${autoRes.minDfa.simulate('abab') ? 'ACCEPTED' : 'REJECTED'}\n`);

  // 2. Grammar Analysis Demonstration
  console.log('--- [2] Grammar Construction Lab: FIRST/FOLLOW & LALR(1) Parsing ---');
  const grammarText = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
  const g = Grammar.fromString(grammarText);
  const first = computeFirst(g);
  const follow = computeFollow(g, first);
  console.log(`Grammar:\n${grammarText}`);
  console.log(`FIRST(E):  { ${Array.from(first.get('E') || []).join(', ')} }`);
  console.log(`FOLLOW(E): { ${Array.from(follow.get('E') || []).join(', ')} }`);
  const lalr = buildLALRTable(g);
  console.log(`LALR(1) States: ${lalr.itemSets.length}, Conflicts: ${lalr.conflicts.length}`);
  const parseRes = parseLR(lalr.actionTable, lalr.gotoTable, g, ['id', '+', 'id', '*', 'id']);
  console.log(`Parse trace for "id + id * id": ${parseRes.accepted ? 'ACCEPTED' : 'REJECTED'} in ${parseRes.trace.length} steps\n`);

  // 3. Full Compiler Pipeline Demonstration (Linked List C-subset)
  console.log('--- [3] End-to-End Compiler Pipeline: Linked List (Slide 4) ---');
  const linkedListCode = fs.readFileSync(path.join(__dirname, '..', 'examples', 'linked_list.c'), 'utf8');
  const compRes = compile(linkedListCode, { optLevel: '-O2', runVM: true });
  console.log(`Tokens Recognized: ${compRes.tokens.length}`);
  console.log(`AST Declarations:  ${compRes.ast.declarations.length}`);
  console.log(`TAC Functions:     ${compRes.functions.length}`);
  console.log(`Optimization:      ${compRes.functions[0].snapshots.length} pass snapshots recorded`);
  console.log(`VM Stdout Output:  ${JSON.stringify(compRes.vm.stdout)}`);
  console.log(`VM Return Value:   ${compRes.vm.returnValue}`);
  console.log(`Shadow Violations: ${compRes.vm.violations.length === 0 ? 'None (Clean Memory)' : compRes.vm.violations.join(', ')}\n`);

  // 4. Start Interactive Web Workbench Server
  const port = config.port || 3000;
  const webApp = createServer(port);
  const url = await webApp.start();
  console.log('================================================================');
  console.log(`🚀 NexCC Interactive Web Workbench is running at:`);
  console.log(`   ${url}`);
  console.log('================================================================');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

module.exports = { main };
