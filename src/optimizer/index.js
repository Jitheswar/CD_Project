'use strict';

/**
 * @module optimizer
 * @description NexCC Optimization Engine:
 *   - Pass & PassManager with immutable snapshots
 *   - mem2reg (Stack -> SSA promotion)
 *   - SCCP (Sparse Conditional Constant Propagation)
 *   - GVN (Global Value Numbering)
 *   - LICM (Loop Invariant Code Motion)
 *   - DCE (Dead Code Elimination)
 *   - Configurable levels: -O0, -O1, -O2, -O3
 */

const { PassSnapshot, Pass, PassManager } = require('./pass');
const { Mem2RegPass } = require('./mem2reg');
const { SCCPPass } = require('./sccp');
const { GVNPass } = require('./gvn');
const { LICMPass } = require('./licm');
const { DCEPass } = require('./dce');
const { optimize } = require('./pipeline');

module.exports = {
  PassSnapshot,
  Pass,
  PassManager,
  Mem2RegPass,
  SCCPPass,
  GVNPass,
  LICMPass,
  DCEPass,
  optimize,
};
