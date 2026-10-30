'use strict';

/**
 * @module codegen/mir
 * Machine-level Intermediate Representation for RV32IM target.
 *
 * Provides MIRInstruction, MIRFunction, and instruction selection
 * that lowers a generic "lowered IR" into machine instructions using
 * virtual registers.  The RV32IM calling convention is followed:
 *   a0-a7  — argument / return-value registers
 *   s0-s11 — callee-saved
 *   t0-t6  — caller-saved temporaries
 *   sp, ra, fp — stack pointer, return address, frame pointer
 */

// ─── Opcode catalogue ───────────────────────────────────────────────────────

/** All supported RV32IM opcodes (strings). */
const RV32IM_OPCODES = Object.freeze({
  // R-type arithmetic
  ADD: 'add', SUB: 'sub', MUL: 'mul', DIV: 'div', REM: 'rem',
  AND: 'and', OR: 'or', XOR: 'xor',
  SLL: 'sll', SRL: 'srl', SRA: 'sra',
  SLT: 'slt', SLTU: 'sltu',

  // I-type arithmetic
  ADDI: 'addi', ANDI: 'andi', ORI: 'ori', XORI: 'xori',
  SLLI: 'slli', SRLI: 'srli', SRAI: 'srai',
  SLTI: 'slti', SLTIU: 'sltiu',

  // Load / Store
  LW: 'lw', SW: 'sw', LB: 'lb', SB: 'sb', LBU: 'lbu',

  // Branch
  BEQ: 'beq', BNE: 'bne', BLT: 'blt', BGE: 'bge',
  BLTU: 'bltu', BGEU: 'bgeu',

  // Jump
  JAL: 'jal', JALR: 'jalr',

  // Upper immediate
  LUI: 'lui', AUIPC: 'auipc',

  // Pseudo-instructions
  LI: 'li', LA: 'la', MV: 'mv',
  CALL: 'call', RET: 'ret', J: 'j',
});

/** Set of all valid opcode strings (for quick validation). */
const VALID_OPCODES = new Set(Object.values(RV32IM_OPCODES));

// ─── Physical register names ────────────────────────────────────────────────

const REG = Object.freeze({
  ZERO: 'x0',
  RA: 'ra', SP: 'sp', GP: 'gp', TP: 'tp', FP: 'fp',
  T0: 't0', T1: 't1', T2: 't2', T3: 't3', T4: 't4', T5: 't5', T6: 't6',
  S0: 's0', S1: 's1', S2: 's2', S3: 's3', S4: 's4', S5: 's5',
  S6: 's6', S7: 's7', S8: 's8', S9: 's9', S10: 's10', S11: 's11',
  A0: 'a0', A1: 'a1', A2: 'a2', A3: 'a3',
  A4: 'a4', A5: 'a5', A6: 'a6', A7: 'a7',
});

/** Allocatable register pool. */
const ALLOCATABLE_REGS = Object.freeze([
  't0', 't1', 't2', 't3', 't4', 't5', 't6',               // 7 caller-saved
  's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', // 11 callee-saved
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',          // 8 arg/return
]);

const CALLEE_SAVED = new Set([
  's0', 's1', 's2', 's3', 's4', 's5', 's6',
  's7', 's8', 's9', 's10', 's11',
]);

const CALLER_SAVED = new Set([
  'ra',
  't0', 't1', 't2', 't3', 't4', 't5', 't6',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
]);

const ARG_REGS = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];

// ─── MIRInstruction ─────────────────────────────────────────────────────────

/**
 * A single machine-level instruction.
 *
 * Fields intentionally kept flat for fast iteration by later passes.
 */
class MIRInstruction {
  /**
   * @param {object} opts
   * @param {string}  opts.opcode  — One of the RV32IM_OPCODES values.
   * @param {string|null} [opts.dest]    — Destination register (virtual or physical).
   * @param {string|null} [opts.src1]    — First source register.
   * @param {string|null} [opts.src2]    — Second source register.
   * @param {number|null} [opts.imm]     — Immediate value.
   * @param {string|null} [opts.label]   — Label reference (branch/jump/call target).
   * @param {string|null} [opts.comment] — Human-readable annotation.
   */
  constructor({ opcode, dest = null, src1 = null, src2 = null, imm = null, label = null, comment = null }) {
    if (!VALID_OPCODES.has(opcode)) {
      throw new Error(`MIRInstruction: unknown opcode "${opcode}"`);
    }
    this.opcode = opcode;
    this.dest = dest;
    this.src1 = src1;
    this.src2 = src2;
    this.imm = imm;
    this.label = label;
    this.comment = comment;
  }

