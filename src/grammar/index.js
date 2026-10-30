'use strict';

/**
 * @module grammar
 * @description Educational Grammar analysis, table construction, and parsing module.
 * Supports:
 *   - FIRST & FOLLOW sets
 *   - Left recursion elimination & left factoring
 *   - LL(1) table generator & predictive parser
 *   - LR(0), SLR(1), CLR(1), LALR(1) table generators & shift-reduce parser
 *   - Conflict diagnostics
 *   - SDD / SDT semantic evaluations
 */

const { Grammar } = require('./grammar');
const { computeFirst, computeFollow, firstOfString } = require('./first-follow');
const { buildLL1Table, parseLL1, isLL1 } = require('./ll1');
const {
  LRItem,
  closure,
  gotoSet,
  buildCanonicalCollection,
  buildLR0Table,
  buildSLRTable,
  buildCLRTable,
  buildLALRTable,
  parseLR,
  actionToString
} = require('./lr');
const { Attribute, SDDRule, SDD, SDTScheme } = require('./sdd-sdt');

module.exports = {
  Grammar,
  computeFirst,
  computeFollow,
  firstOfString,
  buildLL1Table,
  parseLL1,
  isLL1,
  LRItem,
  closure,
  gotoSet,
  buildCanonicalCollection,
  buildLR0Table,
  buildSLRTable,
  buildCLRTable,
  buildLALRTable,
  parseLR,
  actionToString,
  Attribute,
  SDDRule,
  SDD,
  SDTScheme
};
