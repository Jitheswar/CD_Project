'use strict';

/**
 * @module pipeline
 * @description Optimization Pipeline configured by optimization level:
 *   -O0: baseline (no passes)
 *   -O1: mem2reg · SCCP · DCE
 *   -O2: mem2reg · SCCP · GVN · DCE
 *   -O3: mem2reg · SCCP · GVN · LICM · DCE · fixed-point cleanup
 */

const { PassManager } = require('./pass');
const { Mem2RegPass } = require('./mem2reg');
const { SCCPPass } = require('./sccp');
const { GVNPass } = require('./gvn');
const { LICMPass } = require('./licm');
const { DCEPass } = require('./dce');

/**
 * Optimize a CFG with the specified optimization level.
 *
 * @param {import('../ir/cfg').CFG} cfg
 * @param {'-O0'|'-O1'|'-O2'|'-O3'|'O0'|'O1'|'O2'|'O3'} level
 * @returns {{ optimizedCFG: import('../ir/cfg').CFG, snapshots: import('./pass').PassSnapshot[] }}
 */
function optimize(cfg, level = '-O2') {
  const normLevel = level.startsWith('-') ? level : `-${level}`;
  const pm = new PassManager(cfg);

  switch (normLevel) {
    case '-O0':
      // Baseline: no optimization
      break;

    case '-O1':
      pm.addPass(new Mem2RegPass());
      pm.addPass(new SCCPPass());
      pm.addPass(new DCEPass());
      break;

    case '-O2':
      pm.addPass(new Mem2RegPass());
      pm.addPass(new SCCPPass());
      pm.addPass(new GVNPass());
      pm.addPass(new DCEPass());
      break;

    case '-O3':
    default:
      pm.addPass(new Mem2RegPass());
      pm.addPass(new SCCPPass());
      pm.addPass(new GVNPass());
      pm.addPass(new LICMPass());
      pm.addPass(new DCEPass());
      // Fixed point pass
      pm.addPass(new SCCPPass());
      pm.addPass(new DCEPass());
      break;
  }

  const result = pm.runAll();
  return {
    optimizedCFG: result.cfg,
    snapshots: result.snapshots
  };
}

module.exports = {
  optimize,
};
