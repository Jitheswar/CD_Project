'use strict';

/**
 * @module regex-parser
 * @description Recursive descent parser for regular expressions.
 * Converts a regex string into an AST with proper operator precedence:
 *   alternation < concatenation < postfix (*, +, ?)
 *
 * Supported syntax:
 *   - Literals, dot `.`, escape sequences `\n \t \\ \| \. \[ \] \( \) \* \+ \?`
 *   - Alternation `|`
 *   - Concatenation (implicit juxtaposition)
 *   - Kleene star `*`, plus `+`, optional `?`
 *   - Grouping `()`
 *   - Character classes `[a-z]`, `[^a-z]` (negated)
 */

// ─── AST Node Constructors ──────────────────────────────────────────────────

/**
 * @typedef {Object} ASTNode
 * @property {string} type - One of: Literal, Concat, Alt, Star, Plus, Optional,
 *                           CharClass, Dot, Empty
 */

/**
 * Create a Literal node.
 * @param {string} ch - The literal character.
 * @returns {ASTNode}
 */
function Literal(ch) {
  return { type: 'Literal', value: ch };
}

/**
 * Create a Concat node.
 * @param {ASTNode} left
 * @param {ASTNode} right
 * @returns {ASTNode}
 */
function Concat(left, right) {
  return { type: 'Concat', left, right };
}

/**
 * Create an Alt (alternation / union) node.
 * @param {ASTNode} left
 * @param {ASTNode} right
 * @returns {ASTNode}
 */
function Alt(left, right) {
  return { type: 'Alt', left, right };
}

/**
 * Create a Star (Kleene star) node.
 * @param {ASTNode} child
 * @returns {ASTNode}
 */
function Star(child) {
  return { type: 'Star', child };
}

/**
 * Create a Plus (one-or-more) node.
 * @param {ASTNode} child
 * @returns {ASTNode}
 */
function Plus(child) {
  return { type: 'Plus', child };
}

/**
 * Create an Optional node.
 * @param {ASTNode} child
 * @returns {ASTNode}
 */
function Optional(child) {
  return { type: 'Optional', child };
}

/**
 * Create a CharClass node.
 * @param {Array<{from: string, to: string}>} ranges - Character ranges.
 * @param {boolean} negated - Whether the class is negated `[^...]`.
 * @returns {ASTNode}
 */
function CharClass(ranges, negated) {
  return { type: 'CharClass', ranges, negated };
}

/** Dot node — matches any character except newline. */
function Dot() {
  return { type: 'Dot' };
}

/** Empty node — matches the empty string ε. */
function Empty() {
  return { type: 'Empty' };
}

// ─── Escape Handling ─────────────────────────────────────────────────────────

const ESCAPE_MAP = {
  'n': '\n',
  't': '\t',
  'r': '\r',
  'f': '\f',
  'v': '\v',
  '0': '\0',
};

/**
 * Resolve an escape character.  `\\n` → `\n`, `\\|` → `|`, etc.
 * @param {string} ch - Character after the backslash.
 * @returns {string}
 */
function resolveEscape(ch) {
  if (ESCAPE_MAP[ch] !== undefined) return ESCAPE_MAP[ch];
  // Any other char is returned literally (handles \\, \|, \., \[, \], \(, \), \*, \+, \?)
  return ch;
}

// ─── Recursive-Descent Parser ────────────────────────────────────────────────

/**
 * Parse a regular expression string into an AST.
 * @param {string} pattern - The regex pattern string.
 * @returns {ASTNode} The root of the AST.
 */
