'use strict';

/**
 * @module gvn
 * @description Global Value Numbering (GVN) pass.
 * Detects redundant computations across basic blocks by walking the dominator tree
 * with a scoped expression table.
 */

const { Pass } = require('./pass');
const { TACInstruction } = require('../ir/tac');

class GVNPass extends Pass {
  constructor() {
    super('gvn', 'Global Value Numbering: eliminates redundant computations');
  }

  run(cfg) {
    let modified = false;
    const domChildren = cfg.getDomTreeChildren();

    // Map var/temp name -> canonical value number (string or number)
    const valNum = new Map();
    // Scoped expression table: exprKey -> canonical temp/result name
    const exprTables = [];

    function enterScope() {
      exprTables.push(new Map());
    }

    function exitScope() {
      exprTables.pop();
    }

    function lookupExpr(key) {
      for (let i = exprTables.length - 1; i >= 0; i--) {
        if (exprTables[i].has(key)) {
          return exprTables[i].get(key);
        }
      }
      return null;
    }

    function recordExpr(key, varName) {
      if (exprTables.length > 0) {
        exprTables[exprTables.length - 1].set(key, varName);
      }
    }

    function getVN(v) {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return `const_${v}`;
      if (valNum.has(v)) return valNum.get(v);
      valNum.set(v, v);
      return v;
    }

    function isCommutative(op) {
      return op === 'add' || op === 'mul' || op === 'and' || op === 'or' || op === 'xor' || op === 'eq' || op === 'ne';
    }

    function makeKey(op, arg1, arg2) {
      const v1 = getVN(arg1);
      const v2 = getVN(arg2);
      if (isCommutative(op) && v1 > v2) {
        return `${op}(${v2},${v1})`;
      }
      return `${op}(${v1},${v2})`;
    }

    function processBlock(b) {
      enterScope();

      for (let i = 0; i < b.instructions.length; i++) {
        const ins = b.instructions[i];

        // Only value-number pure arithmetic/logical/comparison operations
        if (['add', 'sub', 'mul', 'div', 'mod', 'and', 'or', 'xor', 'shl', 'shr',
             'lt', 'le', 'gt', 'ge', 'eq', 'ne'].includes(ins.op)) {

          const key = makeKey(ins.op, ins.arg1, ins.arg2);
          const existing = lookupExpr(key);

          if (existing !== null && existing !== ins.result) {
            // Replace redundant computation with a copy
            b.instructions[i] = new TACInstruction('copy', ins.result, existing, null);
            valNum.set(ins.result, getVN(existing));
            modified = true;
          } else {
            recordExpr(key, ins.result);
            valNum.set(ins.result, ins.result);
          }
        } else if (ins.op === 'copy') {
          valNum.set(ins.result, getVN(ins.arg1));
        } else if (ins.getDef()) {
          valNum.set(ins.getDef(), ins.getDef());
        }
      }

      // Recurse down dominator tree
      const children = domChildren.get(b) || [];
      for (const child of children) {
        processBlock(child);
      }

      exitScope();
    }

    processBlock(cfg.entry);
    return modified;
  }
}

module.exports = { GVNPass };
