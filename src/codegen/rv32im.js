'use strict';

/**
 * @module rv32im
 * @description RISC-V RV32IM Assembly Code Generator and Binary Encoder.
 * Emits standard GNU-assembler compatible assembly text and encodes
 * 32-bit RV32IM machine instructions.
 */

const { CALLEE_SAVED, isPhysicalReg } = require('./mir');

/**
 * Emit RISC-V RV32IM assembly text for a set of MIR functions and globals.
 *
 * @param {import('./mir').MIRFunction[]} mirFunctions
 * @param {object[]} [globals=[]]
 * @returns {string}
 */
function emitAssembly(mirFunctions, globals = []) {
  const lines = [];

  lines.push('  .file "source.c"');
  lines.push('  .attribute arch, "rv32im"');
  lines.push('');

  // Data section
  if (globals.length > 0) {
    lines.push('  .data');
    for (const g of globals) {
      lines.push(`  .globl ${g.name}`);
      lines.push(`  .align 2`);
      lines.push(`${g.name}:`);
      if (typeof g.init === 'number') {
        lines.push(`  .word ${g.init}`);
      } else if (typeof g.init === 'string') {
        lines.push(`  .string "${g.init}"`);
      } else {
        lines.push(`  .zero 4`);
      }
    }
    lines.push('');
  }

  // Text section
  lines.push('  .text');

  for (const fn of mirFunctions) {
    lines.push(`  .globl ${fn.name}`);
    lines.push(`  .type ${fn.name}, @function`);
    lines.push(`${fn.name}:`);

    // Calculate stack frame size
    // 16-byte aligned per RISC-V ABI
    const spillSize = fn.spillBytes || 0;
    const rawFrameSize = 16 + spillSize + 16;
    const frameSize = (rawFrameSize + 15) & ~15;

    // Prologue
    lines.push(`  # -- Function Prologue: ${fn.name} --`);
    lines.push(`  addi sp, sp, -${frameSize}`);
    lines.push(`  sw ra, ${frameSize - 4}(sp)`);
    lines.push(`  sw s0, ${frameSize - 8}(sp)`);
    lines.push(`  addi s0, sp, ${frameSize}`);

    // Function body blocks
    for (const block of fn.blocks) {
      if (block.id && block.id !== 'B0' && block.id !== 'Bentry') {
        lines.push(`.${fn.name}_${block.id}:`);
      }

      for (const ins of block.instructions) {
        lines.push(`  ${ins.toAsm()}`);
      }
    }

    // Epilogue
    lines.push(`.${fn.name}_exit:`);
    lines.push(`  # -- Function Epilogue: ${fn.name} --`);
    lines.push(`  lw ra, ${frameSize - 4}(sp)`);
    lines.push(`  lw s0, ${frameSize - 8}(sp)`);
    lines.push(`  addi sp, sp, ${frameSize}`);
    lines.push(`  ret`);
    lines.push(`  .size ${fn.name}, .-${fn.name}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Binary Instruction Encoders for RV32IM 32-bit machine words.
 */
const REG_NUMBERS = {
  zero: 0, x0: 0,
  ra: 1, x1: 1,
  sp: 2, x2: 2,
  gp: 3, x3: 3,
  tp: 4, x4: 4,
  t0: 5, x5: 5,
  t1: 6, x6: 6,
  t2: 7, x7: 7,
  s0: 8, fp: 8, x8: 8,
  s1: 9, x9: 9,
  a0: 10, x10: 10,
  a1: 11, x11: 11,
  a2: 12, x12: 12,
  a3: 13, x13: 13,
  a4: 14, x14: 14,
  a5: 15, x15: 15,
  a6: 16, x16: 16,
  a7: 17, x17: 17,
  s2: 18, x18: 18,
  s3: 19, x19: 19,
  s4: 20, x20: 20,
  s5: 21, x21: 21,
  s6: 22, x22: 22,
  s7: 23, x23: 23,
  s8: 24, x24: 24,
  s9: 25, x25: 25,
  s10: 26, x26: 26,
  s11: 27, x27: 27,
  t3: 28, x28: 28,
  t4: 29, x29: 29,
  t5: 30, x30: 30,
  t6: 31, x31: 31,
};

function getRegNum(reg) {
  if (typeof reg === 'number') return reg & 31;
  const num = REG_NUMBERS[reg];
  return num !== undefined ? num : 0;
}

function encodeR(funct7, rs2, rs1, funct3, rd, opcode) {
  return ((funct7 & 0x7f) << 25) |
         ((getRegNum(rs2) & 0x1f) << 20) |
         ((getRegNum(rs1) & 0x1f) << 15) |
         ((funct3 & 0x07) << 12) |
         ((getRegNum(rd) & 0x1f) << 7) |
         (opcode & 0x7f);
}

function encodeI(imm, rs1, funct3, rd, opcode) {
  return ((imm & 0xfff) << 20) |
         ((getRegNum(rs1) & 0x1f) << 15) |
         ((funct3 & 0x07) << 12) |
         ((getRegNum(rd) & 0x1f) << 7) |
         (opcode & 0x7f);
}

function encodeS(imm, rs2, rs1, funct3, opcode) {
  const imm11_5 = (imm >> 5) & 0x7f;
  const imm4_0 = imm & 0x1f;
  return (imm11_5 << 25) |
         ((getRegNum(rs2) & 0x1f) << 20) |
         ((getRegNum(rs1) & 0x1f) << 15) |
         ((funct3 & 0x07) << 12) |
         (imm4_0 << 7) |
         (opcode & 0x7f);
}

function encodeB(imm, rs2, rs1, funct3, opcode) {
  const imm12 = (imm >> 12) & 1;
  const imm10_5 = (imm >> 5) & 0x3f;
  const imm4_1 = (imm >> 1) & 0x0f;
  const imm11 = (imm >> 11) & 1;
  return (imm12 << 31) |
         (imm10_5 << 25) |
         ((getRegNum(rs2) & 0x1f) << 20) |
         ((getRegNum(rs1) & 0x1f) << 15) |
         ((funct3 & 0x07) << 12) |
         (imm4_1 << 8) |
         (imm11 << 7) |
         (opcode & 0x7f);
}

/**
 * Encode an MIRInstruction to a 32-bit machine word.
 * @param {import('./mir').MIRInstruction} ins
 * @returns {number} 32-bit unsigned integer instruction word
 */
function encodeInstruction(ins) {
  switch (ins.opcode) {
    // R-type: opcode = 0x33
    case 'add': return encodeR(0x00, ins.src2, ins.src1, 0x0, ins.dest, 0x33);
    case 'sub': return encodeR(0x20, ins.src2, ins.src1, 0x0, ins.dest, 0x33);
    case 'sll': return encodeR(0x00, ins.src2, ins.src1, 0x1, ins.dest, 0x33);
    case 'slt': return encodeR(0x00, ins.src2, ins.src1, 0x2, ins.dest, 0x33);
    case 'xor': return encodeR(0x00, ins.src2, ins.src1, 0x4, ins.dest, 0x33);
    case 'srl': return encodeR(0x00, ins.src2, ins.src1, 0x5, ins.dest, 0x33);
    case 'or':  return encodeR(0x00, ins.src2, ins.src1, 0x6, ins.dest, 0x33);
    case 'and': return encodeR(0x00, ins.src2, ins.src1, 0x7, ins.dest, 0x33);
    case 'mul': return encodeR(0x01, ins.src2, ins.src1, 0x0, ins.dest, 0x33);
    case 'div': return encodeR(0x01, ins.src2, ins.src1, 0x4, ins.dest, 0x33);
    case 'rem': return encodeR(0x01, ins.src2, ins.src1, 0x6, ins.dest, 0x33);

    // I-type arithmetic: opcode = 0x13
    case 'addi': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x0, ins.dest, 0x13);
    case 'slli': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x1, ins.dest, 0x13);
    case 'xori': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x4, ins.dest, 0x13);
    case 'srli': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x5, ins.dest, 0x13);
    case 'ori':  return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x6, ins.dest, 0x13);
    case 'andi': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x7, ins.dest, 0x13);

    // Load: opcode = 0x03
    case 'lw': return encodeI(ins.imm || 0, ins.src1 || 'zero', 0x2, ins.dest, 0x03);

    // Store: opcode = 0x23
    case 'sw': return encodeS(ins.imm || 0, ins.src1, ins.src2 || 'zero', 0x2, 0x23);

    // Branch: opcode = 0x63
    case 'beq': return encodeB(ins.imm || 0, ins.src2 || 'zero', ins.src1 || 'zero', 0x0, 0x63);
    case 'bne': return encodeB(ins.imm || 0, ins.src2 || 'zero', ins.src1 || 'zero', 0x1, 0x63);
    case 'blt': return encodeB(ins.imm || 0, ins.src2 || 'zero', ins.src1 || 'zero', 0x4, 0x63);
    case 'bge': return encodeB(ins.imm || 0, ins.src2 || 'zero', ins.src1 || 'zero', 0x5, 0x63);

    // Pseudo
    case 'mv':  return encodeI(0, ins.src1, 0x0, ins.dest, 0x13); // addi rd, rs1, 0
    case 'li':  return encodeI(ins.imm || 0, 'zero', 0x0, ins.dest, 0x13); // addi rd, zero, imm
    case 'ret': return encodeI(0, 'ra', 0x0, 'zero', 0x67); // jalr zero, 0(ra)

    default:
      return 0x00000013; // nop: addi x0, x0, 0
  }
}

/**
 * Encode an entire MIR function to a Uint32Array of RV32IM machine words.
 */
function encodeFunction(mirFunc) {
  const words = [];
  for (const block of mirFunc.blocks) {
    for (const ins of block.instructions) {
      words.push(encodeInstruction(ins));
    }
  }
  return new Uint32Array(words);
}

module.exports = {
  emitAssembly,
  encodeInstruction,
  encodeFunction,
  REG_NUMBERS,
  getRegNum,
};