  /** Return every register *defined* (written) by this instruction. */
  defs() {
    const result = [];
    if (this.dest) result.push(this.dest);
    // call implicitly defines ra and a0
    if (this.opcode === 'call') {
      if (!result.includes('ra')) result.push('ra');
    }
    return result;
  }

  getDefs() {
    return this.defs();
  }

  /** Return every register *used* (read) by this instruction. */
  uses() {
    const result = [];
    if (this.src1) result.push(this.src1);
    if (this.src2) result.push(this.src2);
    // ret implicitly uses ra and a0
    if (this.opcode === 'ret') {
      if (!result.includes('ra')) result.push('ra');
      if (!result.includes('a0')) result.push('a0');
    }
    return result;
  }

  getSources() {
    return this.uses();
  }

  renameSource(oldReg, newReg) {
    if (this.src1 === oldReg) this.src1 = newReg;
    if (this.src2 === oldReg) this.src2 = newReg;
  }

  renameDef(oldReg, newReg) {
    if (this.dest === oldReg) this.dest = newReg;
  }

  /** True if this is a branch or jump instruction. */
  isTerminator() {
    return ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu',
            'jal', 'jalr', 'j', 'ret'].includes(this.opcode);
  }

  /** True if this is a move / copy instruction. */
  isMove() {
    return this.opcode === 'mv';
  }

  /** Pretty-print to RV32IM assembly syntax. */
  toAsm() {
    return this.toString();
  }

  toString() {
    const parts = [this.opcode];
    if (this.dest) parts.push(this.dest);
    if (this.src1) parts.push(this.src1);
    if (this.src2) parts.push(this.src2);
    if (this.imm !== null) parts.push(String(this.imm));
    if (this.label) parts.push(this.label);
    let s = parts.join(' ');
    if (this.comment) s += `  # ${this.comment}`;
    return s;
  }

  /** Deep clone. */
  clone() {
    return new MIRInstruction({
      opcode: this.opcode,
      dest: this.dest,
      src1: this.src1,
      src2: this.src2,
      imm: this.imm,
      label: this.label,
      comment: this.comment,
    });
  }
}

// ─── MIRBasicBlock ──────────────────────────────────────────────────────────

/**
 * A labelled straight-line sequence of MIR instructions terminated by a
 * branch / jump / ret.
 */
class MIRBasicBlock {
  /**
   * @param {string}            id           — Unique block label.
   * @param {MIRInstruction[]}  instructions — Ordered instruction list.
   * @param {string[]}          [successors] — Labels of successor blocks.
   * @param {string[]}          [predecessors] — Labels of predecessor blocks.
   */
  constructor(id, instructions = [], successors = [], predecessors = []) {
    this.id = id;
    this.instructions = instructions;
    this.successors = successors;
    this.predecessors = predecessors;
  }
}

// ─── MIRFunction ────────────────────────────────────────────────────────────

/**
 * A whole function in MIR form.
 */
class MIRFunction {
  /**
   * @param {string}           name            — Function name / symbol.
   * @param {MIRBasicBlock[]}  blocks          — Ordered basic blocks.
   * @param {number}           virtualRegCount — Next available virtual register id.
   */
  constructor(name, blocks, virtualRegCount) {
    this.name = name;
    this.blocks = blocks;
    this.virtualRegCount = virtualRegCount;
    /** @type {number} Stack frame size in bytes (filled by later passes). */
    this.frameSize = 0;
    /** @type {Set<string>} Physical callee-saved registers actually used. */
    this.usedCalleeSaved = new Set();
    /** @type {number} Number of parameters. */
    this.paramCount = 0;
  }

  /** Convenience: iterate all instructions across all blocks. */
  *allInstructions() {
    for (const block of this.blocks) {
      yield* block.instructions;
    }
  }

  /** Get a block by id. */
  getBlock(id) {
    return this.blocks.find(b => b.id === id) || null;
  }

  /** Fresh virtual register name. */
  freshVReg() {
    return `%v${this.virtualRegCount++}`;
  }
}

// ─── Helper: virtual register naming ────────────────────────────────────────

let _globalVRegId = 0;

function resetVRegCounter() { _globalVRegId = 0; }

function freshVReg() { return `%v${_globalVRegId++}`; }

