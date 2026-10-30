'use strict';

/**
 * @module lexer
 * @description Hand-written lexer for the NexCC C-subset language.
 *
 * Features:
 * - Maximal munch tokenization
 * - Keyword priority (identifiers that match a keyword produce the keyword token)
 * - Line / column tracking for diagnostics
 * - Skips whitespace and comments (// line, /* block *​/)
 * - String literals with escape sequences, char literals, integer literals
 *   (decimal, hex 0x…, octal 0…)
 */

const { TokenType, Token } = require('./token');

// ── Keyword map ────────────────────────────────────────────────────────────────
/** @type {Object<string,string>} */
const KEYWORDS = {
  'int':      TokenType.KW_INT,
  'char':     TokenType.KW_CHAR,
  'bool':     TokenType.KW_BOOL,
  'void':     TokenType.KW_VOID,
  'struct':   TokenType.KW_STRUCT,
  'if':       TokenType.KW_IF,
  'else':     TokenType.KW_ELSE,
  'while':    TokenType.KW_WHILE,
  'for':      TokenType.KW_FOR,
  'return':   TokenType.KW_RETURN,
  'break':    TokenType.KW_BREAK,
  'continue': TokenType.KW_CONTINUE,
  'sizeof':   TokenType.KW_SIZEOF,
  'true':     TokenType.KW_TRUE,
  'false':    TokenType.KW_FALSE,
  'malloc':   TokenType.KW_MALLOC,
  'free':     TokenType.KW_FREE,
  'NULL':     TokenType.KW_NULL,
};

// ── Escape-sequence map ────────────────────────────────────────────────────────
const ESCAPE_MAP = {
  'n':  '\n',
  't':  '\t',
  'r':  '\r',
  '0':  '\0',
  '\\': '\\',
  '\'': '\'',
  '"':  '"',
  'a':  '\x07',
  'b':  '\b',
  'f':  '\f',
  'v':  '\v',
};

/**
 * Lexical error with source location.
 */
class LexerError extends Error {
  /**
   * @param {string} message
   * @param {number} line
   * @param {number} col
   */
  constructor(message, line, col) {
    super(`Lexer error at ${line}:${col}: ${message}`);
    this.name = 'LexerError';
    this.line = line;
    this.col = col;
  }
}

/**
 * Hand-written lexer (scanner) for the NexCC C-subset.
 *
 * Usage:
 * ```js
 * const tokens = new Lexer(sourceCode).tokenize();
 * ```
 */
