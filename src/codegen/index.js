'use strict';

/**
 * @module codegen
 * @description RISC-V RV32IM Machine Code Generation Subsystem:
 *   - MIR (Machine Intermediate Representation)
 *   - Instruction Selection (Lowered IR -> RV32IM MIR)
 *   - Graph Coloring Register Allocator
 *   - Assembly Emission (.s text)
 *   - Binary Encoding (32-bit machine words)
 *   - Peephole Optimization
 */

const {
  RV32IM_OPCODES,
  VALID_OPCODES,
  REG,
  ALLOCATABLE_REGS,
  CALLEE_SAVED,
  CALLER_SAVED,
  ARG_REGS,
  MIRInstruction,
  MIRBasicBlock,
  MIRFunction,
  selectInstructions,
  freshVReg,
  resetVRegCounter,
  isVirtualReg,
  isPhysicalReg,
} = require('./mir');

const {
  computeLiveness,
  buildInterferenceGraph,
  colorGraph,
  rewriteSpills,
  allocateRegisters,
} = require('./regalloc');

const {
  emitAssembly,
  encodeInstruction,
  encodeFunction,
  REG_NUMBERS,
  getRegNum,
} = require('./rv32im');

const {
  peepholeOptimize,
  peepholeFunction,
} = require('./peephole');

/**
 * Convenience end-to-end codegen helper:
 * Lowered IR -> Instruction Selection -> Peephole -> Regalloc -> Assembly & Binary
 *
 * @param {import('../ir/lowered-ir').LoweredFunction[]} loweredFunctions
 * @param {object[]} [globals=[]]
 * @returns {{ mirFunctions: MIRFunction[], assembly: string }}
 */
function compileToRV32IM(loweredFunctions, globals = []) {
  resetVRegCounter();
  const mirFunctions = selectInstructions(loweredFunctions);

  for (const fn of mirFunctions) {
    peepholeFunction(fn);
    allocateRegisters(fn);
    peepholeFunction(fn);
  }

  const assembly = emitAssembly(mirFunctions, globals);
  return { mirFunctions, assembly };
}

module.exports = {
  RV32IM_OPCODES,
  VALID_OPCODES,
  REG,
  ALLOCATABLE_REGS,
  CALLEE_SAVED,
  CALLER_SAVED,
  ARG_REGS,
  MIRInstruction,
  MIRBasicBlock,
  MIRFunction,
  selectInstructions,
  freshVReg,
  resetVRegCounter,
  isVirtualReg,
  isPhysicalReg,
  computeLiveness,
  buildInterferenceGraph,
  colorGraph,
  rewriteSpills,
  allocateRegisters,
  emitAssembly,
  encodeInstruction,
  encodeFunction,
  REG_NUMBERS,
  getRegNum,
  peepholeOptimize,
  peepholeFunction,
  compileToRV32IM,
};
