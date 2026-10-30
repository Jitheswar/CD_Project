'use strict';

/**
 * @module sccp
 * @description Sparse Conditional Constant Propagation (SCCP) pass.
 * Jointly propagates constants and evaluates conditional branches,
 * discovering both compile-time constants and unreachable basic blocks.
 */

const { Pass } = require('./pass');
const { TACInstruction } = require('../ir/tac');

const Lattice = {
  TOP: 'TOP',       // Not yet evaluated / undefined
  BOTTOM: 'BOTTOM', // Variable / overdefined
};

class SCCPPass extends Pass {
  constructor() {
    super('sccp', 'Sparse Conditional Constant Propagation & dead branch folding');
  }

  run(cfg) {
    let modified = false;

    // Map variable/temp name -> Lattice value (number, boolean, or TOP/BOTTOM)
    const latVals = new Map();

    function getVal(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'string') {
        if (/^-?\d+$/.test(v)) return Number(v);
        if (v === 'true') return 1;
        if (v === 'false') return 0;
        if (latVals.has(v)) return latVals.get(v);
      }
      return Lattice.TOP;
    }

    function setVal(v, val) {
      if (!v || typeof v !== 'string') return;
      const cur = latVals.get(v);
      if (cur === Lattice.BOTTOM) return;
      if (cur !== val) {
        latVals.set(v, val);
        modified = true;
      }
    }

    // Worklists
    const cfgWorklist = [cfg.entry];
    const visitedBlocks = new Set();

    while (cfgWorklist.length > 0) {
      const block = cfgWorklist.shift();
      visitedBlocks.add(block);

      for (let i = 0; i < block.instructions.length; i++) {
        const ins = block.instructions[i];

        if (ins.op === 'copy') {
          const val = getVal(ins.arg1);
          setVal(ins.result, val);
        } else if (ins.op === 'add' || ins.op === 'sub' || ins.op === 'mul' || ins.op === 'div' ||
                   ins.op === 'lt' || ins.op === 'le' || ins.op === 'gt' || ins.op === 'ge' ||
                   ins.op === 'eq' || ins.op === 'ne') {
          const v1 = getVal(ins.arg1);
          const v2 = getVal(ins.arg2);

          if (typeof v1 === 'number' && typeof v2 === 'number') {
            let res;
            switch (ins.op) {
              case 'add': res = (v1 + v2) | 0; break;
              case 'sub': res = (v1 - v2) | 0; break;
              case 'mul': res = Math.imul(v1, v2); break;
              case 'div': res = v2 !== 0 ? ((v1 / v2) | 0) : Lattice.BOTTOM; break;
              case 'lt': res = v1 < v2 ? 1 : 0; break;
              case 'le': res = v1 <= v2 ? 1 : 0; break;
              case 'gt': res = v1 > v2 ? 1 : 0; break;
              case 'ge': res = v1 >= v2 ? 1 : 0; break;
              case 'eq': res = v1 === v2 ? 1 : 0; break;
              case 'ne': res = v1 !== v2 ? 1 : 0; break;
            }
            setVal(ins.result, res);
          } else if (v1 === Lattice.BOTTOM || v2 === Lattice.BOTTOM) {
            setVal(ins.result, Lattice.BOTTOM);
          }
        } else if (ins.op === 'phi') {
          // If all non-TOP arguments agree on a constant, promote to that constant
          const incoming = Array.isArray(ins.arg1) ? ins.arg1 : [];
          let candidate = Lattice.TOP;
          let conflict = false;

          for (const item of incoming) {
            const v = getVal(item.val);
            if (v !== Lattice.TOP) {
              if (candidate === Lattice.TOP) {
                candidate = v;
              } else if (candidate !== v) {
                conflict = true;
                break;
              }
            }
          }

          if (conflict) {
            setVal(ins.result, Lattice.BOTTOM);
          } else if (candidate !== Lattice.TOP) {
            setVal(ins.result, candidate);
          }
        } else if (ins.getDef()) {
          setVal(ins.getDef(), Lattice.BOTTOM);
        }

        // Branch folding
        if (ins.op === 'ifTrue' || ins.op === 'ifFalse') {
          const condVal = getVal(ins.arg1);
          if (typeof condVal === 'number') {
            const isTaken = ins.op === 'ifTrue' ? condVal !== 0 : condVal === 0;
            const targetLabel = ins.metadata && ins.metadata.target;
            if (isTaken) {
              // Replace with unconditional goto target
              block.instructions[i] = new TACInstruction('goto', null, null, null, { target: targetLabel });
              modified = true;
            } else {
              // Never taken: remove branch instruction
              block.instructions.splice(i, 1);
              i--;
              modified = true;
            }
          }
        }
      }

      for (const succ of block.successors) {
        if (!visitedBlocks.has(succ)) {
          cfgWorklist.push(succ);
        }
      }
    }

    // Replace constant uses with literals
    for (const b of cfg.blocks) {
      for (let i = 0; i < b.instructions.length; i++) {
        const ins = b.instructions[i];

        if (ins.arg1 && latVals.has(ins.arg1) && typeof latVals.get(ins.arg1) === 'number') {
          ins.arg1 = latVals.get(ins.arg1);
          modified = true;
        }
        if (ins.arg2 && latVals.has(ins.arg2) && typeof latVals.get(ins.arg2) === 'number') {
          ins.arg2 = latVals.get(ins.arg2);
          modified = true;
        }

        // If instruction result is known constant, replace with copy of constant
        const def = ins.getDef();
        if (def && latVals.has(def) && typeof latVals.get(def) === 'number' && ins.op !== 'copy') {
          b.instructions[i] = new TACInstruction('copy', def, latVals.get(def), null);
          modified = true;
        }
      }
    }

    return modified;
  }
}

module.exports = { SCCPPass };
