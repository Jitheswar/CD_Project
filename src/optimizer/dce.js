'use strict';

/**
 * @module dce
 * @description Dead Code Elimination (DCE) pass.
 * Uses a classic mark-sweep algorithm:
 *   - Mark: identify critical side-effecting instructions (store, call, return, branches)
 *   - Propagate: mark dependencies of critical instructions
 *   - Sweep: remove any instruction that produces an unused value
 * Also prunes unreachable basic blocks.
 */

const { Pass } = require('./pass');

class DCEPass extends Pass {
  constructor() {
    super('dce', 'Dead Code Elimination: sweeps unused definitions and unreachable blocks');
  }

  run(cfg) {
    let modified = false;

    // 1. Mark critical instructions
    const marked = new Set();
    const defMap = new Map(); // varName -> { block, ins }

    for (const b of cfg.blocks) {
      for (const ins of b.instructions) {
        const d = ins.getDef();
        if (d) defMap.set(d, { block: b, ins });

        // Critical instructions
        if (['store', 'call', 'return', 'ifTrue', 'ifFalse', 'goto', 'free', 'param', 'setfield'].includes(ins.op)) {
          marked.add(ins);
        }
      }
    }

    // 2. Propagate marks through operands
    const worklist = Array.from(marked);

    while (worklist.length > 0) {
      const ins = worklist.pop();

      // Check uses
      const uses = [];
      if (ins.arg1 && typeof ins.arg1 === 'string') uses.push(ins.arg1);
      if (ins.arg2 && typeof ins.arg2 === 'string') uses.push(ins.arg2);
      if ((ins.op === 'store' || ins.op === 'setfield') && typeof ins.result === 'string') {
        uses.push(ins.result);
      }
      if (Array.isArray(ins.arg1)) {
        for (const item of ins.arg1) {
          if (item && item.val && typeof item.val === 'string') uses.push(item.val);
        }
      }

      for (const u of uses) {
        const def = defMap.get(u);
        if (def && !marked.has(def.ins)) {
          marked.add(def.ins);
          worklist.push(def.ins);
        }
      }
    }

    // 3. Sweep unmarked instructions
    for (const b of cfg.blocks) {
      const remaining = [];
      for (const ins of b.instructions) {
        if (marked.has(ins) || ins.op === 'label') {
          remaining.push(ins);
        } else {
          modified = true;
        }
      }
      b.instructions = remaining;
    }

    // 4. Eliminate unreachable blocks
    const reachable = new Set();
    const q = [cfg.entry];
    reachable.add(cfg.entry);

    while (q.length > 0) {
      const curr = q.shift();
      for (const succ of curr.successors) {
        if (!reachable.has(succ)) {
          reachable.add(succ);
          q.push(succ);
        }
      }
    }

    if (reachable.size < cfg.blocks.length) {
      cfg.blocks = cfg.blocks.filter(b => reachable.has(b));
      modified = true;
    }

    return modified;
  }
}

module.exports = { DCEPass };
