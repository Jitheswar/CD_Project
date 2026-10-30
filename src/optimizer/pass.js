'use strict';

/**
 * @module pass
 * @description Optimization Pass framework and Snapshot manager.
 * Captures immutable snapshots after every pass for the interactive workbench
 * so users can inspect before/after diffs, instruction deltas, and block deltas.
 */

class PassSnapshot {
  /**
   * @param {string} passName
   * @param {object[]} blocks - Snapshot of basic blocks
   * @param {number} instructionCount
   * @param {number} blockCount
   * @param {number} instructionDelta
   * @param {number} blockDelta
   * @param {string} description
   */
  constructor(passName, blocks, instructionCount, blockCount, instructionDelta = 0, blockDelta = 0, description = '') {
    this.passName = passName;
    this.blocks = blocks;
    this.instructionCount = instructionCount;
    this.blockCount = blockCount;
    this.instructionDelta = instructionDelta;
    this.blockDelta = blockDelta;
    this.description = description;
    this.timestamp = Date.now();
  }
}

class Pass {
  /**
   * @param {string} name
   * @param {string} description
   */
  constructor(name, description = '') {
    this.name = name;
    this.description = description;
  }

  /**
   * Run pass on CFG.
   * @param {import('../ir/cfg').CFG} cfg
   * @returns {boolean} true if modified
   */
  run(cfg) {
    throw new Error("Pass.run must be implemented by subclass");
  }
}

class PassManager {
  /**
   * @param {import('../ir/cfg').CFG} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.passes = [];
    this.snapshots = [];
  }

  addPass(pass) {
    this.passes.push(pass);
    return this;
  }

  _captureSnapshot(passName, description) {
    let instCount = 0;
    const blocksCopy = this.cfg.blocks.map(b => {
      instCount += b.instructions.length;
      return {
        id: b.id,
        label: b.label,
        instructions: b.instructions.map(ins => ins.toString()),
        successors: b.successors.map(s => s.id),
        predecessors: b.predecessors.map(p => p.id)
      };
    });

    const blockCount = this.cfg.blocks.length;
    const prev = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
    const instDelta = prev ? instCount - prev.instructionCount : 0;
    const blkDelta = prev ? blockCount - prev.blockCount : 0;

    const snap = new PassSnapshot(
      passName,
      blocksCopy,
      instCount,
      blockCount,
      instDelta,
      blkDelta,
      description
    );
    this.snapshots.push(snap);
    return snap;
  }

  runAll() {
    this._captureSnapshot('Initial IR', 'IR before any optimization passes');

    for (const pass of this.passes) {
      const modified = pass.run(this.cfg);
      this._captureSnapshot(pass.name, pass.description + (modified ? ' (applied changes)' : ' (no changes)'));
    }

    return {
      cfg: this.cfg,
      snapshots: this.snapshots
    };
  }

  getSnapshots() {
    return this.snapshots;
  }
}

module.exports = {
  PassSnapshot,
  Pass,
  PassManager,
};
