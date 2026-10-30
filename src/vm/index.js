'use strict';

/**
 * @module vm
 * @description Virtual Machine & Time-Travel Debugger subsystem:
 *   - Bytecode instruction set & compiler
 *   - 32-bit Shadow Memory with bounds & safety tracking
 *   - Reversible Execution History
 *   - Virtual Machine execution engine
 */

const {
  Opcode,
  OpcodeNames,
  BytecodeInstruction,
  BytecodeProgram,
  BytecodeCompiler,
} = require('./bytecode');

const {
  AllocationRecord,
  ShadowMemory,
} = require('./shadow-memory');

const {
  StepRecord,
  ExecutionHistory,
} = require('./history');

const { VM } = require('./vm');

/**
 * Convenience helper: Compile Lowered IR functions directly to bytecode and run in VM.
 * @param {import('../ir/lowered-ir').LoweredFunction[]} loweredFunctions
 * @returns {{ vm: VM, program: BytecodeProgram, result: { returnValue: number, stdout: string[], steps: number, violations: string[] } }}
 */
function executeBytecode(loweredFunctions) {
  const compiler = new BytecodeCompiler();
  const program = compiler.compile(loweredFunctions);
  const vm = new VM(program);
  const result = vm.run();
  return { vm, program, result };
}

module.exports = {
  Opcode,
  OpcodeNames,
  BytecodeInstruction,
  BytecodeProgram,
  BytecodeCompiler,
  AllocationRecord,
  ShadowMemory,
  StepRecord,
  ExecutionHistory,
  VM,
  executeBytecode,
};
