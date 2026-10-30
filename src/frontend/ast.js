'use strict';

/**
 * @module ast
 * @description AST node definitions, factory, and visitor for the NexCC C-subset.
 *
 * Every node carries a `type` tag (string) and a `loc` property
 * `{ line, col }` for diagnostics.
 */

// ── Node type tags ─────────────────────────────────────────────────────────────

/**
 * Canonical set of AST node type strings.
 * @enum {string}
 */
const NodeType = {
  // Top-level
  Program:      'Program',
  FunctionDecl: 'FunctionDecl',
  StructDecl:   'StructDecl',
  VarDecl:      'VarDecl',

  // Statements
  Block:        'Block',
  IfStmt:       'IfStmt',
  WhileStmt:    'WhileStmt',
  ForStmt:      'ForStmt',
  ReturnStmt:   'ReturnStmt',
  BreakStmt:    'BreakStmt',
  ContinueStmt: 'ContinueStmt',
  ExprStmt:     'ExprStmt',

  // Expressions
  BinaryExpr:   'BinaryExpr',
  UnaryExpr:    'UnaryExpr',
  CallExpr:     'CallExpr',
  IndexExpr:    'IndexExpr',
  MemberExpr:   'MemberExpr',
  AssignExpr:   'AssignExpr',
  CastExpr:     'CastExpr',
  SizeofExpr:   'SizeofExpr',
  MallocExpr:   'MallocExpr',

  // Primaries
  Identifier:    'Identifier',
  IntLiteral:    'IntLiteral',
  CharLiteral:   'CharLiteral',
  StringLiteral: 'StringLiteral',
  BoolLiteral:   'BoolLiteral',
  NullLiteral:   'NullLiteral',
};

Object.freeze(NodeType);

// ── Base class ─────────────────────────────────────────────────────────────────

/**
 * Base class for all AST nodes.
 */
class ASTNode {
  /**
   * @param {string} type - Node type tag (one of NodeType values)
   * @param {Object} loc  - Source location `{ line, col }`
   */
  constructor(type, loc) {
    /** @type {string} */
    this.type = type;
    /** @type {{ line: number, col: number }} */
    this.loc = loc || { line: 0, col: 0 };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create an AST node of the given type with the supplied properties.
 *
 * @param {string} type  - One of the NodeType values
 * @param {Object} props - Properties to copy onto the node
 * @returns {ASTNode}
 *
 * @example
 * createNode('IntLiteral', { value: 42, loc: { line: 1, col: 5 } });
 */
function createNode(type, props = {}) {
  const node = new ASTNode(type, props.loc);
  for (const key of Object.keys(props)) {
    if (key !== 'loc') {
      if (key === 'type') {
        // If props already has type, it's a data/type specifier (e.g. VarDecl.type)
        node.varType = props.type;
        node.dataType = props.type;
      } else {
        node[key] = props[key];
      }
    }
  }
  return node;
}

// ── Visitor / traversal ────────────────────────────────────────────────────────

/**
 * @typedef {Object} Visitors
 * A map from NodeType strings to handler functions.
 * Each handler receives `(node, recurse)` where `recurse` walks child nodes.
 * If no handler is registered the default recursion happens automatically.
 */

/**
 * Walk an AST tree, calling visitor callbacks.
 *
 * @param {ASTNode} node     - Root node
 * @param {Visitors} visitors - Map of `{ NodeType: (node, recurse) => void }`
 */
function visitAST(node, visitors) {
  if (!node || typeof node !== 'object') return;

  const handler = visitors[node.type];

  /** Recurse into all child nodes */
  function recurse() {
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'resolvedType') continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === 'object' && child.type) {
            visitAST(child, visitors);
          }
        }
      } else if (val && typeof val === 'object' && val.type && typeof val.type === 'string') {
        visitAST(val, visitors);
      }
    }
  }

  if (handler) {
    handler(node, recurse);
  } else {
    recurse();
  }
}

module.exports = { NodeType, ASTNode, createNode, visitAST };
