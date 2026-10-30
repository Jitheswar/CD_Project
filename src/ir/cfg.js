'use strict';

/**
 * @module ir/cfg
 * Control Flow Graph construction and analysis.
 *
 * Provides:
 *  - BasicBlock      — a linear sequence of TAC instructions with edges.
 *  - CFG             — the complete control flow graph with dominance,
 *                      loop-detection, and serialisation utilities.
 */

const { TACInstruction } = require('./tac');

// ────────────────────────────────────────────────────────────────────────────
// BasicBlock
// ────────────────────────────────────────────────────────────────────────────

/**
 * A basic block — a maximal sequence of straight-line TAC instructions.
 *
 * @class
 * @property {string}          id            - Unique identifier (e.g. "B0").
 * @property {TACInstruction[]} instructions - The instructions in order.
 * @property {BasicBlock[]}    successors    - Outgoing CFG edges.
 * @property {BasicBlock[]}    predecessors  - Incoming CFG edges.
 * @property {string|null}     label         - Label at the head of the block.
 */
class BasicBlock {
  /**
   * @param {string} id
   */
  constructor(id) {
    this.id = id;
    this.instructions = [];
    this.successors = [];
    this.predecessors = [];
    this.label = null;
  }

  /**
   * Add a successor edge (and the reverse predecessor edge).
   * @param {BasicBlock} block
   */
  addSuccessor(block) {
    if (!this.successors.includes(block)) {
      this.successors.push(block);
    }
    if (!block.predecessors.includes(this)) {
      block.predecessors.push(this);
    }
  }

  /**
   * Remove a successor edge (and the reverse predecessor edge).
   * @param {BasicBlock} block
   */
  removeSuccessor(block) {
    this.successors = this.successors.filter(b => b !== block);
    block.predecessors = block.predecessors.filter(b => b !== this);
  }

  /** @returns {TACInstruction|null} Last instruction (usually a terminator). */
  getTerminator() {
    return this.instructions.length > 0
      ? this.instructions[this.instructions.length - 1]
      : null;
  }

  /** Does the block end with a branch / goto? */
  isTerminated() {
    const t = this.getTerminator();
    return t && (t.op === 'goto' || t.op === 'ifTrue' || t.op === 'ifFalse' || t.op === 'return');
  }

  /** Deep-clone the block (instructions are cloned, edges are NOT re-linked). */
  clone() {
    const b = new BasicBlock(this.id);
    b.label = this.label;
    b.instructions = this.instructions.map(i => i.clone());
    return b;
  }

