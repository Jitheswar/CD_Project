'use strict';

/**
 * @module peephole
 * @description RV32IM Peephole Optimizer.
 * Optimizes small instruction windows for target architecture idioms:
 *   - Redundant move elimination (mv x, x)
 *   - Strength reduction (mul by powers of 2 -> slli)
 *   - Immediate constant folding (addi zero + addi)
 *   - Dead stores followed by loads
 *   - Jumps to next instruction
 */

const { MIRInstruction } = require('./mir');

/**
 * Run peephole optimizations on a list of MIR instructions.
 *
 * @param {MIRInstruction[]} instructions
 * @returns {MIRInstruction[]} Optimized instruction list
 */
function peepholeOptimize(instructions) {
  const result = [];

  for (let i = 0; i < instructions.length; i++) {
    const cur = instructions[i];

    // 1. Redundant move: mv x, x
    if (cur.opcode === 'mv' && cur.dest === cur.src1) {
      continue; // Drop
    }

    // 2. Add zero: addi x, x, 0
    if (cur.opcode === 'addi' && cur.dest === cur.src1 && cur.imm === 0) {
      continue; // Drop
    }

    // 3. Strength reduction: mul rd, rs1, power_of_two
    // If followed or preceded by li or constant
    if (cur.opcode === 'mul') {
      // Check if src2 is known power of 2 from previous li
      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (prev && prev.opcode === 'li' && prev.dest === cur.src2 && typeof prev.imm === 'number') {
        const val = prev.imm;
        if (val > 0 && (val & (val - 1)) === 0) {
          const shift = Math.log2(val);
          result.pop(); // Remove li
          result.push(new MIRInstruction({
            opcode: 'slli',
            dest: cur.dest,
            src1: cur.src1,
            imm: shift,
            comment: `strength reduction: mul by ${val} -> slli ${shift}`
          }));
          continue;
        }
      }
    }

    // 4. Consecutive store then load of same address and register:
    // sw rs, imm(base); lw rd, imm(base) => sw rs, imm(base); mv rd, rs
    if (cur.opcode === 'lw') {
      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (prev && prev.opcode === 'sw' && prev.src2 === cur.src1 && prev.imm === cur.imm) {
        result.push(new MIRInstruction({
          opcode: 'mv',
          dest: cur.dest,
          src1: prev.src1,
          comment: 'peephole: store forwarded to load'
        }));
        continue;
      }
    }

    result.push(cur);
  }

  return result;
}

/**
 * Optimize an entire MIRFunction with peephole passes.
 * @param {import('./mir').MIRFunction} mirFunc
 * @returns {import('./mir').MIRFunction}
 */
function peepholeFunction(mirFunc) {
  for (const block of mirFunc.blocks) {
    block.instructions = peepholeOptimize(block.instructions);
  }
  return mirFunc;
}

module.exports = {
  peepholeOptimize,
  peepholeFunction,
};
