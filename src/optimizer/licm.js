'use strict';

/**
 * @module licm
 * @description Loop-Invariant Code Motion (LICM) pass.
 * Identifies natural loops, detects loop-invariant pure instructions,
 * and hoists them into loop preheaders.
 */

const { Pass } = require('./pass');

class LICMPass extends Pass {
  constructor() {
    super('licm', 'Loop-Invariant Code Motion: hoists invariants out of loops');
  }

  run(cfg) {
    let modified = false;
    const loops = cfg.getLoops();
    if (loops.length === 0) return false;

    for (const loop of loops) {
      const header = loop.header;
      const loopBlocks = loop.body;

      // Find definitions within the loop
      const defsInLoop = new Set();
      for (const b of loopBlocks) {
        for (const ins of b.instructions) {
          const d = ins.getDef();
          if (d) defsInLoop.add(d);
        }
      }

      // Find a pre-header predecessor of the header that is outside the loop
      let preheader = header.predecessors.find(p => !loopBlocks.has(p));
      if (!preheader) continue;

      // Identify loop-invariant instructions
      for (const b of loopBlocks) {
        for (let i = 0; i < b.instructions.length; i++) {
          const ins = b.instructions[i];

          // Candidate ops: pure binary/unary operations without side-effects
          if (['add', 'sub', 'mul', 'div', 'mod', 'and', 'or', 'xor', 'shl', 'shr',
               'lt', 'le', 'gt', 'ge', 'eq', 'ne', 'neg', 'not'].includes(ins.op)) {

            const arg1Invariant = typeof ins.arg1 === 'number' || !defsInLoop.has(ins.arg1);
            const arg2Invariant = ins.arg2 === null || typeof ins.arg2 === 'number' || !defsInLoop.has(ins.arg2);

            if (arg1Invariant && arg2Invariant) {
              // Hoist to preheader before the branch/jump at the end
              const hoistPos = Math.max(0, preheader.instructions.length - 1);
              preheader.instructions.splice(hoistPos, 0, ins);

              // Remove from loop block
              b.instructions.splice(i, 1);
              i--;
              defsInLoop.delete(ins.result); // Now defined outside
              modified = true;
            }
          }
        }
      }
    }

    return modified;
  }
}

module.exports = { LICMPass };
