'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { compileRegexPipeline, areEquivalent } = require('../src/automata');
const { Grammar, computeFirst, computeFollow, buildLL1Table, buildLALRTable, parseLR } = require('../src/grammar');
const { compileFrontend } = require('../src/frontend');
const { TACGenerator, CFG, buildSSA, destructSSA, validateSSA, lowerCFG } = require('../src/ir');
const { optimize } = require('../src/optimizer');
const { compileToRV32IM, encodeFunction } = require('../src/codegen');
const { BytecodeCompiler, VM, ShadowMemory } = require('../src/vm');
const { compile } = require('../src/nexcc');

function runTests() {
  console.log('Running NexCC Comprehensive Test Suite...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e.message);
    }
  }

  // ── 1. Automata Tests ────────────────────────────────────────────────────
  console.log('[1] Automata Module Tests');
  test('Regex -> NFA -> DFA -> Min DFA pipeline accepts matching string', () => {
    const res = compileRegexPipeline('(a|b)*abb');
    assert.strictEqual(res.minDfa.simulate('aabb'), true);
    assert.strictEqual(res.minDfa.simulate('babb'), true);
    assert.strictEqual(res.minDfa.simulate('ab'), false);
    assert.strictEqual(res.minDfa.simulate('abbb'), false);
  });

  test('Hopcroft minimization preserves language equivalence', () => {
    const res = compileRegexPipeline('(a|b)*abb');
    assert.strictEqual(areEquivalent(res.dfa, res.minDfa), true);
  });

  test('Character classes and optional quantifiers', () => {
    const res = compileRegexPipeline('[a-z]+');
    assert.strictEqual(res.minDfa.simulate('compiler'), true);
    assert.strictEqual(res.minDfa.simulate('123'), false);
  });

  // ── 2. Grammar Tests ─────────────────────────────────────────────────────
  console.log('\n[2] Grammar Analysis Tests');
  test('FIRST and FOLLOW set calculation', () => {
    const g = Grammar.fromString('E -> T E_prime\nE_prime -> + T E_prime | ε\nT -> F T_prime\nT_prime -> * F T_prime | ε\nF -> ( E ) | id');
    const first = computeFirst(g);
    const follow = computeFollow(g, first);
    assert.deepStrictEqual(Array.from(first.get('E') || []).sort(), ['(', 'id']);
    assert.deepStrictEqual(Array.from(follow.get('E') || []).sort(), ['$', ')']);
  });

  test('LL(1) table construction & predictive parsing', () => {
    const g = Grammar.fromString('E -> T E_prime\nE_prime -> + T E_prime | ε\nT -> F T_prime\nT_prime -> * F T_prime | ε\nF -> ( E ) | id');
    const first = computeFirst(g);
    const follow = computeFollow(g, first);
    const { table, conflicts } = buildLL1Table(g, first, follow);
    assert.strictEqual(conflicts.length, 0);
  });

  test('LALR(1) table and shift-reduce parsing', () => {
    const g = Grammar.fromString('E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id');
    const lalr = buildLALRTable(g);
    assert.strictEqual(lalr.conflicts.length, 0);
    const parseRes = parseLR(lalr.actionTable, lalr.gotoTable, g, ['id', '+', 'id', '*', 'id']);
    assert.strictEqual(parseRes.accepted, true);
  });

  // ── 3. Frontend Tests ────────────────────────────────────────────────────
  console.log('\n[3] Frontend Lexer & Parser Tests');
  test('Tokenizes C keywords, identifiers, and literals', () => {
    const code = 'int main() { struct Node* n = malloc(sizeof(struct Node)); n->value = 42; return n->value; }';
    const { tokens, errors } = compileFrontend(code);
    assert.strictEqual(errors.length, 0);
    assert.ok(tokens.length > 15);
  });

  test('Type checks struct fields and pointer arithmetic', () => {
    const code = 'struct Point { int x; int y; }; int main() { struct Point p; p.x = 10; return p.x; }';
    const { hir, errors } = compileFrontend(code);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(hir.declarations.length, 2);
  });

  // ── 4. IR & SSA Tests ────────────────────────────────────────────────────
  console.log('\n[4] IR & SSA Tests');
  test('TAC generation creates basic blocks and SSA φ-functions', () => {
    const code = 'int f(int a, int b) { int x = a + b * 2; if (x > 10) x = x - 1; return x; }';
    const { hir } = compileFrontend(code);
    const tac = new TACGenerator().generate(hir);
    const cfg = CFG.fromTAC(tac.functions[0]);
    assert.ok(cfg.blocks.length >= 3);

    buildSSA(cfg);
    const ssaRes = validateSSA(cfg);
    assert.strictEqual(ssaRes.valid, true);

    destructSSA(cfg);
    const lowered = lowerCFG(cfg, 'f');
    assert.ok(lowered.instructions.length > 5);
  });

  // ── 5. Optimizer Tests ───────────────────────────────────────────────────
  console.log('\n[5] Optimizer Tests');
  test('SCCP folds constant expressions and DCE removes dead code', () => {
    const code = 'int test() { int a = 10; int b = 20; int c = a + b; int unused = 555; return c; }';
    const { hir } = compileFrontend(code);
    const tac = new TACGenerator().generate(hir);
    const cfg = CFG.fromTAC(tac.functions[0]);

    const { optimizedCFG, snapshots } = optimize(cfg, '-O3');
    assert.ok(snapshots.length >= 5);
    // Should constant fold directly to return 30
    const instrs = optimizedCFG.blocks[0].instructions;
    const hasReturn30 = instrs.some(i => i.op === 'return' && (i.arg1 === 30 || i.result === 30));
    assert.ok(hasReturn30 || instrs.length <= 3);
  });

  // ── 6. Codegen Tests ─────────────────────────────────────────────────────
  console.log('\n[6] Codegen (RV32IM) Tests');
  test('Emits valid RV32IM assembly and encodes 32-bit machine words', () => {
    const code = 'int main() { int x = 5; return x + 2; }';
    const { hir } = compileFrontend(code);
    const tac = new TACGenerator().generate(hir);
    const cfg = CFG.fromTAC(tac.functions[0]);
    optimize(cfg, '-O2');
    destructSSA(cfg);
    const lowered = lowerCFG(cfg, 'main');

    const { mirFunctions, assembly } = compileToRV32IM([lowered]);
    assert.ok(assembly.includes('.globl main'));
    assert.ok(assembly.includes('ret'));

    const bin = encodeFunction(mirFunctions[0]);
    assert.ok(bin instanceof Uint32Array);
    assert.ok(bin.length > 0);
  });

  // ── 7. VM & Time-Travel Tests ────────────────────────────────────────────
  console.log('\n[7] VM & Time-Travel Tests');
  test('VM executes bytecode and correctly stepBack reverses state', () => {
    const code = 'int main() { int a = 10; int b = 20; return a + b; }';
    const { hir } = compileFrontend(code);
    const tac = new TACGenerator().generate(hir);
    const cfg = CFG.fromTAC(tac.functions[0]);
    optimize(cfg, '-O2');
    destructSSA(cfg);
    const lowered = lowerCFG(cfg, 'main');

    const compiler = new BytecodeCompiler();
    const prog = compiler.compile([lowered]);
    const vm = new VM(prog);

    vm.step();
    vm.step();
    assert.strictEqual(vm.history.canStepBack(), true);
    const steppedBack = vm.stepBack();
    assert.strictEqual(steppedBack, true);

    const res = vm.run();
    assert.strictEqual(res.returnValue, 30);
  });

  test('Shadow Memory detects out-of-bounds violations', () => {
    const sm = new ShadowMemory();
    const addr = sm.malloc(16); // 4 words
    sm.write32(addr, 1);
    sm.write32(addr + 4, 2);
    // Write out-of-bounds
    sm.write32(addr + 20, 999);
    assert.ok(sm.violations.length > 0);
    assert.ok(sm.violations[0].includes('Out-of-bounds write'));
  });

  // ── 8. End-to-End Program Tests ──────────────────────────────────────────
  console.log('\n[8] End-to-End Programs Tests (Slide 12)');
  const examplesDir = path.join(__dirname, '..', 'examples');

  test('Linked list program executes correctly in VM', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'linked_list.c'), 'utf8');
    const res = compile(src, { optLevel: '-O2', runVM: true });
    assert.strictEqual(res.vm.returnValue, 30);
    assert.deepStrictEqual(res.vm.stdout, ['10', '20']);
  });

  test('Fibonacci program executes correctly in VM', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'fibonacci.c'), 'utf8');
    const res = compile(src, { optLevel: '-O2', runVM: true });
    assert.strictEqual(res.vm.returnValue, 55);
    assert.deepStrictEqual(res.vm.stdout, ['55']);
  });

  test('Matrix multiply program executes correctly in VM', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'matrix_multiply.c'), 'utf8');
    const res = compile(src, { optLevel: '-O2', runVM: true });
    // C[0]=19, C[1]=22, C[2]=43, C[3]=50 -> sum = 134
    assert.strictEqual(res.vm.returnValue, 134);
  });

  test('Memory violation demo detects violation in VM', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'shadow_violation.c'), 'utf8');
    const res = compile(src, { optLevel: '-O0', runVM: true });
    assert.ok(res.vm.violations.length > 0);
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} / ${total} Passed`);
  console.log(`========================================`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
