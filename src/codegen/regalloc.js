'use strict';

/**
 * @module regalloc
 * @description Chaitin-Briggs Graph Coloring Register Allocator for RV32IM.
 * Performs:
 *   1. Liveness analysis (backward dataflow equations)
 *   2. Interference graph construction
 *   3. Kempe heuristic graph coloring
 *   4. Spill rewriting with stack slots
 */

const {
  ALLOCATABLE_REGS,
  isVirtualReg,
  MIRInstruction
} = require('./mir');

/**
 * Backward dataflow liveness analysis over MIR basic blocks.
 *
 * @param {import('./mir').MIRFunction} mirFunc
 * @returns {{ liveIn: Map<string, Set<string>>, liveOut: Map<string, Set<string>> }}
 */
function computeLiveness(mirFunc) {
  const liveIn = new Map();
  const liveOut = new Map();
  const useMap = new Map();
  const defMap = new Map();

  for (const block of mirFunc.blocks) {
    liveIn.set(block.id, new Set());
    liveOut.set(block.id, new Set());

    const bUse = new Set();
    const bDef = new Set();

    for (const ins of block.instructions) {
      for (const src of ins.getSources()) {
        if (isVirtualReg(src) && !bDef.has(src)) {
          bUse.add(src);
        }
      }
      for (const d of ins.getDefs()) {
        if (isVirtualReg(d)) {
          bDef.add(d);
        }
      }
    }
    useMap.set(block.id, bUse);
    defMap.set(block.id, bDef);
  }

  // Iterate to fixed point
  let changed = true;
  while (changed) {
    changed = false;
    // Walk in reverse
    for (let i = mirFunc.blocks.length - 1; i >= 0; i--) {
      const block = mirFunc.blocks[i];
      const curOut = liveOut.get(block.id);

      // LiveOut[B] = Union(LiveIn[S]) for S in successors
      const newOut = new Set();
      for (const succId of block.successors) {
        const succIn = liveIn.get(succId);
        if (succIn) {
          for (const reg of succIn) newOut.add(reg);
        }
      }

      // Check if LiveOut changed
      if (newOut.size !== curOut.size) {
        changed = true;
        liveOut.set(block.id, newOut);
      }

      // LiveIn[B] = Use[B] Union (LiveOut[B] - Def[B])
      const bUse = useMap.get(block.id);
      const bDef = defMap.get(block.id);
      const curIn = liveIn.get(block.id);

      const newIn = new Set(bUse);
      for (const reg of newOut) {
        if (!bDef.has(reg)) {
          newIn.add(reg);
        }
      }

      if (newIn.size !== curIn.size) {
        changed = true;
        liveIn.set(block.id, newIn);
      }
    }
  }

  return { liveIn, liveOut };
}

/**
 * Build the register interference graph from liveness analysis.
 */
function buildInterferenceGraph(mirFunc, liveness) {
  const adjList = new Map(); // vreg -> Set<vreg>

  function addNode(r) {
    if (!adjList.has(r)) adjList.set(r, new Set());
  }

  function addEdge(u, v) {
    if (u === v) return;
    addNode(u);
    addNode(v);
    adjList.get(u).add(v);
    adjList.get(v).add(u);
  }

  // Ensure all vregs defined or used have nodes
  for (const block of mirFunc.blocks) {
    for (const ins of block.instructions) {
      for (const d of ins.getDefs()) if (isVirtualReg(d)) addNode(d);
      for (const s of ins.getSources()) if (isVirtualReg(s)) addNode(s);
    }
  }

  // Backward walk in each block to add interference edges
  for (const block of mirFunc.blocks) {
    const live = new Set(liveness.liveOut.get(block.id) || []);

    for (let i = block.instructions.length - 1; i >= 0; i--) {
      const ins = block.instructions[i];
      const defs = ins.getDefs().filter(isVirtualReg);

      for (const d of defs) {
        for (const l of live) {
          addEdge(d, l);
        }
      }

      // Remove defs from live
      for (const d of defs) live.delete(d);

      // Add uses to live
      for (const s of ins.getSources()) {
        if (isVirtualReg(s)) live.add(s);
      }
    }
  }

  return adjList;
}

/**
 * Kempe heuristic graph coloring.
 */
