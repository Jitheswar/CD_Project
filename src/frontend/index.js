'use strict';

/**
 * @module frontend
 * @description NexCC C-subset frontend:
 *   - Token & Lexer
 *   - AST & AST Visitor
 *   - Recursive Descent Parser
 *   - Type Checker & Typed HIR
 */

const { TokenType, Token } = require('./token');
const { Lexer } = require('./lexer');
const { NodeType, ASTNode, createNode, visitAST } = require('./ast');
const { Parser } = require('./parser');
const { Type, Scope, TypeChecker } = require('./hir');

/**
 * Convenience helper: parse source string to typed HIR.
 * @param {string} source
 * @returns {{ tokens: Token[], ast: ASTNode, hir: ASTNode }}
 */
function compileFrontend(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const typeChecker = new TypeChecker();
  const hir = typeChecker.check(ast);
  return { tokens, ast, hir, errors: [...parser.errors, ...typeChecker.errors] };
}

module.exports = {
  TokenType,
  Token,
  Lexer,
  NodeType,
  ASTNode,
  createNode,
  visitAST,
  Parser,
  Type,
  Scope,
  TypeChecker,
  compileFrontend,
};
