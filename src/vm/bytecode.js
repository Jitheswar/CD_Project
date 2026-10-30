'use strict';

/**
 * @module bytecode
 * @description Virtual machine bytecode instruction format and compiler.
 * Lowers canonical Lowered IR into compact bytecode instructions.
 */

const Opcode = Object.freeze({
  // Arithmetic & Bitwise
  ADD: 0x01, SUB: 0x02, MUL: 0x03, DIV: 0x04, MOD: 0x05,
  NEG: 0x06, NOT: 0x07, AND: 0x08, OR:  0x09, XOR: 0x0A,
  SHL: 0x0B, SHR: 0x0C,

  // Comparison
  LT: 0x10, LE: 0x11, GT: 0x12, GE: 0x13, EQ: 0x14, NE: 0x15,

  // Memory & Load/Store
  LOAD: 0x20, STORE: 0x21, LOAD_IMM: 0x22, LOAD_ADDR: 0x23,
  LOAD8: 0x24, STORE8: 0x25,

  // Control Flow
  JMP: 0x30, JMP_IF: 0x31, JMP_IF_NOT: 0x32, CALL: 0x33, RET: 0x34,

  // Register moves
  MOV: 0x40, PUSH: 0x41, POP: 0x42,

  // Runtime Built-ins
  PRINT_INT: 0x50, PRINT_STR: 0x51, MALLOC: 0x52, FREE: 0x53,

  // System
  HALT: 0xFF,
});

const OpcodeNames = Object.fromEntries(
  Object.entries(Opcode).map(([k, v]) => [v, k])
);

class BytecodeInstruction {
  /**
   * @param {number} opcode
   * @param {number} rDest - Destination register (0..255)
   * @param {number} rSrc1 - Source register 1 (0..255)
   * @param {number} rSrc2 - Source register 2 (0..255)
   * @param {number} imm   - Immediate constant value
   * @param {object} [meta={}]
   */
  constructor(opcode, rDest = 0, rSrc1 = 0, rSrc2 = 0, imm = 0, meta = {}) {
    this.opcode = opcode;
    this.rDest = rDest;
    this.rSrc1 = rSrc1;
    this.rSrc2 = rSrc2;
    this.imm = imm;
    this.meta = meta;
  }

  toString() {
    const name = OpcodeNames[this.opcode] || `OP_${this.opcode.toString(16)}`;
    return `${name.padEnd(10)} r${this.rDest}, r${this.rSrc1}, r${this.rSrc2}, imm=${this.imm}`;
  }
}

class BytecodeProgram {
  constructor(instructions = [], stringTable = [], functionTable = new Map()) {
    this.instructions = instructions;
    this.stringTable = stringTable;
    this.functionTable = functionTable;
  }
}

class BytecodeCompiler {
  constructor() {
    this.stringTable = [];
    this.functionTable = new Map(); // funcName -> instruction offset
  }

  _parseReg(regStr) {
    if (typeof regStr === 'number') return null; // literal
    if (typeof regStr === 'string' && regStr.startsWith('v')) {
      return parseInt(regStr.slice(1), 10) & 255;
    }
    return 0;
  }