function parseRegex(pattern) {
  if (typeof pattern !== 'string') {
    throw new TypeError('parseRegex expects a string');
  }
  if (pattern.length === 0) {
    return Empty();
  }

  let pos = 0;

  /** Peek at the current character (or null at end). */
  function peek() {
    return pos < pattern.length ? pattern[pos] : null;
  }

  /** Advance and return the current character. */
  function advance() {
    return pattern[pos++];
  }

  /** Expect a specific character or throw. */
  function expect(ch) {
    if (peek() !== ch) {
      throw new SyntaxError(
        `Regex parse error at position ${pos}: expected '${ch}', got '${peek() || 'EOF'}'`
      );
    }
    advance();
  }

  // ── Grammar ──────────────────────────────────────────────
  // expr     → concat ( '|' concat )*
  // concat   → postfix+
  // postfix  → atom ( '*' | '+' | '?' )*
  // atom     → '(' expr ')' | '[' charclass ']' | '.' | escape | literal

  /**
   * Parse alternation (lowest precedence).
   * @returns {ASTNode}
   */
  function parseExpr() {
    let node = parseConcat();
    while (peek() === '|') {
      advance(); // consume '|'
      const right = parseConcat();
      node = Alt(node, right);
    }
    return node;
  }

  /**
   * Parse concatenation (middle precedence).
   * @returns {ASTNode}
   */
  function parseConcat() {
    // Collect a sequence of postfix atoms.  Stop on '|', ')', or EOF.
    let node = null;
    while (peek() !== null && peek() !== '|' && peek() !== ')') {
      const next = parsePostfix();
      node = node === null ? next : Concat(node, next);
    }
    // An empty alternative (e.g. "a|" or "|b") produces Empty.
    return node !== null ? node : Empty();
  }

  /**
   * Parse postfix operators (highest precedence among binary/unary).
   * @returns {ASTNode}
   */
  function parsePostfix() {
    let node = parseAtom();
    while (peek() === '*' || peek() === '+' || peek() === '?') {
      const op = advance();
      if (op === '*') node = Star(node);
      else if (op === '+') node = Plus(node);
      else node = Optional(node);
    }
    return node;
  }

  /**
   * Parse an atom: group, char class, dot, escape, or literal.
   * @returns {ASTNode}
   */
  function parseAtom() {
    const ch = peek();

    if (ch === '(') {
      advance(); // consume '('
      const node = parseExpr();
      expect(')');
      return node;
    }

    if (ch === '[') {
      return parseCharClass();
    }

    if (ch === '.') {
      advance();
      return Dot();
    }

    if (ch === '\\') {
      advance(); // consume '\\'
      const escaped = advance();
      if (escaped === undefined) {
        throw new SyntaxError('Regex parse error: trailing backslash');
      }
      return Literal(resolveEscape(escaped));
    }

    // Regular literal
    if (ch === null) {
      throw new SyntaxError('Regex parse error: unexpected end of input');
    }
    if (ch === '*' || ch === '+' || ch === '?') {
      throw new SyntaxError(
        `Regex parse error at position ${pos}: unexpected quantifier '${ch}'`
      );
    }
    advance();
    return Literal(ch);
  }

  /**
   * Parse a character class `[...]` or `[^...]`.
   * Inside a class: `a-z` denotes a range; `]` at start is literal;
   * backslash escapes work.
   * @returns {ASTNode}
   */
  function parseCharClass() {
    expect('[');

    let negated = false;
    if (peek() === '^') {
      negated = true;
      advance();
    }

    const ranges = [];

    // Handle `]` as first char (literal `]`).
    if (peek() === ']') {
      const ch = advance();
      if (peek() === '-' && pos + 1 < pattern.length && pattern[pos + 1] !== ']') {
        advance(); // consume '-'
        const end = parseClassChar();
        ranges.push({ from: ch, to: end });
      } else {
        ranges.push({ from: ch, to: ch });
      }
    }

    while (peek() !== null && peek() !== ']') {
      const startChar = parseClassChar();
      if (peek() === '-' && pos + 1 < pattern.length && pattern[pos + 1] !== ']') {
        advance(); // consume '-'
        const endChar = parseClassChar();
        if (startChar.charCodeAt(0) > endChar.charCodeAt(0)) {
          throw new SyntaxError(
            `Regex parse error: invalid character class range '${startChar}-${endChar}'`
          );
        }
        ranges.push({ from: startChar, to: endChar });
      } else {
        ranges.push({ from: startChar, to: startChar });
      }
    }

    expect(']');

    if (ranges.length === 0) {
      throw new SyntaxError('Regex parse error: empty character class');
    }

    return CharClass(ranges, negated);
  }

  /**
   * Parse a single character inside a character class (handles escapes).
   * @returns {string}
   */
  function parseClassChar() {
    if (peek() === '\\') {
      advance();
      const ch = advance();
      if (ch === undefined) {
        throw new SyntaxError('Regex parse error: trailing backslash in character class');
      }
      return resolveEscape(ch);
    }
    return advance();
  }

  // ── Run the parser ─────────────────────────────────────────

  const ast = parseExpr();

  if (pos !== pattern.length) {
    throw new SyntaxError(
      `Regex parse error at position ${pos}: unexpected character '${pattern[pos]}'`
    );
  }

  return ast;
}

// ─── Utility: expand a CharClass node into the set of matching chars ─────────

/**
 * Expand a CharClass AST node into an array of individual characters.
 * For negated classes, expands against printable ASCII (codes 32-126)
 * excluding newline.
 * @param {ASTNode} node - A CharClass node.
 * @returns {string[]} Array of matching characters.
 */
function expandCharClass(node) {
  if (node.type !== 'CharClass') {
    throw new TypeError('expandCharClass expects a CharClass node');
  }
  const included = new Set();
  for (const range of node.ranges) {
    const lo = range.from.charCodeAt(0);
    const hi = range.to.charCodeAt(0);
    for (let c = lo; c <= hi; c++) {
      included.add(String.fromCharCode(c));
    }
  }
  if (!node.negated) {
    return Array.from(included);
  }
  // Negated: all printable ASCII except newline, minus included chars.
  const result = [];
  for (let c = 32; c <= 126; c++) {
    const ch = String.fromCharCode(c);
    if (!included.has(ch)) {
      result.push(ch);
    }
  }
  return result;
}

module.exports = {
  parseRegex,
  expandCharClass,
  // AST constructors (useful for programmatic AST building)
  Literal,
  Concat,
  Alt,
  Star,
  Plus,
  Optional,
  CharClass,
  Dot,
  Empty,
};
