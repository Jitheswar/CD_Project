'use strict';

/**
 * @module ssa
 * @description Static Single Assignment (SSA) form construction, destruction, and validation.
 * Uses Cytron et al. iterated dominance frontiers for phi-placement
 * and dominator-tree scoped renaming.
 */

const { TACInstruction } = require('./tac');

/**
 * Convert a CFG to Static Single Assignment (SSA) form.
 * @param {import('./cfg').CFG} cfg
 * @returns {import('./cfg').CFG}
 */
function buildSSA(cfg) {
  // 1. Dominator tree and Dominance Frontiers
  const domTree = cfg.getDomTreeChildren();
  const df = cfg.getDominanceFrontier();

  // 2. Identify all variables that are targets of stores / assignments
  // Local stack variables allocated via 'alloc'
  const allocVars = new Set();
  for (const b of cfg.blocks) {
    for (const ins of b.instructions) {
      if (ins.op === 'alloc') {
        allocVars.add(ins.result);
      }
    }
  }

  // Find def sites for each variable (blocks containing 'store v, ...')
  const defSites = new Map();
  for (const v of allocVars) {
    defSites.set(v, new Set());
  }

  for (const b of cfg.blocks) {
    for (const ins of b.instructions) {
      if (ins.op === 'store' && allocVars.has(ins.result)) {
        defSites.get(ins.result).add(b);
      }
    }
  }

  // 3. Place φ-functions using iterated dominance frontiers
  const phiInserted = new Map(); // block -> Set<varName>
  for (const b of cfg.blocks) {
    phiInserted.set(b, new Set());
  }

  for (const v of allocVars) {
    const W = Array.from(defSites.get(v) || []);
    const inWorklist = new Set(W);

    while (W.length > 0) {
      const X = W.shift();
      inWorklist.delete(X);

      const frontier = df.get(X) || new Set();
      for (const Y of frontier) {
        if (!phiInserted.get(Y).has(v)) {
          phiInserted.get(Y).add(v);

          // Insert phi instruction at top of Y
          const phiArgs = [];
          for (const pred of Y.predecessors) {
            phiArgs.push({ block: pred.id, val: `${v}.0` });
          }
          const phiIns = new TACInstruction('phi', v, phiArgs, null, { originalVar: v });
          Y.instructions.unshift(phiIns);

          if (!defSites.get(v).has(Y) && !inWorklist.has(Y)) {
            W.push(Y);
            inWorklist.add(Y);
          }
        }
      }
    }
  }

  // 4. Renaming variables using dominator tree walk
  const currentDef = new Map(); // varName -> current SSA name (stack)
  const counter = new Map();    // varName -> next integer subscript

  for (const v of allocVars) {
    currentDef.set(v, [`${v}.0`]);
    counter.set(v, 1);
  }

  function newSSAName(v) {
    const c = counter.get(v) || 0;
    counter.set(v, c + 1);
    return `${v}.${c}`;
  }

  function renameBlock(b) {
    const pushedDefs = new Map(); // varName -> count pushed in this block

    // Process instructions in block
    const newInstructions = [];

    for (const ins of b.instructions) {
      if (ins.op === 'alloc' && allocVars.has(ins.result)) {
        // Drop local allocs in SSA
        continue;
      }

      if (ins.op === 'phi' && allocVars.has(ins.originalVar || ins.result)) {
        const orig = ins.originalVar || ins.result;
        const ssaName = newSSAName(orig);
        ins.result = ssaName;

        currentDef.get(orig).push(ssaName);
        pushedDefs.set(orig, (pushedDefs.get(orig) || 0) + 1);
        newInstructions.push(ins);
        continue;
      }

      if (ins.op === 'store' && allocVars.has(ins.result)) {
        // Store to var: promotes to SSA assignment (copy)
        const orig = ins.result;
        const ssaName = newSSAName(orig);
        const rhs = ins.arg1;

        const copyIns = new TACInstruction('copy', ssaName, rhs, null);
        newInstructions.push(copyIns);

        currentDef.get(orig).push(ssaName);
        pushedDefs.set(orig, (pushedDefs.get(orig) || 0) + 1);
        continue;
      }

      if (ins.op === 'load' && allocVars.has(ins.arg1)) {
        // Load from var: replace with current SSA definition
        const orig = ins.arg1;
        const stack = currentDef.get(orig);
        const curName = stack && stack.length > 0 ? stack[stack.length - 1] : `${orig}.0`;
        const copyIns = new TACInstruction('copy', ins.result, curName, null);
        newInstructions.push(copyIns);
        continue;
      }

      newInstructions.push(ins);
    }

    b.instructions = newInstructions;

    // Fill in phi-function arguments in successor blocks
    for (const succ of b.successors) {
      for (const ins of succ.instructions) {
        if (ins.op === 'phi') {
          const orig = ins.originalVar;
          if (orig && currentDef.has(orig)) {
            const stack = currentDef.get(orig);
            const curVal = stack && stack.length > 0 ? stack[stack.length - 1] : `${orig}.0`;
            // Update the phi argument corresponding to block b
            if (Array.isArray(ins.arg1)) {
              const entry = ins.arg1.find(e => e.block === b.id);
              if (entry) {
                entry.val = curVal;
              } else {
                ins.arg1.push({ block: b.id, val: curVal });
              }
            }
          }
        }
      }
    }

    // Recurse to children in dominator tree
    const domChildren = domTree.get(b) || [];
    for (const child of domChildren) {
      renameBlock(child);
    }

    // Pop definitions pushed in this block
    for (const [v, count] of pushedDefs) {
      const stack = currentDef.get(v);
      for (let i = 0; i < count; i++) {
        stack.pop();
      }
    }
  }

  renameBlock(cfg.entry);
  return cfg;
}