function isVirtualReg(name) { return typeof name === 'string' && name.startsWith('%v'); }
function isPhysicalReg(name) {
  return typeof name === 'string' && !name.startsWith('%');
}

// ─── Instruction selection ──────────────────────────────────────────────────

/**
 * Lower an array of "lowered IR" functions into MIR functions.
 *
 * Expected lowered IR format (per function):
 * ```
 * {
 *   name: string,
 *   params: string[],          // parameter names / vregs
 *   blocks: [
 *     {
 *       id: string,
 *       instructions: [
 *         { op: string, dest?: string, src1?: string, src2?: string,
 *           value?: number, label?: string, args?: string[], target?: string,
 *           trueBlock?: string, falseBlock?: string, type?: string }
 *       ],
 *       successors: string[],
 *       predecessors: string[]
 *     }
 *   ]
 * }
 * ```
 *
 * Supported lowered-IR ops:
 *   add, sub, mul, div, mod, neg, not, and, or, xor, shl, shr,
 *   lt, le, gt, ge, eq, ne,
 *   const (load immediate), copy,
 *   load, store, load_byte, store_byte,
 *   alloca,
 *   call, ret, br, br_cond,
 *   phi, load_global, store_global, addr_of
 *
 * @param {object|object[]} loweredIR — A single function or an array of functions.
 * @returns {MIRFunction[]}
 */
