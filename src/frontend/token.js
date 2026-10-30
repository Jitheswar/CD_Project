'use strict';

/**
 * @module token
 * @description Token type definitions for the NexCC C-subset lexer.
 */

/**
 * Enum of all token types recognized by the NexCC frontend.
 * @enum {string}
 */
const TokenType = {
  // ── Literals ──────────────────────────────────────────────────────────
  INT_LIT:    'INT_LIT',
  CHAR_LIT:   'CHAR_LIT',
  STRING_LIT: 'STRING_LIT',
  BOOL_LIT:   'BOOL_LIT',

  // ── Identifiers ──────────────────────────────────────────────────────
  IDENT: 'IDENT',

  // ── Keywords ─────────────────────────────────────────────────────────
  KW_INT:      'KW_INT',
  KW_CHAR:     'KW_CHAR',
  KW_BOOL:     'KW_BOOL',
  KW_VOID:     'KW_VOID',
  KW_STRUCT:   'KW_STRUCT',
  KW_IF:       'KW_IF',
  KW_ELSE:     'KW_ELSE',
  KW_WHILE:    'KW_WHILE',
  KW_FOR:      'KW_FOR',
  KW_RETURN:   'KW_RETURN',
  KW_BREAK:    'KW_BREAK',
  KW_CONTINUE: 'KW_CONTINUE',
  KW_SIZEOF:   'KW_SIZEOF',
  KW_TRUE:     'KW_TRUE',
  KW_FALSE:    'KW_FALSE',
  KW_MALLOC:   'KW_MALLOC',
  KW_FREE:     'KW_FREE',
  KW_NULL:     'KW_NULL',

  // ── Operators ────────────────────────────────────────────────────────
  PLUS:    'PLUS',
  MINUS:   'MINUS',
  STAR:    'STAR',
  SLASH:   'SLASH',
  PERCENT: 'PERCENT',

  AMP:   'AMP',
  PIPE:  'PIPE',
  CARET: 'CARET',
  TILDE: 'TILDE',
  SHL:   'SHL',
  SHR:   'SHR',

  AND: 'AND',
  OR:  'OR',
  NOT: 'NOT',

  EQ:  'EQ',
  NEQ: 'NEQ',
  LT:  'LT',
  GT:  'GT',
  LEQ: 'LEQ',
  GEQ: 'GEQ',

  ASSIGN:       'ASSIGN',
  PLUS_ASSIGN:  'PLUS_ASSIGN',
  MINUS_ASSIGN: 'MINUS_ASSIGN',
  STAR_ASSIGN:  'STAR_ASSIGN',
  SLASH_ASSIGN: 'SLASH_ASSIGN',
  PERCENT_ASSIGN: 'PERCENT_ASSIGN',
  AMP_ASSIGN:   'AMP_ASSIGN',
  PIPE_ASSIGN:  'PIPE_ASSIGN',
  CARET_ASSIGN: 'CARET_ASSIGN',
  SHL_ASSIGN:   'SHL_ASSIGN',
  SHR_ASSIGN:   'SHR_ASSIGN',

  INCREMENT: 'INCREMENT',
  DECREMENT: 'DECREMENT',

  // ── Delimiters ───────────────────────────────────────────────────────
  LPAREN:    'LPAREN',
  RPAREN:    'RPAREN',
  LBRACE:    'LBRACE',
  RBRACE:    'RBRACE',
  LBRACKET:  'LBRACKET',
  RBRACKET:  'RBRACKET',
  SEMICOLON: 'SEMICOLON',
  COMMA:     'COMMA',
  DOT:       'DOT',
  ARROW:     'ARROW',

  // ── Special ──────────────────────────────────────────────────────────
  EOF: 'EOF'
};

// Freeze to prevent accidental mutation
Object.freeze(TokenType);

/**
 * A single token produced by the lexer.
 */
class Token {
  /**
   * @param {string} type  - One of the TokenType values
   * @param {*}      value - Semantic value (string text, numeric value, etc.)
   * @param {number} line  - 1-based source line
   * @param {number} col   - 1-based source column
   */
  constructor(type, value, line, col) {
    /** @type {string} */
    this.type = type;
    /** @type {*} */
    this.value = value;
    /** @type {number} */
    this.line = line;
    /** @type {number} */
    this.col = col;
  }

  /**
   * Human-readable representation for debugging.
   * @returns {string}
   */
  toString() {
    if (this.value !== null && this.value !== undefined) {
      return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
    }
    return `Token(${this.type}, ${this.line}:${this.col})`;
  }
}

module.exports = { TokenType, Token };