class Lexer {
  /**
   * @param {string} source - Complete source text to tokenize
   */
  constructor(source) {
    /** @private */
    this.source = source;
    /** @private Current byte offset */
    this.pos = 0;
    /** @private 1-based line number */
    this.line = 1;
    /** @private 1-based column number */
    this.col = 1;
    /** @private Collected tokens */
    this.tokens = [];
    /** @private Collected errors (for multi-error reporting) */
    this.errors = [];
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /** @private */
  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] : '\0';
  }

  /** @private */
  advance() {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  /** @private */
  match(expected) {
    if (this.pos < this.source.length && this.source[this.pos] === expected) {
      this.advance();
      return true;
    }
    return false;
  }

  /** @private */
  isAtEnd() {
    return this.pos >= this.source.length;
  }

  /** @private */
  addToken(type, value, line, col) {
    this.tokens.push(new Token(type, value, line, col));
  }

  /** @private */
  error(msg) {
    const err = new LexerError(msg, this.line, this.col);
    this.errors.push(err);
  }

  // ── Whitespace & comments ─────────────────────────────────────────────

  /** @private Skip whitespace and comments, return true if anything was consumed. */
  skipWhitespaceAndComments() {
    let skipped = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        skipped = true;
        continue;
      }

      // Line comment
      if (ch === '/' && this.peek(1) === '/') {
        this.advance(); // /
        this.advance(); // /
        while (!this.isAtEnd() && this.peek() !== '\n') {
          this.advance();
        }
        skipped = true;
        continue;
      }

      // Block comment
      if (ch === '/' && this.peek(1) === '*') {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // /
        this.advance(); // *
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          if (this.peek() === '/' && this.peek(1) === '*') {
            // Nested block comments are NOT standard C — just treat inner /* as text
            this.advance();
            continue;
          }
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance(); // *
            this.advance(); // /
            depth--;
            continue;
          }
          this.advance();
        }
        if (depth > 0) {
          this.error(`Unterminated block comment starting at ${startLine}:${startCol}`);
        }
        skipped = true;
        continue;
      }

      break;
    }
    return skipped;
  }

  // ── Number literals ───────────────────────────────────────────────────

  /** @private */
  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let raw = '';

    // Check for hex or octal prefix
    if (this.peek() === '0') {
      const next = this.peek(1);

      // Hex: 0x or 0X
      if (next === 'x' || next === 'X') {
        raw += this.advance(); // '0'
        raw += this.advance(); // 'x'
        if (!isHexDigit(this.peek())) {
          this.error('Expected hex digits after 0x');
          return;
        }
        while (!this.isAtEnd() && isHexDigit(this.peek())) {
          raw += this.advance();
        }
        // Check no identifier char follows immediately
        if (!this.isAtEnd() && isIdentChar(this.peek())) {
          this.error(`Invalid suffix on hex literal '${raw}'`);
          while (!this.isAtEnd() && isIdentChar(this.peek())) this.advance();
          return;
        }
        this.addToken(TokenType.INT_LIT, parseInt(raw, 16), startLine, startCol);
        return;
      }

      // Octal: 0 followed by digits
      if (isDigit(next)) {
        raw += this.advance(); // '0'
        while (!this.isAtEnd() && isDigit(this.peek())) {
          const d = this.peek();
          if (d === '8' || d === '9') {
            this.error(`Invalid digit '${d}' in octal literal`);
          }
          raw += this.advance();
        }
        if (!this.isAtEnd() && isIdentChar(this.peek())) {
          this.error(`Invalid suffix on octal literal '${raw}'`);
          while (!this.isAtEnd() && isIdentChar(this.peek())) this.advance();
          return;
        }
        this.addToken(TokenType.INT_LIT, parseInt(raw, 8), startLine, startCol);
        return;
      }
    }

    // Decimal
    while (!this.isAtEnd() && isDigit(this.peek())) {
      raw += this.advance();
    }
    if (!this.isAtEnd() && isIdentChar(this.peek())) {
      this.error(`Invalid suffix on integer literal '${raw}'`);
      while (!this.isAtEnd() && isIdentChar(this.peek())) this.advance();
      return;
    }
    this.addToken(TokenType.INT_LIT, parseInt(raw, 10), startLine, startCol);
  }

  // ── String literals ───────────────────────────────────────────────────

  /** @private */
  readString() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // opening "
    let value = '';
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\n') {
        this.error('Unterminated string literal (newline in string)');
        return;
      }
      if (this.peek() === '\\') {
        this.advance(); // backslash
        const esc = this.advance();
        if (esc in ESCAPE_MAP) {
          value += ESCAPE_MAP[esc];
        } else if (esc === 'x') {
          // Hex escape \xHH
          let hex = '';
          for (let i = 0; i < 2 && !this.isAtEnd() && isHexDigit(this.peek()); i++) {
            hex += this.advance();
          }
          if (hex.length === 0) {
            this.error('Expected hex digits after \\x');
          } else {
            value += String.fromCharCode(parseInt(hex, 16));
          }
        } else {
          this.error(`Unknown escape sequence '\\${esc}'`);
          value += esc;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.isAtEnd()) {
      this.error('Unterminated string literal');
      return;
    }
    this.advance(); // closing "
    this.addToken(TokenType.STRING_LIT, value, startLine, startCol);
  }

  // ── Char literals ────────────────────────────────────────────────────

  /** @private */
  readChar() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // opening '
    let value;
    if (this.isAtEnd() || this.peek() === '\n') {
      this.error('Unterminated character literal');
      return;
    }
    if (this.peek() === '\\') {
      this.advance(); // backslash
      const esc = this.advance();
      if (esc in ESCAPE_MAP) {
        value = ESCAPE_MAP[esc];
      } else if (esc === 'x') {
        let hex = '';
        for (let i = 0; i < 2 && !this.isAtEnd() && isHexDigit(this.peek()); i++) {
          hex += this.advance();
        }
        if (hex.length === 0) {
          this.error('Expected hex digits after \\x in char literal');
          return;
        }
        value = String.fromCharCode(parseInt(hex, 16));
      } else {
        this.error(`Unknown escape sequence '\\${esc}' in char literal`);
        value = esc;
      }
    } else if (this.peek() === '\'') {
      this.error('Empty character literal');
      this.advance();
      return;
    } else {
      value = this.advance();
    }
    if (this.isAtEnd() || this.peek() !== '\'') {
      this.error('Unterminated or multi-character character literal');
      // Try to recover by consuming until ' or end of line
      while (!this.isAtEnd() && this.peek() !== '\'' && this.peek() !== '\n') {
        this.advance();
      }
      if (!this.isAtEnd() && this.peek() === '\'') this.advance();
      return;
    }
    this.advance(); // closing '
    this.addToken(TokenType.CHAR_LIT, value, startLine, startCol);
  }

  // ── Identifiers / keywords ───────────────────────────────────────────

  /** @private */
  readIdentOrKeyword() {
    const startLine = this.line;
    const startCol = this.col;
    let raw = '';
    while (!this.isAtEnd() && isIdentChar(this.peek())) {
      raw += this.advance();
    }
    if (raw in KEYWORDS) {
      const kw = KEYWORDS[raw];
      // true / false are BOOL_LIT
      if (kw === TokenType.KW_TRUE) {
        this.addToken(TokenType.BOOL_LIT, true, startLine, startCol);
      } else if (kw === TokenType.KW_FALSE) {
        this.addToken(TokenType.BOOL_LIT, false, startLine, startCol);
      } else {
        this.addToken(kw, raw, startLine, startCol);
      }
    } else {
      this.addToken(TokenType.IDENT, raw, startLine, startCol);
    }
  }

  // ── Main tokenize loop ───────────────────────────────────────────────

  /**
   * Tokenize the entire source string.
   * @returns {Token[]} Array of tokens, ending with EOF.
   * @throws {LexerError} On the first unrecoverable error, or aggregated errors.
   */
  tokenize() {
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;

      const ch = this.peek();
      const startLine = this.line;
      const startCol = this.col;

      // ── Numbers ────────────────────────────────────────────────────
      if (isDigit(ch)) {
        this.readNumber();
        continue;
      }

      // ── Identifiers / keywords ─────────────────────────────────────
      if (isIdentStart(ch)) {
        this.readIdentOrKeyword();
        continue;
      }

      // ── String literal ─────────────────────────────────────────────
      if (ch === '"') {
        this.readString();
        continue;
      }

      // ── Char literal ──────────────────────────────────────────────
      if (ch === '\'') {
        this.readChar();
        continue;
      }

      // ── Operators & delimiters (maximal munch) ─────────────────────
      this.advance(); // consume first char

      switch (ch) {
        // Single-char delimiters
        case '(': this.addToken(TokenType.LPAREN,    '(', startLine, startCol); break;
        case ')': this.addToken(TokenType.RPAREN,    ')', startLine, startCol); break;
        case '{': this.addToken(TokenType.LBRACE,    '{', startLine, startCol); break;
        case '}': this.addToken(TokenType.RBRACE,    '}', startLine, startCol); break;
        case '[': this.addToken(TokenType.LBRACKET,  '[', startLine, startCol); break;
        case ']': this.addToken(TokenType.RBRACKET,  ']', startLine, startCol); break;
        case ';': this.addToken(TokenType.SEMICOLON, ';', startLine, startCol); break;
        case ',': this.addToken(TokenType.COMMA,     ',', startLine, startCol); break;
        case '~': this.addToken(TokenType.TILDE,     '~', startLine, startCol); break;

        // Dot
        case '.': this.addToken(TokenType.DOT, '.', startLine, startCol); break;

        // Plus variants
        case '+':
          if (this.match('='))      this.addToken(TokenType.PLUS_ASSIGN, '+=', startLine, startCol);
          else if (this.match('+')) this.addToken(TokenType.INCREMENT,   '++', startLine, startCol);
          else                      this.addToken(TokenType.PLUS,        '+',  startLine, startCol);
          break;

        // Minus variants
        case '-':
          if (this.match('='))      this.addToken(TokenType.MINUS_ASSIGN, '-=', startLine, startCol);
          else if (this.match('-')) this.addToken(TokenType.DECREMENT,    '--', startLine, startCol);
          else if (this.match('>')) this.addToken(TokenType.ARROW,        '->', startLine, startCol);
          else                      this.addToken(TokenType.MINUS,        '-',  startLine, startCol);
          break;

        // Star variants
        case '*':
          if (this.match('=')) this.addToken(TokenType.STAR_ASSIGN, '*=', startLine, startCol);
          else                 this.addToken(TokenType.STAR,        '*',  startLine, startCol);
          break;

        // Slash variants (comments already handled above)
        case '/':
          if (this.match('=')) this.addToken(TokenType.SLASH_ASSIGN, '/=', startLine, startCol);
          else                 this.addToken(TokenType.SLASH,        '/',  startLine, startCol);
          break;

        // Percent
        case '%':
          if (this.match('=')) this.addToken(TokenType.PERCENT_ASSIGN, '%=', startLine, startCol);
          else                 this.addToken(TokenType.PERCENT,        '%',  startLine, startCol);
          break;

        // Ampersand
        case '&':
          if (this.match('&'))      this.addToken(TokenType.AND,        '&&', startLine, startCol);
          else if (this.match('=')) this.addToken(TokenType.AMP_ASSIGN, '&=', startLine, startCol);
          else                      this.addToken(TokenType.AMP,        '&',  startLine, startCol);
          break;

        // Pipe
        case '|':
          if (this.match('|'))      this.addToken(TokenType.OR,          '||', startLine, startCol);
          else if (this.match('=')) this.addToken(TokenType.PIPE_ASSIGN, '|=', startLine, startCol);
          else                      this.addToken(TokenType.PIPE,        '|',  startLine, startCol);
          break;

        // Caret
        case '^':
          if (this.match('=')) this.addToken(TokenType.CARET_ASSIGN, '^=', startLine, startCol);
          else                 this.addToken(TokenType.CARET,        '^',  startLine, startCol);
          break;

        // Not / neq
        case '!':
          if (this.match('=')) this.addToken(TokenType.NEQ, '!=', startLine, startCol);
          else                 this.addToken(TokenType.NOT, '!',  startLine, startCol);
          break;

        // Assign / eq
        case '=':
          if (this.match('=')) this.addToken(TokenType.EQ,     '==', startLine, startCol);
          else                 this.addToken(TokenType.ASSIGN, '=',  startLine, startCol);
          break;

        // Less-than variants
        case '<':
          if (this.match('<')) {
            if (this.match('=')) this.addToken(TokenType.SHL_ASSIGN, '<<=', startLine, startCol);
            else                 this.addToken(TokenType.SHL,        '<<',  startLine, startCol);
          } else if (this.match('=')) {
            this.addToken(TokenType.LEQ, '<=', startLine, startCol);
          } else {
            this.addToken(TokenType.LT, '<', startLine, startCol);
          }
          break;

        // Greater-than variants
        case '>':
          if (this.match('>')) {
            if (this.match('=')) this.addToken(TokenType.SHR_ASSIGN, '>>=', startLine, startCol);
            else                 this.addToken(TokenType.SHR,        '>>',  startLine, startCol);
          } else if (this.match('=')) {
            this.addToken(TokenType.GEQ, '>=', startLine, startCol);
          } else {
            this.addToken(TokenType.GT, '>', startLine, startCol);
          }
          break;

        default:
          this.error(`Unexpected character '${ch}'`);
          break;
      }
    }

    // Append EOF sentinel
    this.addToken(TokenType.EOF, null, this.line, this.col);

    // If there were errors, throw an aggregate
    if (this.errors.length > 0) {
      const aggregate = new LexerError(
        this.errors.map(e => e.message).join('\n'),
        this.errors[0].line,
        this.errors[0].col
      );
      aggregate.errors = this.errors;
      throw aggregate;
    }

    return this.tokens;
  }
}

// ── Character classification helpers ─────────────────────────────────────────

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch) {
  return (ch >= '0' && ch <= '9') ||
         (ch >= 'a' && ch <= 'f') ||
         (ch >= 'A' && ch <= 'F');
}

function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') ||
         (ch >= 'A' && ch <= 'Z') ||
         ch === '_';
}

function isIdentChar(ch) {
  return isIdentStart(ch) || isDigit(ch);
}

module.exports = { Lexer, LexerError };