function selectInstructions(loweredIR) {
  const funcs = Array.isArray(loweredIR) ? loweredIR : [loweredIR];
  const results = [];

  for (const func of funcs) {
    resetVRegCounter();
    const vregMap = new Map();    // lowered-IR name → MIR vreg
    const mirBlocks = [];

    // Reserve vregs for parameters and map them to argument registers.
    const paramMoves = [];
    (func.params || []).forEach((p, i) => {
      const vr = freshVReg();
      vregMap.set(p, vr);
      if (i < ARG_REGS.length) {
        paramMoves.push(new MIRInstruction({ opcode: 'mv', dest: vr, src1: ARG_REGS[i], comment: `param ${p}` }));
      } else {
        // Spill args beyond a7 are loaded from the stack later (offset filled by frame layout).
        paramMoves.push(new MIRInstruction({
          opcode: 'lw', dest: vr, src1: 'fp', imm: (i - ARG_REGS.length) * 4,
          comment: `param ${p} (stack)`,
        }));
      }
    });

    /**
     * Resolve a lowered-IR operand to a MIR vreg, creating one on demand.
     */
    function resolveReg(name) {
      if (name === null || name === undefined) return null;
      if (typeof name === 'number') {
        // Inline immediate — materialise with li.
        const vr = freshVReg();
        // We'll prepend a li before the instruction that needs it.
        return { vreg: vr, materialise: new MIRInstruction({ opcode: 'li', dest: vr, imm: name }) };
      }
      // Physical reg pass-through (caller already placed value there).
      if (isPhysicalReg(name) && !name.startsWith('$')) return name;
      if (!vregMap.has(name)) vregMap.set(name, freshVReg());
      return vregMap.get(name);
    }

    /**
     * Unwrap a "resolveReg" result to its vreg string,
     * pushing any materialisation instructions into `extra`.
     */
    function reg(name, extra) {
      const r = resolveReg(name);
      if (r && typeof r === 'object' && r.vreg) {
        extra.push(r.materialise);
        return r.vreg;
      }
      return r;
    }

    // If func has flat instructions, group them into blocks
    let funcBlocks = func.blocks;
    if (!funcBlocks && func.instructions) {
      funcBlocks = [];
      let currentBlock = { id: 'B0', instructions: [], successors: [], predecessors: [] };
      funcBlocks.push(currentBlock);

      for (const ins of func.instructions) {
        if (ins.op === 'label') {
          const lblName = (ins.metadata && ins.metadata.label) || ins.dest || `L${funcBlocks.length}`;
          currentBlock = { id: lblName, instructions: [], successors: [], predecessors: [] };
          funcBlocks.push(currentBlock);
        } else {
          currentBlock.instructions.push(ins);
        }
      }
    }

    for (let bi = 0; bi < (funcBlocks || []).length; bi++) {
      const block = funcBlocks[bi];
      const instrs = [];

      // Inject parameter moves into the entry block.
      if (bi === 0) {
        instrs.push(...paramMoves);
      }

      for (const ir of (block.instructions || [])) {
        const extra = []; // materialisation instructions
        switch (ir.op) {
          // ── Arithmetic ──────────────────────────────────────────────
          case 'add': case 'sub': case 'mul': case 'div': case 'and':
          case 'or': case 'xor': case 'shl': case 'shr': {
            const opcodeMap = { add: 'add', sub: 'sub', mul: 'mul', div: 'div',
              and: 'and', or: 'or', xor: 'xor', shl: 'sll', shr: 'srl' };
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: opcodeMap[ir.op], dest, src1: s1, src2: s2 }));
            break;
          }
          case 'mod': case 'rem': {
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'rem', dest, src1: s1, src2: s2 }));
            break;
          }
          case 'neg': {
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'sub', dest, src1: 'x0', src2: s1, comment: 'neg' }));
            break;
          }
          case 'not': {
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'xori', dest, src1: s1, imm: -1, comment: 'bitwise not' }));
            break;
          }

          // ── Comparison ──────────────────────────────────────────────
          case 'lt': {
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'slt', dest, src1: s1, src2: s2 }));
            break;
          }
          case 'ge': {
            // ge a,b  →  slt tmp,a,b; xori dest,tmp,1
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            const tmp = freshVReg();
            instrs.push(new MIRInstruction({ opcode: 'slt', dest: tmp, src1: s1, src2: s2 }));
            instrs.push(new MIRInstruction({ opcode: 'xori', dest, src1: tmp, imm: 1, comment: 'ge' }));
            break;
          }
          case 'gt': {
            // gt a,b  →  slt dest, b, a  (swap operands)
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'slt', dest, src1: s2, src2: s1, comment: 'gt' }));
            break;
          }
          case 'le': {
            // le a,b  →  slt tmp,b,a; xori dest,tmp,1
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            const tmp = freshVReg();
            instrs.push(new MIRInstruction({ opcode: 'slt', dest: tmp, src1: s2, src2: s1 }));
            instrs.push(new MIRInstruction({ opcode: 'xori', dest, src1: tmp, imm: 1, comment: 'le' }));
            break;
          }
          case 'eq': {
            // eq a,b  →  sub tmp,a,b; sltiu dest,tmp,1
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            const tmp = freshVReg();
            instrs.push(new MIRInstruction({ opcode: 'sub', dest: tmp, src1: s1, src2: s2 }));
            instrs.push(new MIRInstruction({ opcode: 'sltiu', dest, src1: tmp, imm: 1, comment: 'eq' }));
            break;
          }
          case 'ne': {
            // ne a,b  →  sub tmp,a,b; sltu dest,x0,tmp
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            const s2 = reg(ir.src2, extra);
            instrs.push(...extra);
            const tmp = freshVReg();
            instrs.push(new MIRInstruction({ opcode: 'sub', dest: tmp, src1: s1, src2: s2 }));
            instrs.push(new MIRInstruction({ opcode: 'sltu', dest, src1: 'x0', src2: tmp, comment: 'ne' }));
            break;
          }

          // ── Constants / copies ──────────────────────────────────────
          case 'const': {
            const dest = reg(ir.dest, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'li', dest, imm: ir.value }));
            break;
          }
          case 'copy': {
            const dest = reg(ir.dest, extra);
            const s1 = reg(ir.src1, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({ opcode: 'mv', dest, src1: s1 }));
            break;
          }

          // ── Memory ─────────────────────────────────────────────────
          case 'load': {
            const dest = reg(ir.dest, extra);
            const base = reg(ir.src1, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'lw', dest, src1: base,
              imm: ir.offset !== undefined ? ir.offset : 0,
            }));
            break;
          }
          case 'store': {
            const val = reg(ir.src1, extra);
            const base = reg(ir.src2 || ir.dest, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'sw', src1: val, src2: base,
              imm: ir.offset !== undefined ? ir.offset : 0,
            }));
            break;
          }
          case 'load_byte': {
            const dest = reg(ir.dest, extra);
            const base = reg(ir.src1, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: ir.unsigned ? 'lbu' : 'lb', dest, src1: base,
              imm: ir.offset !== undefined ? ir.offset : 0,
            }));
            break;
          }
          case 'store_byte': {
            const val = reg(ir.src1, extra);
            const base = reg(ir.src2 || ir.dest, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'sb', src1: val, src2: base,
              imm: ir.offset !== undefined ? ir.offset : 0,
            }));
            break;
          }
          case 'alloca': {
            // Allocate stack space. We'll emit a sub sp, sp, size later
            // and use an addi to compute the address.
            const dest = reg(ir.dest, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'addi', dest, src1: 'sp', imm: 0,
              comment: `alloca ${ir.size || 4}`,
            }));
            break;
          }

          // ── Globals ────────────────────────────────────────────────
          case 'load_global': case 'addr_of': {
            const dest = reg(ir.dest, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'la', dest, label: ir.name || ir.label || ir.src1,
              comment: ir.op,
            }));
            if (ir.op === 'load_global') {
              // dereference
              instrs.push(new MIRInstruction({ opcode: 'lw', dest, src1: dest, imm: 0 }));
            }
            break;
          }
          case 'store_global': {
            const val = reg(ir.src1, extra);
            const addrReg = freshVReg();
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'la', dest: addrReg, label: ir.name || ir.label || ir.dest,
            }));
            instrs.push(new MIRInstruction({ opcode: 'sw', src1: val, src2: addrReg, imm: 0 }));
            break;
          }

          // ── Control flow ───────────────────────────────────────────
          case 'br':
          case 'goto': {
            const tgt = ir.target || (ir.metadata && ir.metadata.target) || ir.label;
            instrs.push(new MIRInstruction({
              opcode: 'j', label: tgt,
            }));
            break;
          }
          case 'ifTrue': {
            const cond = reg(ir.src1 || ir.cond || (ir.metadata && ir.metadata.cond), extra);
            const tgt = ir.target || (ir.metadata && ir.metadata.target) || ir.label;
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'bne', src1: cond, src2: 'x0',
              label: tgt,
              comment: 'ifTrue branch',
            }));
            break;
          }
          case 'ifFalse': {
            const cond = reg(ir.src1 || ir.cond || (ir.metadata && ir.metadata.cond), extra);
            const tgt = ir.target || (ir.metadata && ir.metadata.target) || ir.label;
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'beq', src1: cond, src2: 'x0',
              label: tgt,
              comment: 'ifFalse branch',
            }));
            break;
          }
          case 'br_cond': {
            const cond = reg(ir.src1 || ir.cond, extra);
            instrs.push(...extra);
            instrs.push(new MIRInstruction({
              opcode: 'bne', src1: cond, src2: 'x0',
              label: ir.trueBlock || ir.trueLabel,
              comment: 'br_cond true',
            }));
            instrs.push(new MIRInstruction({
              opcode: 'j', label: ir.falseBlock || ir.falseLabel,
              comment: 'br_cond false',
            }));
            break;
          }

          // ── Return ─────────────────────────────────────────────────
          case 'ret':
          case 'return': {
            const valSrc = ir.src1 !== undefined && ir.src1 !== null ? ir.src1 : ir.val;
            if (valSrc !== undefined && valSrc !== null) {
              const val = reg(valSrc, extra);
              instrs.push(...extra);
              instrs.push(new MIRInstruction({
                opcode: 'mv', dest: 'a0', src1: val, comment: 'return value',
              }));
            }
            instrs.push(new MIRInstruction({ opcode: 'ret' }));
            break;
          }

          // ── Phi (lowered as moves in predecessor blocks — simple form) ──
          case 'phi': {
            // In a simple lowering the phi is converted to a copy in each
            // predecessor.  Here we emit a placeholder that later passes
            // can resolve.  For now, just pick the first operand.
            const dest = reg(ir.dest, extra);
            const operands = ir.operands || ir.sources || [];
            if (operands.length > 0) {
              const first = operands[0];
              const s = reg(first.value || first.src || first, extra);
              instrs.push(...extra);
              instrs.push(new MIRInstruction({
                opcode: 'mv', dest, src1: s, comment: 'phi (simplified)',
              }));
            }
            break;
          }

          default:
            // Unknown IR op — emit a comment so it's visible in the output.
            instrs.push(new MIRInstruction({
              opcode: 'addi', dest: 'x0', src1: 'x0', imm: 0,
              comment: `UNKNOWN IR OP: ${ir.op}`,
            }));
        }
      }

      mirBlocks.push(new MIRBasicBlock(
        block.id,
        instrs,
        block.successors || [],
        block.predecessors || [],
      ));
    }

    const mirFunc = new MIRFunction(func.name, mirBlocks, _globalVRegId);
    mirFunc.paramCount = (func.params || []).length;
    results.push(mirFunc);
  }

  return results;
}

// ─── Exports ────────────────────────────────────────────────────────────────

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
};