  toString() {
    const hdr = this.label ? `${this.id} [${this.label}]` : this.id;
    const preds = this.predecessors.map(b => b.id).join(', ');
    const succs = this.successors.map(b => b.id).join(', ');
    const body = this.instructions.map(i => i.toString()).join('\n');
    return `${hdr}  (preds: ${preds})  (succs: ${succs})\n${body}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CFG
// ────────────────────────────────────────────────────────────────────────────

/**
 * Complete Control Flow Graph for one function.
 *
 * @class
 * @property {BasicBlock[]}  blocks  - All basic blocks.
 * @property {BasicBlock}    entry   - Entry block.
 * @property {BasicBlock}    exit    - Exit (sentinel) block.
 */
class CFG {
  /**
   * @param {BasicBlock[]} blocks
   * @param {BasicBlock}   entry
   * @param {BasicBlock}   exit
   */
  constructor(blocks, entry, exit) {
    this.blocks = blocks;
    this.entry = entry;
    this.exit = exit;
  }

  // ── Construction ─────────────────────────────────────────────────────────

  /**
   * Build a CFG from a TACFunction.
   *
   * Algorithm:
   *  1. Identify *leaders* — instructions that begin a basic block.
   *  2. Partition instructions into blocks.
   *  3. Add edges based on branches and fall-through.
   *
   * @param {import('./tac').TACFunction} tacFunction
   * @returns {CFG}
   */
  static fromTAC(tacFunction) {
    const instrs = tacFunction.instructions;
    if (instrs.length === 0) {
      const entry = new BasicBlock('B0');
      const exit = new BasicBlock('Bexit');
      entry.addSuccessor(exit);
      return new CFG([entry, exit], entry, exit);
    }

    // Step 1 – identify leader indices
    const leaderSet = new Set([0]);
    const labelToIndex = new Map();

    for (let i = 0; i < instrs.length; i++) {
      const ins = instrs[i];
      if (ins.op === 'label') {
        leaderSet.add(i);
        labelToIndex.set(ins.label, i);
      }
      if (ins.op === 'goto' || ins.op === 'ifTrue' || ins.op === 'ifFalse') {
        if (i + 1 < instrs.length) leaderSet.add(i + 1);
      }
      if (ins.op === 'return') {
        if (i + 1 < instrs.length) leaderSet.add(i + 1);
      }
    }

    const leaders = Array.from(leaderSet).sort((a, b) => a - b);

    // Step 2 – create blocks
    const blocks = [];
    const indexToBlock = new Map();

    for (let j = 0; j < leaders.length; j++) {
      const start = leaders[j];
      const end = j + 1 < leaders.length ? leaders[j + 1] : instrs.length;
      const block = new BasicBlock(`B${j}`);
      for (let i = start; i < end; i++) {
        block.instructions.push(instrs[i].clone());
      }
      // If first instruction is a label, record it
      if (block.instructions.length > 0 && block.instructions[0].op === 'label') {
        block.label = block.instructions[0].label;
      }
      blocks.push(block);
      indexToBlock.set(start, block);
    }

    // Label → block map
    const labelToBlock = new Map();
    for (const b of blocks) {
      if (b.label) labelToBlock.set(b.label, b);
    }

    // Exit sentinel
    const exit = new BasicBlock('Bexit');

    // Step 3 – add edges
    for (let j = 0; j < blocks.length; j++) {
      const b = blocks[j];
      const term = b.getTerminator();
      if (!term) {
        // Empty block → fall through
        if (j + 1 < blocks.length) b.addSuccessor(blocks[j + 1]);
        continue;
      }
      switch (term.op) {
        case 'goto': {
          const target = labelToBlock.get(term.target);
          if (target) b.addSuccessor(target);
          break;
        }
        case 'ifTrue':
        case 'ifFalse': {
          // Branch target
          const target = labelToBlock.get(term.target);
          if (target) b.addSuccessor(target);
          // Fall-through
          if (j + 1 < blocks.length) b.addSuccessor(blocks[j + 1]);
          break;
        }
        case 'return':
          b.addSuccessor(exit);
          break;
        default:
          // Non-terminator at end — fall through
          if (j + 1 < blocks.length) b.addSuccessor(blocks[j + 1]);
          break;
      }
    }

    const entry = blocks[0];
    blocks.push(exit);

    return new CFG(blocks, entry, exit);
  }

  // ── Traversals ───────────────────────────────────────────────────────────

  /**
   * Reverse Post-Order of the CFG (starting from entry).
   * @returns {BasicBlock[]}
   */
  reversePostOrder() {
    const visited = new Set();
    const order = [];

    const dfs = (block) => {
      if (visited.has(block)) return;
      visited.add(block);
      for (const succ of block.successors) {
        dfs(succ);
      }
      order.push(block);
    };

    dfs(this.entry);
    return order.reverse();
  }

  // ── Dominator Tree ───────────────────────────────────────────────────────

  /**
   * Compute immediate dominators using the iterative algorithm
   * (Cooper, Harvey, Kennedy 2001).
   *
   * @returns {Map<BasicBlock, BasicBlock>}  Map from block → immediate dominator.
   */
  getDominatorTree() {
    const rpo = this.reversePostOrder();
    const rpoIndex = new Map();
    rpo.forEach((b, i) => rpoIndex.set(b, i));

    /** @type {Map<BasicBlock, BasicBlock>} */
    const idom = new Map();
    idom.set(this.entry, this.entry);

    const intersect = (b1, b2) => {
      let f1 = b1, f2 = b2;
      while (f1 !== f2) {
        while (rpoIndex.get(f1) > rpoIndex.get(f2)) f1 = idom.get(f1);
        while (rpoIndex.get(f2) > rpoIndex.get(f1)) f2 = idom.get(f2);
      }
      return f1;
    };

    let changed = true;
    while (changed) {
      changed = false;
      for (const b of rpo) {
        if (b === this.entry) continue;
        // Pick first predecessor that has an idom already
        let newIdom = null;
        for (const pred of b.predecessors) {
          if (idom.has(pred)) {
            newIdom = pred;
            break;
          }
        }
        if (newIdom === null) continue;

        for (const pred of b.predecessors) {
          if (pred === newIdom) continue;
          if (idom.has(pred)) {
            newIdom = intersect(pred, newIdom);
          }
        }

        if (idom.get(b) !== newIdom) {
          idom.set(b, newIdom);
          changed = true;
        }
      }
    }

    return idom;
  }

  /**
   * Get children map from dominator tree: block → [children blocks].
   * @param {Map<BasicBlock, BasicBlock>} [idom]
   * @returns {Map<BasicBlock, BasicBlock[]>}
   */
  getDomTreeChildren(idom) {
    if (!idom) idom = this.getDominatorTree();
    const children = new Map();
    for (const b of this.blocks) children.set(b, []);
    for (const [b, dom] of idom) {
      if (b !== dom) {
        children.get(dom).push(b);
      }
    }
    return children;
  }

  /**
   * Does block `a` dominate block `b`?
   * @param {BasicBlock} a
   * @param {BasicBlock} b
   * @param {Map<BasicBlock, BasicBlock>} [idom]
   * @returns {boolean}
   */
  dominates(a, b, idom) {
    if (!idom) idom = this.getDominatorTree();
    let cur = b;
    while (cur && cur !== a) {
      const dom = idom.get(cur);
      if (dom === cur) break; // reached entry
      cur = dom;
    }
    return cur === a;
  }

  // ── Dominance Frontier ──────────────────────────────────────────────────

  /**
   * Compute dominance frontier for each block.
   *
   * @param {Map<BasicBlock, BasicBlock>} [idom]
   * @returns {Map<BasicBlock, Set<BasicBlock>>}
   */
  getDominanceFrontier(idom) {
    if (!idom) idom = this.getDominatorTree();
    /** @type {Map<BasicBlock, Set<BasicBlock>>} */
    const df = new Map();
    for (const b of this.blocks) df.set(b, new Set());

    for (const b of this.blocks) {
      if (b.predecessors.length < 2) continue;
      for (const pred of b.predecessors) {
        let runner = pred;
        while (runner && runner !== idom.get(b)) {
          df.get(runner).add(b);
          if (runner === idom.get(runner)) break; // entry
          runner = idom.get(runner);
        }
      }
    }

    return df;
  }

  // ── Loop Detection ──────────────────────────────────────────────────────

  /**
   * Identify natural loops via back-edges in the dominator tree.
   *
   * A back edge is an edge n → h where h dominates n.
   *
   * @returns {{ header: BasicBlock, backEdge: BasicBlock, body: Set<BasicBlock> }[]}
   */
  getLoops() {
    const idom = this.getDominatorTree();
    const loops = [];

    for (const b of this.blocks) {
      for (const succ of b.successors) {
        if (this.dominates(succ, b, idom)) {
          // succ → b is a back edge; succ is the header
          const body = this._collectLoopBody(succ, b);
          loops.push({ header: succ, backEdge: b, body });
        }
      }
    }
    return loops;
  }

  /**
   * Collect the natural loop body given a header and a back-edge tail.
   * @private
   * @param {BasicBlock} header
   * @param {BasicBlock} tail
   * @returns {Set<BasicBlock>}
   */
  _collectLoopBody(header, tail) {
    const body = new Set([header]);
    if (header === tail) return body;

    const stack = [tail];
    body.add(tail);
    while (stack.length > 0) {
      const n = stack.pop();
      for (const pred of n.predecessors) {
        if (!body.has(pred)) {
          body.add(pred);
          stack.push(pred);
        }
      }
    }
    return body;
  }

  // ── Serialisation ────────────────────────────────────────────────────────

  /**
   * Serialise the CFG to a plain JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      entry: this.entry.id,
      exit: this.exit.id,
      blocks: this.blocks.map(b => ({
        id: b.id,
        label: b.label,
        instructions: b.instructions.map(i => ({
          op: i.op, result: i.result, arg1: i.arg1, arg2: i.arg2,
          label: i.label, target: i.target, phiArgs: i.phiArgs
        })),
        successors: b.successors.map(s => s.id),
        predecessors: b.predecessors.map(p => p.id)
      }))
    };
  }

  /**
   * Generate a DOT format string for Graphviz visualisation.
   * @returns {string}
   */
  toDot() {
    const lines = ['digraph CFG {', '  node [shape=record fontname="Courier"];'];

    for (const b of this.blocks) {
      const instrText = b.instructions.map(i => i.toString().replace(/"/g, '\\"').trim())
        .join('\\l') + '\\l';
      const lbl = b.label ? `${b.id} (${b.label})` : b.id;
      lines.push(`  ${b.id} [label="{${lbl}|${instrText}}"];`);
    }

    for (const b of this.blocks) {
      for (const succ of b.successors) {
        lines.push(`  ${b.id} -> ${succ.id};`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Deep clone the entire CFG (blocks, instructions, edges).
   * @returns {CFG}
   */
  clone() {
    const blockMap = new Map();

    // Phase 1: clone blocks (no edges)
    for (const b of this.blocks) {
      const nb = b.clone();
      blockMap.set(b, nb);
    }

    // Phase 2: re-link edges
    for (const b of this.blocks) {
      const nb = blockMap.get(b);
      for (const succ of b.successors) {
        const ns = blockMap.get(succ);
        if (ns) nb.addSuccessor(ns);
      }
    }

    const newBlocks = this.blocks.map(b => blockMap.get(b));
    return new CFG(newBlocks, blockMap.get(this.entry), blockMap.get(this.exit));
  }

  /**
   * Get a block by id.
   * @param {string} id
   * @returns {BasicBlock|undefined}
   */
  getBlock(id) {
    return this.blocks.find(b => b.id === id);
  }

  /**
   * Collect all variable/temp names defined anywhere in the CFG.
   * @returns {Set<string>}
   */
  getAllDefs() {
    const defs = new Set();
    for (const b of this.blocks) {
      for (const ins of b.instructions) {
        const d = ins.getDef();
        if (d) defs.add(d);
      }
    }
    return defs;
  }

  /**
   * Collect blocks that define a given variable.
   * @param {string} varName
   * @returns {Set<BasicBlock>}
   */
  getDefBlocks(varName) {
    const result = new Set();
    for (const b of this.blocks) {
      for (const ins of b.instructions) {
        if (ins.getDef() === varName) {
          result.add(b);
        }
      }
    }
    return result;
  }
}

module.exports = { BasicBlock, CFG };