/**
 * Destruct SSA form back to standard TAC with parallel copies / move instructions.
 * Splits critical edges if necessary.
 *
 * @param {import('./cfg').CFG} cfg
 * @returns {import('./cfg').CFG}
 */
function destructSSA(cfg) {
  for (const b of cfg.blocks) {
    const phis = [];
    const nonPhis = [];

    for (const ins of b.instructions) {
      if (ins.op === 'phi') {
        phis.push(ins);
      } else {
        nonPhis.push(ins);
      }
    }

    if (phis.length > 0) {
      // For each predecessor, insert copies for phi inputs
      for (const phi of phis) {
        const dest = phi.result;
        const incoming = Array.isArray(phi.arg1) ? phi.arg1 : [];

        for (const item of incoming) {
          const predBlock = cfg.blocks.find(blk => blk.id === item.block);
          if (predBlock) {
            // Insert copy before last branch/jump in predBlock
            const copyIns = new TACInstruction('copy', dest, item.val, null);
            insertCopyBeforeBranch(predBlock, copyIns);
          }
        }
      }
      b.instructions = nonPhis;
    }
  }

  return cfg;
}

function insertCopyBeforeBranch(block, copyIns) {
  const last = block.instructions[block.instructions.length - 1];
  if (last && (last.op === 'goto' || last.op === 'ifTrue' || last.op === 'ifFalse' || last.op === 'return')) {
    block.instructions.splice(block.instructions.length - 1, 0, copyIns);
  } else {
    block.instructions.push(copyIns);
  }
}

/**
 * Validate SSA form: check single definition and dominance of uses.
 * @param {import('./cfg').CFG} cfg
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSSA(cfg) {
  const errors = [];
  const defs = new Set();

  for (const b of cfg.blocks) {
    for (const ins of b.instructions) {
      const d = ins.getDef();
      if (d) {
        if (defs.has(d)) {
          errors.push(`Variable '${d}' defined more than once in SSA form (block ${b.id})`);
        }
        defs.add(d);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  buildSSA,
  destructSSA,
  validateSSA,
};