function colorGraph(adjList, availableColors) {
  const K = availableColors.length;
  const degrees = new Map();
  const graph = new Map();

  for (const [node, neighbors] of adjList) {
    degrees.set(node, neighbors.size);
    graph.set(node, new Set(neighbors));
  }

  const stack = [];
  const removed = new Set();
  const allNodes = Array.from(adjList.keys());

  while (removed.size < allNodes.length) {
    // Find node with degree < K
    let candidate = null;
    for (const n of allNodes) {
      if (!removed.has(n) && (degrees.get(n) || 0) < K) {
        candidate = n;
        break;
      }
    }

    if (!candidate) {
      // Potential spill: pick node with maximum degree
      let maxDeg = -1;
      for (const n of allNodes) {
        if (!removed.has(n) && (degrees.get(n) || 0) > maxDeg) {
          maxDeg = degrees.get(n) || 0;
          candidate = n;
        }
      }
    }

    removed.add(candidate);
    stack.push(candidate);

    // Update degrees of neighbors
    for (const neighbor of graph.get(candidate) || []) {
      if (!removed.has(neighbor)) {
        degrees.set(neighbor, (degrees.get(neighbor) || 1) - 1);
      }
    }
  }

  // Color nodes from stack
  const allocation = new Map(); // vreg -> physReg
  const spilled = new Set();

  while (stack.length > 0) {
    const node = stack.pop();
    const usedColors = new Set();

    for (const neighbor of adjList.get(node) || []) {
      if (allocation.has(neighbor)) {
        usedColors.add(allocation.get(neighbor));
      }
    }

    // Pick first available color
    let assigned = null;
    for (const c of availableColors) {
      if (!usedColors.has(c)) {
        assigned = c;
        break;
      }
    }

    if (assigned) {
      allocation.set(node, assigned);
    } else {
      spilled.add(node);
    }
  }

  return { allocation, spilled };
}

/**
 * Rewrite spilled virtual registers with stack load/store slots.
 */
function rewriteSpills(mirFunc, spilled) {
  if (spilled.size === 0) return 0;

  const spillSlots = new Map();
  let slotOffset = 0;
  for (const s of spilled) {
    spillSlots.set(s, slotOffset);
    slotOffset += 4;
  }

  for (const block of mirFunc.blocks) {
    const newInstrs = [];

    for (const ins of block.instructions) {
      // If uses a spilled register, load before
      const sources = ins.getSources();
      for (const src of sources) {
        if (spilled.has(src)) {
          const off = spillSlots.get(src);
          newInstrs.push(new MIRInstruction({
            opcode: 'lw',
            dest: 't6', // Scratch register
            src1: 'fp',
            imm: -off - 16,
            comment: `reload spilled ${src}`
          }));
          ins.renameSource(src, 't6');
        }
      }

      newInstrs.push(ins);

      // If defines a spilled register, store after
      const defs = ins.getDefs();
      for (const def of defs) {
        if (spilled.has(def)) {
          const off = spillSlots.get(def);
          ins.renameDef(def, 't6');
          newInstrs.push(new MIRInstruction({
            opcode: 'sw',
            src1: 't6',
            src2: 'fp',
            imm: -off - 16,
            comment: `spill ${def}`
          }));
        }
      }
    }

    block.instructions = newInstrs;
  }

  return slotOffset;
}

/**
 * Full register allocation pipeline for a MIR function.
 */
function allocateRegisters(mirFunc) {
  const availableColors = [...ALLOCATABLE_REGS];
  let totalSpillBytes = 0;

  let liveness = computeLiveness(mirFunc);
  let adjList = buildInterferenceGraph(mirFunc, liveness);
  let { allocation, spilled } = colorGraph(adjList, availableColors);

  if (spilled.size > 0) {
    totalSpillBytes = rewriteSpills(mirFunc, spilled);
    // Recompute and recolor
    liveness = computeLiveness(mirFunc);
    adjList = buildInterferenceGraph(mirFunc, liveness);
    const retry = colorGraph(adjList, availableColors);
    allocation = retry.allocation;
  }

  // Replace virtual registers with physical registers in all instructions
  for (const block of mirFunc.blocks) {
    for (const ins of block.instructions) {
      if (isVirtualReg(ins.dest) && allocation.has(ins.dest)) {
        ins.dest = allocation.get(ins.dest);
      }
      if (isVirtualReg(ins.src1) && allocation.has(ins.src1)) {
        ins.src1 = allocation.get(ins.src1);
      }
      if (isVirtualReg(ins.src2) && allocation.has(ins.src2)) {
        ins.src2 = allocation.get(ins.src2);
      }
    }
  }

  mirFunc.allocation = allocation;
  mirFunc.spillBytes = totalSpillBytes;
  return mirFunc;
}

module.exports = {
  computeLiveness,
  buildInterferenceGraph,
  colorGraph,
  rewriteSpills,
  allocateRegisters,
};