  /**
   * Compile LoweredFunctions into an executable BytecodeProgram.
   * @param {import('../ir/lowered-ir').LoweredFunction[]} loweredFunctions
   * @returns {BytecodeProgram}
   */
  compile(loweredFunctions) {
    const allInstructions = [];
    const labelOffsets = new Map(); // labelName -> instruction index
    const pendingFixups = [];       // { instIndex, targetLabel }

    for (const fn of loweredFunctions) {
      this.functionTable.set(fn.name, allInstructions.length);

      for (const ir of fn.instructions) {
        if (ir.op === 'label') {
          const lbl = ir.metadata && ir.metadata.label;
          if (lbl) labelOffsets.set(lbl, allInstructions.length);
          continue;
        }

        const rDest = this._parseReg(ir.dest) || 0;
        const rSrc1 = this._parseReg(ir.src1) || 0;
        const rSrc2 = this._parseReg(ir.src2) || 0;

        const isNum1 = typeof ir.src1 === 'number';
        const isNum2 = typeof ir.src2 === 'number';

        if (isNum1 && isNum2) {
          let folded = null;
          switch (ir.op) {
            case 'add': folded = (ir.src1 + ir.src2) | 0; break;
            case 'sub': folded = (ir.src1 - ir.src2) | 0; break;
            case 'mul': folded = Math.imul(ir.src1, ir.src2); break;
            case 'div': folded = ir.src2 !== 0 ? ((ir.src1 / ir.src2) | 0) : 0; break;
            case 'mod': folded = ir.src2 !== 0 ? (ir.src1 % ir.src2) : 0; break;
            case 'lt':  folded = ir.src1 < ir.src2 ? 1 : 0; break;
            case 'le':  folded = ir.src1 <= ir.src2 ? 1 : 0; break;
            case 'gt':  folded = ir.src1 > ir.src2 ? 1 : 0; break;
            case 'ge':  folded = ir.src1 >= ir.src2 ? 1 : 0; break;
            case 'eq':  folded = ir.src1 === ir.src2 ? 1 : 0; break;
            case 'ne':  folded = ir.src1 !== ir.src2 ? 1 : 0; break;
          }
          if (folded !== null) {
            allInstructions.push(new BytecodeInstruction(Opcode.LOAD_IMM, rDest, 0, 0, folded, ir.metadata));
            continue;
          }
        }

        let effSrc1 = rSrc1;
        if (isNum1) {
          allInstructions.push(new BytecodeInstruction(Opcode.LOAD_IMM, 254, 0, 0, ir.src1, ir.metadata));
          effSrc1 = 254;
        }
        const effSrc2 = isNum2 ? 0 : rSrc2;
        const effImm = isNum2 ? ir.src2 : (isNum1 ? ir.src1 : 0);
        const imm = effImm;

        switch (ir.op) {
          case 'add':
            allInstructions.push(new BytecodeInstruction(Opcode.ADD, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'sub':
            allInstructions.push(new BytecodeInstruction(Opcode.SUB, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'mul':
            allInstructions.push(new BytecodeInstruction(Opcode.MUL, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'div':
            allInstructions.push(new BytecodeInstruction(Opcode.DIV, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'mod':
            allInstructions.push(new BytecodeInstruction(Opcode.MOD, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'lt':
            allInstructions.push(new BytecodeInstruction(Opcode.LT, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'le':
            allInstructions.push(new BytecodeInstruction(Opcode.LE, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'gt':
            allInstructions.push(new BytecodeInstruction(Opcode.GT, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'ge':
            allInstructions.push(new BytecodeInstruction(Opcode.GE, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'eq':
            allInstructions.push(new BytecodeInstruction(Opcode.EQ, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'ne':
            allInstructions.push(new BytecodeInstruction(Opcode.NE, rDest, effSrc1, effSrc2, effImm, ir.metadata));
            break;

          case 'copy':
            if (typeof ir.src1 === 'number') {
              allInstructions.push(new BytecodeInstruction(Opcode.LOAD_IMM, rDest, 0, 0, ir.src1, ir.metadata));
            } else {
              allInstructions.push(new BytecodeInstruction(Opcode.MOV, rDest, rSrc1, 0, 0, ir.metadata));
            }
            break;

          case 'load':
            allInstructions.push(new BytecodeInstruction(Opcode.LOAD, rDest, rSrc1, 0, (ir.metadata && ir.metadata.offset) || 0, ir.metadata));
            break;

          case 'store': {
            let srcReg = rSrc1;
            if (typeof ir.src1 === 'number') {
              srcReg = 255;
              allInstructions.push(new BytecodeInstruction(Opcode.LOAD_IMM, 255, 0, 0, ir.src1, ir.metadata));
            }
            const offset = (ir.metadata && ir.metadata.offset) || 0;
            allInstructions.push(new BytecodeInstruction(Opcode.STORE, rDest, srcReg, 0, offset, ir.metadata));
            break;
          }

          case 'malloc':
            allInstructions.push(new BytecodeInstruction(Opcode.MALLOC, rDest, rSrc1, 0, imm, ir.metadata));
            break;

          case 'free':
            allInstructions.push(new BytecodeInstruction(Opcode.FREE, 0, rSrc1, 0, 0, ir.metadata));
            break;

          case 'getfield':
            allInstructions.push(new BytecodeInstruction(Opcode.LOAD, rDest, rSrc1, 0, Number(ir.src2) || 0, ir.metadata));
            break;

          case 'setfield': {
            let srcReg = rSrc1;
            if (typeof ir.src1 === 'number') {
              srcReg = 255;
              allInstructions.push(new BytecodeInstruction(Opcode.LOAD_IMM, 255, 0, 0, ir.src1, ir.metadata));
            }
            const offset = (typeof ir.src2 === 'number') ? ir.src2 : (Number(ir.src2) || 0);
            allInstructions.push(new BytecodeInstruction(Opcode.STORE, rDest, srcReg, 0, offset, ir.metadata));
            break;
          }

          case 'goto': {
            const target = ir.metadata && ir.metadata.target;
            const idx = allInstructions.length;
            pendingFixups.push({ instIndex: idx, targetLabel: target });
            allInstructions.push(new BytecodeInstruction(Opcode.JMP, 0, 0, 0, 0, ir.metadata));
            break;
          }

          case 'ifTrue': {
            const target = ir.metadata && ir.metadata.target;
            const idx = allInstructions.length;
            pendingFixups.push({ instIndex: idx, targetLabel: target });
            allInstructions.push(new BytecodeInstruction(Opcode.JMP_IF, 0, rSrc1, 0, 0, ir.metadata));
            break;
          }

          case 'ifFalse': {
            const target = ir.metadata && ir.metadata.target;
            const idx = allInstructions.length;
            pendingFixups.push({ instIndex: idx, targetLabel: target });
            allInstructions.push(new BytecodeInstruction(Opcode.JMP_IF_NOT, 0, rSrc1, 0, 0, ir.metadata));
            break;
          }

          case 'param':
            if (typeof ir.src1 === 'number') {
              allInstructions.push(new BytecodeInstruction(Opcode.PUSH, 0, 0, 0, ir.src1, ir.metadata));
            } else {
              allInstructions.push(new BytecodeInstruction(Opcode.PUSH, 0, rSrc1, 0, 0, ir.metadata));
            }
            break;

          case 'call': {
            const fnName = String(ir.src1);
            if (fnName === 'print_int') {
              allInstructions.push(new BytecodeInstruction(Opcode.PRINT_INT, 0, 0, 0, 0, ir.metadata));
            } else if (fnName === 'print_str') {
              allInstructions.push(new BytecodeInstruction(Opcode.PRINT_STR, 0, 0, 0, 0, ir.metadata));
            } else if (fnName === 'free') {
              allInstructions.push(new BytecodeInstruction(Opcode.FREE, 0, 0, 0, 0, ir.metadata));
            } else if (fnName === 'malloc') {
              allInstructions.push(new BytecodeInstruction(Opcode.MALLOC, rDest, 0, 0, 0, ir.metadata));
            } else {
              const idx = allInstructions.length;
              pendingFixups.push({ instIndex: idx, targetFunc: fnName });
              allInstructions.push(new BytecodeInstruction(Opcode.CALL, rDest, 0, Number(ir.src2) || 1, 0, ir.metadata));
            }
            break;
          }

          case 'return':
            allInstructions.push(new BytecodeInstruction(Opcode.RET, 0, rSrc1, 0, imm, ir.metadata));
            break;

          default:
            break;
        }
      }
    }

    // Add trailing HALT
    allInstructions.push(new BytecodeInstruction(Opcode.HALT, 0, 0, 0, 0));

    // Resolve fixups
    for (const fix of pendingFixups) {
      const ins = allInstructions[fix.instIndex];
      if (fix.targetLabel && labelOffsets.has(fix.targetLabel)) {
        ins.imm = labelOffsets.get(fix.targetLabel);
      } else if (fix.targetFunc && this.functionTable.has(fix.targetFunc)) {
        ins.imm = this.functionTable.get(fix.targetFunc);
      }
    }

    return new BytecodeProgram(allInstructions, this.stringTable, this.functionTable);
  }
}

module.exports = {
  Opcode,
  OpcodeNames,
  BytecodeInstruction,
  BytecodeProgram,
  BytecodeCompiler,
};
