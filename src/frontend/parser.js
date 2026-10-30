'use strict';

/**
 * @module parser
 * @description Recursive-descent parser for the NexCC bounded C-subset.
 * Generates an AST according to ast.js definitions.
 */

const { TokenType } = require('./token');
const { NodeType, createNode } = require('./ast');

class Parser {
  /**
   * @param {import('./token').Token[]} tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.errors = [];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  peek(offset = 0) {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]; // Return EOF
    }
    return this.tokens[idx];
  }

  current() {
    return this.peek(0);
  }

  isAtEnd() {
    return this.current().type === TokenType.EOF;
  }

  check(type) {
    if (this.isAtEnd()) return false;
    return this.current().type === type;
  }

  advance() {
    if (!this.isAtEnd()) this.pos++;
    return this.peek(-1);
  }

  match(...types) {
    for (const t of types) {
      if (this.check(t)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  consume(type, message) {
    if (this.check(type)) return this.advance();
    const token = this.current();
    const err = new Error(`${message} at line ${token.line}, col ${token.col} (got '${token.value || token.type}')`);
    err.line = token.line;
    err.col = token.col;
    this.errors.push(err);
    throw err;
  }

  synchronize() {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.peek(-1).type === TokenType.SEMICOLON) return;
      switch (this.current().type) {
        case TokenType.KW_INT:
        case TokenType.KW_CHAR:
        case TokenType.KW_BOOL:
        case TokenType.KW_VOID:
        case TokenType.KW_STRUCT:
        case TokenType.KW_IF:
        case TokenType.KW_WHILE:
        case TokenType.KW_FOR:
        case TokenType.KW_RETURN:
          return;
      }
      this.advance();
    }
  }

  // ── Entry Point ──────────────────────────────────────────────────────────

  parse() {
    const declarations = [];
    while (!this.isAtEnd()) {
      try {
        const decl = this.parseTopLevel();
        if (decl) declarations.push(decl);
      } catch (e) {
        this.synchronize();
      }
    }
    return createNode(NodeType.Program, { declarations }, { line: 1, col: 1 });
  }

  // ── Top Level Declarations ───────────────────────────────────────────────

  parseTopLevel() {
    // struct declaration: struct Name { ... };
    if (this.check(TokenType.KW_STRUCT) && this.peek(1).type === TokenType.IDENT && this.peek(2).type === TokenType.LBRACE) {
      return this.parseStructDecl();
    }

    // Otherwise, parse a type specifier
    const startLoc = { line: this.current().line, col: this.current().col };
    const type = this.parseType();
    const nameToken = this.consume(TokenType.IDENT, "Expected identifier");
    const name = nameToken.value;

    // Function declaration: type name ( params ) { ... }
    if (this.check(TokenType.LPAREN)) {
      return this.parseFunctionDecl(type, name, startLoc);
    }

    // Global variable declaration: type name [ = init ];
    let init = null;
    if (this.match(TokenType.ASSIGN)) {
      init = this.parseExpression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after global variable declaration");
    return createNode(NodeType.VarDecl, { type, name, init }, startLoc);
  }

  parseStructDecl() {
    const startTok = this.consume(TokenType.KW_STRUCT, "Expected 'struct'");
    const nameTok = this.consume(TokenType.IDENT, "Expected struct name");
    this.consume(TokenType.LBRACE, "Expected '{'");

    const fields = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const fType = this.parseType();
      const fName = this.consume(TokenType.IDENT, "Expected field name").value;
      this.consume(TokenType.SEMICOLON, "Expected ';' after struct field");
      fields.push({ type: fType, name: fName });
    }
    this.consume(TokenType.RBRACE, "Expected '}'");
    this.consume(TokenType.SEMICOLON, "Expected ';' after struct declaration");

    return createNode(NodeType.StructDecl, { name: nameTok.value, fields }, { line: startTok.line, col: startTok.col });
  }

  parseFunctionDecl(returnType, name, loc) {
    this.consume(TokenType.LPAREN, "Expected '('");
    const params = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        if (this.check(TokenType.KW_VOID) && this.peek(1).type === TokenType.RPAREN) {
          this.advance();
          break;
        }
        const pType = this.parseType();
        const pName = this.consume(TokenType.IDENT, "Expected parameter name").value;
        params.push({ type: pType, name: pName });
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RPAREN, "Expected ')'");

    const body = this.parseBlock();
    return createNode(NodeType.FunctionDecl, { returnType, name, params, body }, loc);
  }

  // ── Types ────────────────────────────────────────────────────────────────

  parseType() {
    let baseType;
    const tok = this.current();

    if (this.match(TokenType.KW_INT)) {
      baseType = { kind: 'int', name: 'int' };
    } else if (this.match(TokenType.KW_CHAR)) {
      baseType = { kind: 'char', name: 'char' };
    } else if (this.match(TokenType.KW_BOOL)) {
      baseType = { kind: 'bool', name: 'bool' };
    } else if (this.match(TokenType.KW_VOID)) {
      baseType = { kind: 'void', name: 'void' };
    } else if (this.match(TokenType.KW_STRUCT)) {
      const structName = this.consume(TokenType.IDENT, "Expected struct name").value;
      baseType = { kind: 'struct', structName, name: `struct ${structName}` };
    } else {
      throw new Error(`Unexpected type '${tok.value || tok.type}' at line ${tok.line}, col ${tok.col}`);
    }

    // Pointer levels: int* / int**
    while (this.match(TokenType.STAR)) {
      baseType = { kind: 'pointer', base: baseType, name: `${baseType.name}*` };
    }

    // Array brackets: int[10]
    while (this.match(TokenType.LBRACKET)) {
      let size = null;
      if (this.check(TokenType.INT_LIT)) {
        size = Number(this.advance().value);
      }
      this.consume(TokenType.RBRACKET, "Expected ']'");
      baseType = { kind: 'array', base: baseType, size, name: `${baseType.name}[${size !== null ? size : ''}]` };
    }

    return baseType;
  }

  // ── Statements ───────────────────────────────────────────────────────────

  parseStatement() {
    const tok = this.current();

    if (tok.type === TokenType.LBRACE) {
      return this.parseBlock();
    }
    if (tok.type === TokenType.KW_IF) {
      return this.parseIfStatement();
    }
    if (tok.type === TokenType.KW_WHILE) {
      return this.parseWhileStatement();
    }
    if (tok.type === TokenType.KW_FOR) {
      return this.parseForStatement();
    }
    if (tok.type === TokenType.KW_RETURN) {
      return this.parseReturnStatement();
    }
    if (tok.type === TokenType.KW_BREAK) {
      const loc = { line: tok.line, col: tok.col };
      this.advance();
      this.consume(TokenType.SEMICOLON, "Expected ';' after break");
      return createNode(NodeType.BreakStmt, {}, loc);
    }
    if (tok.type === TokenType.KW_CONTINUE) {
      const loc = { line: tok.line, col: tok.col };
      this.advance();
      this.consume(TokenType.SEMICOLON, "Expected ';' after continue");
      return createNode(NodeType.ContinueStmt, {}, loc);
    }

    // Check if it's a variable declaration: int x = 5; or struct Foo* ptr;
    if (this.isTypeStart(tok)) {
      return this.parseVarDeclStatement();
    }

    // Otherwise, expression statement
    const loc = { line: tok.line, col: tok.col };
    const expr = this.parseExpression();
    this.consume(TokenType.SEMICOLON, "Expected ';' after expression");
    return createNode(NodeType.ExprStmt, { expr }, loc);
  }

  isTypeStart(token) {
    if (token.type === TokenType.KW_INT || token.type === TokenType.KW_CHAR ||
        token.type === TokenType.KW_BOOL || token.type === TokenType.KW_VOID) {
      return true;
    }
    if (token.type === TokenType.KW_STRUCT) {
      return true;
    }
    return false;
  }

  parseBlock() {
    const start = this.consume(TokenType.LBRACE, "Expected '{'");
    const stmts = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      stmts.push(this.parseStatement());
    }
    this.consume(TokenType.RBRACE, "Expected '}'");
    return createNode(NodeType.Block, { stmts }, { line: start.line, col: start.col });
  }

  parseVarDeclStatement() {
    const loc = { line: this.current().line, col: this.current().col };
    const type = this.parseType();
    const name = this.consume(TokenType.IDENT, "Expected variable name").value;
    let init = null;
    if (this.match(TokenType.ASSIGN)) {
      init = this.parseExpression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after variable declaration");
    return createNode(NodeType.VarDecl, { type, name, init }, loc);
  }

  parseIfStatement() {
    const tok = this.consume(TokenType.KW_IF, "Expected 'if'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after condition");

    const thenBranch = this.parseStatement();
    let elseBranch = null;
    if (this.match(TokenType.KW_ELSE)) {
      elseBranch = this.parseStatement();
    }

    return createNode(NodeType.IfStmt, { condition, then: thenBranch, else: elseBranch }, { line: tok.line, col: tok.col });
  }

  parseWhileStatement() {
    const tok = this.consume(TokenType.KW_WHILE, "Expected 'while'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'while'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after condition");
    const body = this.parseStatement();

    return createNode(NodeType.WhileStmt, { condition, body }, { line: tok.line, col: tok.col });
  }

  parseForStatement() {
    const tok = this.consume(TokenType.KW_FOR, "Expected 'for'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'for'");

    let init = null;
    if (this.match(TokenType.SEMICOLON)) {
      init = null;
    } else if (this.isTypeStart(this.current())) {
      init = this.parseVarDeclStatement();
    } else {
      const expr = this.parseExpression();
      this.consume(TokenType.SEMICOLON, "Expected ';'");
      init = createNode(NodeType.ExprStmt, { expr }, { line: expr.loc.line, col: expr.loc.col });
    }

    let condition = null;
    if (!this.check(TokenType.SEMICOLON)) {
      condition = this.parseExpression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after for loop condition");

    let update = null;
    if (!this.check(TokenType.RPAREN)) {
      update = this.parseExpression();
    }
    this.consume(TokenType.RPAREN, "Expected ')' after for clauses");

    const body = this.parseStatement();

    return createNode(NodeType.ForStmt, { init, condition, update, body }, { line: tok.line, col: tok.col });
  }

  parseReturnStatement() {
    const tok = this.consume(TokenType.KW_RETURN, "Expected 'return'");
    let value = null;
    if (!this.check(TokenType.SEMICOLON)) {
      value = this.parseExpression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after return");
    return createNode(NodeType.ReturnStmt, { value }, { line: tok.line, col: tok.col });
  }

  // ── Expressions ──────────────────────────────────────────────────────────

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const expr = this.parseLogicalOr();

    if (this.match(
      TokenType.ASSIGN,
      TokenType.PLUS_ASSIGN,
      TokenType.MINUS_ASSIGN,
      TokenType.STAR_ASSIGN,
      TokenType.SLASH_ASSIGN
    )) {
      const opTok = this.peek(-1);
      const right = this.parseAssignment(); // Right-associative
      return createNode(NodeType.AssignExpr, {
        op: opTok.value || opTok.type,
        target: expr,
        value: right
      }, { line: expr.loc.line, col: expr.loc.col });
    }

    return expr;
  }

  parseLogicalOr() {
    let expr = this.parseLogicalAnd();
    while (this.match(TokenType.OR)) {
      const op = '||';
      const right = this.parseLogicalAnd();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseLogicalAnd() {
    let expr = this.parseBitwiseOr();
    while (this.match(TokenType.AND)) {
      const op = '&&';
      const right = this.parseBitwiseOr();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseBitwiseOr() {
    let expr = this.parseBitwiseXor();
    while (this.match(TokenType.PIPE)) {
      const op = '|';
      const right = this.parseBitwiseXor();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseBitwiseXor() {
    let expr = this.parseBitwiseAnd();
    while (this.match(TokenType.CARET)) {
      const op = '^';
      const right = this.parseBitwiseAnd();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseBitwiseAnd() {
    let expr = this.parseEquality();
    while (this.match(TokenType.AMP)) {
      const op = '&';
      const right = this.parseEquality();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseEquality() {
    let expr = this.parseRelational();
    while (this.match(TokenType.EQ, TokenType.NEQ)) {
      const op = this.peek(-1).value;
      const right = this.parseRelational();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseRelational() {
    let expr = this.parseShift();
    while (this.match(TokenType.LT, TokenType.GT, TokenType.LEQ, TokenType.GEQ)) {
      const op = this.peek(-1).value;
      const right = this.parseShift();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseShift() {
    let expr = this.parseAdditive();
    while (this.match(TokenType.SHL, TokenType.SHR)) {
      const op = this.peek(-1).value;
      const right = this.parseAdditive();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseAdditive() {
    let expr = this.parseMultiplicative();
    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const op = this.peek(-1).value;
      const right = this.parseMultiplicative();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseMultiplicative() {
    let expr = this.parseUnary();
    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const op = this.peek(-1).value;
      const right = this.parseUnary();
      expr = createNode(NodeType.BinaryExpr, { op, left: expr, right }, { line: expr.loc.line, col: expr.loc.col });
    }
    return expr;
  }

  parseUnary() {
    const tok = this.current();

    // sizeof(type or expr)
    if (this.match(TokenType.KW_SIZEOF)) {
      this.consume(TokenType.LPAREN, "Expected '(' after sizeof");
      let target;
      if (this.isTypeStart(this.current())) {
        target = this.parseType();
      } else {
        target = this.parseExpression();
      }
      this.consume(TokenType.RPAREN, "Expected ')' after sizeof target");
      return createNode(NodeType.SizeofExpr, { target }, { line: tok.line, col: tok.col });
    }

    // malloc(size)
    if (this.match(TokenType.KW_MALLOC)) {
      this.consume(TokenType.LPAREN, "Expected '(' after malloc");
      const size = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after malloc size");
      return createNode(NodeType.MallocExpr, { size }, { line: tok.line, col: tok.col });
    }

    // free(ptr)
    if (this.match(TokenType.KW_FREE)) {
      this.consume(TokenType.LPAREN, "Expected '(' after free");
      const ptr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after free");
      return createNode(NodeType.CallExpr, {
        callee: createNode(NodeType.Identifier, { name: 'free' }, { line: tok.line, col: tok.col }),
        args: [ptr]
      }, { line: tok.line, col: tok.col });
    }

    // Prefix operators: !, ~, -, +, *, &
    if (this.match(TokenType.NOT, TokenType.TILDE, TokenType.MINUS, TokenType.PLUS, TokenType.STAR, TokenType.AMP)) {
      const op = this.peek(-1).value;
      const operand = this.parseUnary();
      return createNode(NodeType.UnaryExpr, { op, operand, prefix: true }, { line: tok.line, col: tok.col });
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        // Function call: expr(arg1, arg2, ...)
        const args = [];
        if (!this.check(TokenType.RPAREN)) {
          do {
            args.push(this.parseExpression());
          } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RPAREN, "Expected ')' after arguments");
        expr = createNode(NodeType.CallExpr, { callee: expr, args }, { line: expr.loc.line, col: expr.loc.col });
      } else if (this.match(TokenType.LBRACKET)) {
        // Array subscript: expr[index]
        const index = this.parseExpression();
        this.consume(TokenType.RBRACKET, "Expected ']' after array index");
        expr = createNode(NodeType.IndexExpr, { object: expr, index }, { line: expr.loc.line, col: expr.loc.col });
      } else if (this.match(TokenType.DOT)) {
        // Struct field access: expr.field
        const field = this.consume(TokenType.IDENT, "Expected field identifier after '.'").value;
        expr = createNode(NodeType.MemberExpr, { object: expr, field, arrow: false }, { line: expr.loc.line, col: expr.loc.col });
      } else if (this.match(TokenType.ARROW)) {
        // Pointer arrow access: expr->field
        const field = this.consume(TokenType.IDENT, "Expected field identifier after '->'").value;
        expr = createNode(NodeType.MemberExpr, { object: expr, field, arrow: true }, { line: expr.loc.line, col: expr.loc.col });
      } else {
        break;
      }
    }

    return expr;
  }

  parsePrimary() {
    const tok = this.current();

    if (this.match(TokenType.INT_LIT)) {
      return createNode(NodeType.IntLiteral, { value: Number(tok.value) }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.CHAR_LIT)) {
      return createNode(NodeType.CharLiteral, { value: tok.value }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.STRING_LIT)) {
      return createNode(NodeType.StringLiteral, { value: tok.value }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.KW_TRUE)) {
      return createNode(NodeType.BoolLiteral, { value: true }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.KW_FALSE)) {
      return createNode(NodeType.BoolLiteral, { value: false }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.KW_NULL)) {
      return createNode(NodeType.NullLiteral, {}, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.IDENT)) {
      return createNode(NodeType.Identifier, { name: tok.value }, { line: tok.line, col: tok.col });
    }
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");
      return expr;
    }

    throw new Error(`Unexpected token '${tok.value || tok.type}' at line ${tok.line}, col ${tok.col}`);
  }
}

module.exports = { Parser };
