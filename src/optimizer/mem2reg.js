'use strict';

/**
 * @module mem2reg
 * @description Memory-to-register promotion pass.
 * Promotes stack allocated scalar variables (alloc, load, store)
 * to direct SSA registers via iterated dominance frontiers.
 */

const { Pass } = require('./pass');
const { buildSSA } = require('../ir/ssa');

class Mem2RegPass extends Pass {
  constructor() {
    super('mem2reg', 'Promote stack variables (alloc/load/store) to SSA registers');
  }

  run(cfg) {
    let hadAlloc = false;
    for (const b of cfg.blocks) {
      for (const ins of b.instructions) {
        if (ins.op === 'alloc') {
          hadAlloc = true;
          break;
        }
      }
      if (hadAlloc) break;
    }

    if (!hadAlloc) return false;

    buildSSA(cfg);
    return true;
  }
}

module.exports = { Mem2RegPass };
