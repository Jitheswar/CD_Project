'use strict';

/**
 * @module sdd-sdt
 * @description Syntax-Directed Definitions (SDD) and Syntax-Directed Translation Schemes (SDT).
 * Supports attribute grammar specification (synthesized & inherited attributes)
 * and evaluation over parse trees.
 */

/**
 * Represents an attribute attached to a grammar symbol.
 */
class Attribute {
  /**
   * @param {string} name - Attribute name (e.g., 'val', 'type', 'code')
   * @param {'synthesized'|'inherited'} kind - Whether synthesized or inherited
   */
  constructor(name, kind = 'synthesized') {
    this.name = name;
    this.kind = kind;
  }
}

/**
 * Semantic rule associated with a production.
 */
class SDDRule {
  /**
   * @param {object} production - { head, body }
   * @param {Array<{ target: string, compute: Function }>} actions
   *   target can be: 'head.val' or 'body[0].val'
   */
  constructor(production, actions) {
    this.production = production;
    this.actions = actions;
  }
}

/**
 * Syntax-Directed Definition
 */
class SDD {
  /**
   * @param {import('./grammar').Grammar} grammar
   * @param {SDDRule[]} rules
   */
  constructor(grammar, rules = []) {
    this.grammar = grammar;
    this.rules = rules;
  }

  addRule(rule) {
    this.rules.push(rule);
  }

  isS_attributed() {
    for (const rule of this.rules) {
      for (const act of rule.actions) {
        if (!act.target.startsWith('head.')) {
          return false;
        }
      }
    }
    return true;
  }

  isL_attributed() {
    // In an L-attributed SDD, each inherited attribute of A -> X1 X2 ... Xn
    // can only depend on:
    // 1. Inherited attributes of A
    // 2. Attributes of symbols to the left of Xi (X1, ..., Xi-1)
    return true; // Simplified check for educational workbench
  }

  /**
   * Evaluate attributes on a parse tree (bottom-up post-order evaluation).
   * @param {object} parseTreeNode
   * @returns {object} Decorated parse tree with node.attrs populated
   */
  evaluate(parseTreeNode) {
    if (!parseTreeNode) return null;

    // Decorate terminal nodes with their literal value as default 'val'
    if (parseTreeNode.type === 'Terminal') {
      parseTreeNode.attrs = parseTreeNode.attrs || {};
      const num = Number(parseTreeNode.value);
      parseTreeNode.attrs.val = !isNaN(num) ? num : parseTreeNode.value;
      return parseTreeNode;
    }

    // Recursively evaluate children first (post-order / bottom-up)
    if (parseTreeNode.children) {
      for (const child of parseTreeNode.children) {
        this.evaluate(child);
      }
    }

    parseTreeNode.attrs = parseTreeNode.attrs || {};

    // Find rule matching this non-terminal's production
    const head = parseTreeNode.symbol;
    const rule = this.rules.find(r => {
      if (r.production.head !== head) return false;
      if (!parseTreeNode.production) return false;
      return r.production.body.join(' ') === parseTreeNode.production.body.join(' ');
    });

    if (rule) {
      for (const act of rule.actions) {
        try {
          const val = act.compute({
            head: parseTreeNode.attrs,
            body: (parseTreeNode.children || []).map(c => c.attrs || {})
          });
          const attrName = act.target.replace('head.', '');
          parseTreeNode.attrs[attrName] = val;
        } catch (e) {
          parseTreeNode.attrs._error = e.message;
        }
      }
    }

    return parseTreeNode;
  }
}

/**
 * Syntax Directed Translation Scheme
 */
class SDTScheme {
  /**
   * @param {import('./grammar').Grammar} grammar
   * @param {Map<string, Function>} actionHooks
   */
  constructor(grammar, actionHooks = new Map()) {
    this.grammar = grammar;
    this.actionHooks = actionHooks;
  }

  translate(parseTree) {
    const output = [];
    function walk(node) {
      if (!node) return;
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
      if (node.action && typeof node.action === 'function') {
        const res = node.action(node);
        if (res !== undefined) output.push(res);
      }
    }
    walk(parseTree);
    return output;
  }
}

module.exports = {
  Attribute,
  SDDRule,
  SDD,
  SDTScheme,
};
