'use strict';

/**
 * @module nexcc
 * @description Main unified compiler engine for NexCC.
 * Coordinates all phases from lexing to RV32IM codegen and Bytecode VM simulation:
 *   Source -> Tokens -> AST -> Typed HIR -> TAC -> CFG -> SSA -> Optimizations (-O0..-O3) -> Lowered IR -> MIR -> RV32IM & Bytecode VM
 */

const { Lexer } = require('./frontend/lexer');
const { Parser } = require('./frontend/parser');
const { TypeChecker } = require('./frontend/hir');
const { TACGenerator } = require('./ir/tac');
const { CFG } = require('./ir/cfg');
const { buildSSA, destructSSA, validateSSA } = require('./ir/ssa');
const { lowerCFG } = require('./ir/lowered-ir');
const { optimize } = require('./optimizer/pipeline');
const { compileToRV32IM } = require('./codegen');
const { BytecodeCompiler, VM } = require('./vm');

const { compileRegexPipeline } = require('./automata');
const { Grammar, buildSLRTable, buildCLRTable, buildLALRTable, parseLR } = require('./grammar');

/**
 * Compile source code through the full NexCC pipeline.
 *
 * @param {string} source - C-subset source code
 * @param {object} [options={}]
 * @param {'-O0'|'-O1'|'-O2'|'-O3'} [options.optLevel='-O2']
 * @param {boolean} [options.runVM=true]
 * @returns {object} Full compilation artifacts
 */
function compile(source, options = {}) {
  const optLevel = options.optLevel || '-O2';
  const shouldRunVM = options.runVM !== false;

  // 1. Lexical Analysis
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  // 2. Syntax Analysis
  const parser = new Parser(tokens);
  const ast = parser.parse();

  // 3. Semantic Analysis & Typed HIR
  const typeChecker = new TypeChecker();
  const hir = typeChecker.check(ast);

  // 4. Three-Address Code (TAC) Generation
  const tacGen = new TACGenerator();
  const tac = tacGen.generate(hir);

  // 5. Control Flow Graph (CFG) & Dominator Trees
  const functions = [];
  const loweredFunctions = [];

  for (const fn of tac.functions) {
    const cfg = CFG.fromTAC(fn);

    // Initial SSA Construction
    buildSSA(cfg);
    const ssaValid = validateSSA(cfg);

    // Optimization passes with immutable snapshots
    const { optimizedCFG, snapshots } = optimize(cfg, optLevel);

    // SSA Destruction (Parallel copy insertion & edge split)
    destructSSA(optimizedCFG);

    // Lower to canonical Lowered IR (virtual registers)
    const lowered = lowerCFG(optimizedCFG, fn.name, fn.params);
    loweredFunctions.push(lowered);

    functions.push({
      name: fn.name,
      params: fn.params,
      tacInstructions: fn.instructions.map(i => i.toString()),
      cfgBlocks: cfg.blocks.map(b => ({
        id: b.id,
        label: b.label,
        instructions: b.instructions.map(i => i.toString()),
        successors: b.successors.map(s => s.id),
        predecessors: b.predecessors.map(p => p.id)
      })),
      ssaValid: ssaValid.valid,
      snapshots: snapshots.map(s => ({
        passName: s.passName,
        description: s.description,
        instructionCount: s.instructionCount,
        blockCount: s.blockCount,
        instructionDelta: s.instructionDelta,
        blockDelta: s.blockDelta,
        blocks: s.blocks
      })),
      loweredInstructions: lowered.instructions.map(i => i.toString())
    });
  }

  // 6. Machine Codegen (RV32IM)
  const { mirFunctions, assembly } = compileToRV32IM(loweredFunctions, tac.globals);

  // 7. Interactive Bytecode VM & Time-Travel Simulation
  let vmResult = null;
  let vmHistoryTimeline = [];
  let shadowMemoryState = null;

  if (shouldRunVM && loweredFunctions.length > 0) {
    const bcCompiler = new BytecodeCompiler();
    const bytecodeProg = bcCompiler.compile(loweredFunctions);
    const vm = new VM(bytecodeProg);

    const execResult = vm.run(50000);
    vmHistoryTimeline = vm.history.getTimeline();
    shadowMemoryState = vm.getState();

    vmResult = {
      returnValue: execResult.returnValue,
      stdout: execResult.stdout,
      steps: execResult.steps,
      violations: execResult.violations,
      bytecode: bytecodeProg.instructions.map(i => i.toString())
    };
  }

  return {
    source,
    tokens: tokens.map(t => ({ type: t.type, value: t.value, line: t.line, col: t.col })),
    ast,
    hir,
    functions,
    assembly,
    vm: vmResult,
    vmHistory: vmHistoryTimeline,
    shadowMemory: shadowMemoryState,
    errors: [...parser.errors, ...typeChecker.errors]
  };
}

module.exports = {
  compile,
  compileRegexPipeline,
  Grammar,
  buildSLRTable,
  buildCLRTable,
  buildLALRTable,
  parseLR,
};
