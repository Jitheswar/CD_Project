'use strict';

/**
 * @module ir
 * @description Intermediate Representation subsystem for NexCC:
 *   - TAC (Three-Address Code) generator
 *   - CFG (Control-Flow Graph) with dominator trees & dominance frontiers
 *   - SSA (Static Single Assignment) construction & destruction
 *   - Lowered IR with dense virtual registers
 */

const { TACInstruction, TACFunction, TACGenerator } = require('./tac');
const { BasicBlock, CFG } = require('./cfg');
const { buildSSA, destructSSA, validateSSA } = require('./ssa');
const { LoweredInstruction, LoweredFunction, lowerCFG } = require('./lowered-ir');

module.exports = {
  TACInstruction,
  TACFunction,
  TACGenerator,
  BasicBlock,
  CFG,
  buildSSA,
  destructSSA,
  validateSSA,
  LoweredInstruction,
  LoweredFunction,
  lowerCFG,
};
