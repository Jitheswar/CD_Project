'use strict';

/**
 * @module lowered-ir
 * @description Lowered Intermediate Representation (post-SSA destruction).
 * Maps variable and temporary names to dense virtual registers (v0, v1, ...),
 * linearizes basic blocks, computes stack frame sizes, and produces
 * the canonical LoweredFunction consumed by both RV32IM codegen and Bytecode VM.
 */

class LoweredInstruction {
  /**
   * @param {string} op
   * @param {string|number|null} dest
   * @param {string|number|null} src1
   * @param {string|number|null} src2
   * @param {object} [metadata={}]
   */
  constructor(op, dest = null, src1 = null, src2 = null, metadata = {}) {
    this.op = op;
    this.dest = dest;
    this.src1 = src1;
    this.src2 = src2;
    this.metadata = metadata;
  }

  toString() {
    if (this.op === 'label') return `${this.metadata.label || this.dest}:`;
    if (this.op === 'goto') return `goto ${this.metadata.target || this.src1}`;
    if (this.op === 'ifFalse') return `ifFalse ${this.src1} goto ${this.metadata.target}`;
    if (this.op === 'ifTrue') return `ifTrue ${this.src1} goto ${this.metadata.target}`;
    if (this.op === 'return') return this.src1 !== null ? `return ${this.src1}` : 'return';
    if (this.op === 'param') return `param ${this.src1}`;
    if (this.op === 'call') return `${this.dest} = call ${this.src1}, ${this.src2}`;
    if (this.op === 'copy') return `${this.dest} = ${this.src1}`;
    if (this.op === 'load') return `${this.dest} = load [${this.src1}]`;
    if (this.op === 'store') return `store [${this.dest}], ${this.src1}`;
    if (this.op === 'malloc') return `${this.dest} = malloc ${this.src1}`;
    if (this.op === 'free') return `free ${this.src1}`;
    if (this.op === 'getfield') return `${this.dest} = ${this.src1}.${this.src2}`;
    if (this.op === 'setfield') return `${this.dest}.${this.src2} = ${this.src1}`;
    return `${this.dest} = ${this.src1} ${this.op} ${this.src2}`;
  }
}

class LoweredFunction {
  /**
   * @param {string} name
   * @param {string[]} params
   * @param {LoweredInstruction[]} instructions
   * @param {number} numVRegs
   * @param {number} frameSize
   */
  constructor(name, params, instructions, numVRegs, frameSize = 0) {
    this.name = name;
    this.params = params;
    this.instructions = instructions;
    this.numVRegs = numVRegs;
    this.frameSize = frameSize;
  }
}

/**
 * Lower a CFG (after SSA destruction) to Lowered IR.
 * @param {import('./cfg').CFG} cfg
 * @param {string} funcName
 * @param {string[]} [paramNames=[]]
 * @returns {LoweredFunction}
 */
function lowerCFG(cfg, funcName = 'main', paramNames = []) {
  const vregMap = new Map();
  let vregCounter = 0;

  function getVReg(name) {
    if (name === null || name === undefined) return null;
    if (typeof name === 'number') return name; // constant literal
    if (typeof name === 'string' && /^-?\d+$/.test(name)) return Number(name);
    if (typeof name === 'string' && (name.startsWith('"') || name === 'true' || name === 'false' || name === 'null')) {
      return name;
    }

    if (!vregMap.has(name)) {
      vregMap.set(name, `v${vregCounter++}`);
    }
    return vregMap.get(name);
  }

  // Pre-assign parameters to v0, v1, ...
  const loweredParams = [];
  for (let i = 0; i < paramNames.length; i++) {
    const p = paramNames[i];
    const v = `v${vregCounter++}`;
    vregMap.set(p, v);
    vregMap.set(`${p}.0`, v);
    loweredParams.push(v);
  }

  const instructions = [];

  for (const b of cfg.blocks) {
    // If block has a label or predecessors > 1 or is target of jumps, emit label
    if (b.label) {
      instructions.push(new LoweredInstruction('label', null, null, null, { label: b.label }));
    } else if (b.id !== 'B0' && b.id !== 'Bentry' && b.instructions.length > 0) {
      instructions.push(new LoweredInstruction('label', null, null, null, { label: b.id }));
    }

    for (const ins of b.instructions) {
      let dest = ins.result !== null ? getVReg(ins.result) : null;
      let src1 = ins.arg1 !== null ? (ins.op === 'call' ? ins.arg1 : getVReg(ins.arg1)) : null;
      let src2 = ins.arg2 !== null ? getVReg(ins.arg2) : null;

      const meta = { ...ins.metadata };
      if (ins.target) {
        meta.target = ins.target;
      }

      instructions.push(new LoweredInstruction(ins.op, dest, src1, src2, meta));
    }
  }

  return new LoweredFunction(funcName, loweredParams, instructions, vregCounter, vregCounter * 4);
}

module.exports = {
  LoweredInstruction,
  LoweredFunction,
  lowerCFG,
};
