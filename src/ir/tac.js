'use strict';

/**
 * @module ir/tac
 * Three-Address Code (TAC) intermediate representation.
 *
 * TAC instructions are quadruples: { op, result, arg1, arg2, label?, target? }
 * The TACGenerator walks a typed HIR and emits a flat list of TAC instructions
 * for every function, plus a set of global declarations.
 */

// ────────────────────────────────────────────────────────────────────────────
// Allowed operation kinds
// ────────────────────────────────────────────────────────────────────────────

/** @type {Set<string>} */
const VALID_OPS = new Set([
  // Arithmetic
  'add', 'sub', 'mul', 'div', 'mod', 'neg',
  // Logic / bit-wise
  'not', 'and', 'or', 'xor', 'shl', 'shr',
  // Data movement
  'copy', 'load', 'store',
  // Comparison → boolean
  'lt', 'le', 'gt', 'ge', 'eq', 'ne',
  // Control flow
  'ifTrue', 'ifFalse', 'goto', 'label',
  // Procedure
  'param', 'call', 'return',
  // Memory
  'alloc', 'malloc', 'free',
  // SSA
  'phi',
  // Aggregate access
  'getfield', 'setfield', 'index',
  // No-op (placeholder / padding)
  'nop'
]);

// ────────────────────────────────────────────────────────────────────────────
// TACInstruction
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single three-address code instruction (quadruple).
 *
 * @class
 * @property {string}  op      - Operation mnemonic.
 * @property {string|null} result - Destination variable / register.
 * @property {*}       arg1   - First source operand (variable, literal, …).
 * @property {*}       arg2   - Second source operand.
 * @property {string|null} label  - If op === 'label', the label name.
 * @property {string|null} target - Jump target label (for branches / goto).
 */
class TACInstruction {
  /**
   * @param {string} op
   * @param {string|null} result
   * @param {*} [arg1=null]
   * @param {*} [arg2=null]
   * @param {object} [extra={}]  - { label?, target?, phiArgs? }
   */
  constructor(op, result, arg1 = null, arg2 = null, extra = {}) {
    if (!VALID_OPS.has(op)) {
      throw new Error(`TACInstruction: unknown op "${op}"`);
    }
    this.op = op;
    this.result = result;
    this.arg1 = arg1;
    this.arg2 = arg2;
    this.label = extra.label || null;
    this.target = extra.target || null;
    /** For phi: array of { value, block } pairs */
    this.phiArgs = extra.phiArgs || null;
  }

  /** Pretty-print the instruction. */
  toString() {
    switch (this.op) {
      case 'label':
        return `${this.label}:`;
      case 'goto':
        return `  goto ${this.target}`;
      case 'ifTrue':
        return `  if ${this.arg1} goto ${this.target}`;
      case 'ifFalse':
        return `  ifFalse ${this.arg1} goto ${this.target}`;
      case 'copy':
        return `  ${this.result} = ${this.arg1}`;
      case 'load':
        return `  ${this.result} = *${this.arg1}`;
      case 'store':
        return `  *${this.result} = ${this.arg1}`;
      case 'param':
        return `  param ${this.arg1}`;
      case 'call':
        return `  ${this.result ? this.result + ' = ' : ''}call ${this.arg1}, ${this.arg2}`;
      case 'return':
        return `  return${this.arg1 !== null ? ' ' + this.arg1 : ''}`;
      case 'phi':
        return `  ${this.result} = phi(${(this.phiArgs || []).map(a => `${a.value}:${a.block}`).join(', ')})`;
      case 'alloc':
        return `  ${this.result} = alloc ${this.arg1}`;
      case 'malloc':
        return `  ${this.result} = malloc ${this.arg1}`;
      case 'free':
        return `  free ${this.arg1}`;
      case 'neg':
      case 'not':
        return `  ${this.result} = ${this.op} ${this.arg1}`;
      case 'getfield':
        return `  ${this.result} = ${this.arg1}[${this.arg2}]`;
      case 'setfield':
        return `  ${this.result}[${this.arg2}] = ${this.arg1}`;
      case 'index':
        return `  ${this.result} = ${this.arg1}[${this.arg2}]`;
      case 'nop':
        return '  nop';
      default:
        // binary ops: add, sub, mul, div, mod, and, or, xor, shl, shr, comparisons
        return `  ${this.result} = ${this.arg1} ${this.op} ${this.arg2}`;
    }
  }

  /** Create a shallow clone. */
  clone() {
    const c = new TACInstruction(this.op, this.result, this.arg1, this.arg2, {
      label: this.label,
      target: this.target,
      phiArgs: this.phiArgs ? this.phiArgs.map(a => ({ ...a })) : null
    });
    return c;
  }

  /**
   * Return all variables / temps *read* by this instruction.
   * Literal numbers / booleans / strings are skipped.
   * @returns {string[]}
   */
  getUses() {
    const uses = [];
    const add = v => { if (typeof v === 'string' && !isLiteral(v)) uses.push(v); };

    switch (this.op) {
      case 'label':
      case 'goto':
      case 'nop':
        break;
      case 'phi':
        if (this.phiArgs) this.phiArgs.forEach(a => add(a.value));
        break;
      case 'store':
        add(this.result); // address
        add(this.arg1);   // value
        break;
      case 'setfield':
        add(this.result);
        add(this.arg1);
        add(this.arg2);
        break;
      default:
        add(this.arg1);
        add(this.arg2);
        break;
    }
    return uses;
  }

  /**
   * Return the variable *defined* by this instruction, if any.
   * @returns {string|null}
   */
  getDef() {
    switch (this.op) {
      case 'label':
      case 'goto':
      case 'ifTrue':
      case 'ifFalse':
      case 'param':
      case 'return':
      case 'store':
      case 'free':
      case 'nop':
        return null;
      case 'setfield':
        return null;
      default:
        return this.result || null;
    }
  }
}

/**
 * Check whether a value is a literal constant (number, boolean-string, null-string).
 * @param {*} v
 * @returns {boolean}
 */
function isLiteral(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  if (typeof v !== 'string') return false;
  if (v === 'true' || v === 'false' || v === 'null') return true;
  // Numeric string
  if (/^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v)) return true;
  // String literal
  if (v.startsWith('"') || v.startsWith("'")) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// TACFunction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Representation of a single function in TAC form.
 *
 * @class
 * @property {string}            name
 * @property {string[]}          params
 * @property {TACInstruction[]}  instructions
 * @property {number}            tempCount
 */
class TACFunction {
  /**
   * @param {string}   name
   * @param {string[]} params
   * @param {TACInstruction[]} instructions
   * @param {number}   tempCount
   */
  constructor(name, params, instructions, tempCount) {
    this.name = name;
    this.params = params;
    this.instructions = instructions;
    this.tempCount = tempCount;
  }

  toString() {
    const header = `function ${this.name}(${this.params.join(', ')})`;
    const body = this.instructions.map(i => i.toString()).join('\n');
    return `${header} {\n${body}\n}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TACGenerator — walks typed HIR and emits TAC
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates Three-Address Code from a typed HIR program.
 *
 * Expected HIR node shapes (minimal contract):
 *
 *  Program       { type: 'Program', body: [Declaration | Statement] }
 *  FunctionDecl  { type: 'FunctionDeclaration', name, params: [{name}], body }
 *  VarDecl       { type: 'VariableDeclaration', name, init? }
 *  Block         { type: 'BlockStatement', body: [] }
 *  ExprStmt      { type: 'ExpressionStatement', expression }
 *  ReturnStmt    { type: 'ReturnStatement', argument? }
 *  IfStmt        { type: 'IfStatement', test, consequent, alternate? }
 *  WhileStmt     { type: 'WhileStatement', test, body }
 *  ForStmt       { type: 'ForStatement', init?, test?, update?, body }
 *  BreakStmt     { type: 'BreakStatement' }
 *  ContinueStmt  { type: 'ContinueStatement' }
 *  BinaryExpr    { type: 'BinaryExpression', operator, left, right }
 *  UnaryExpr     { type: 'UnaryExpression', operator, argument }
 *  AssignExpr    { type: 'AssignmentExpression', operator, left, right }
 *  CallExpr      { type: 'CallExpression', callee, arguments: [] }
 *  Identifier    { type: 'Identifier', name }
 *  Literal       { type: 'Literal', value }
 *  MemberExpr    { type: 'MemberExpression', object, property, computed }
 *  ArrayExpr     { type: 'ArrayExpression', elements }
 *  LogicalExpr   { type: 'LogicalExpression', operator, left, right }
 *
 * @class
 */
class TACGenerator {
  constructor() {
    /** @private */ this._tempCounter = 0;
    /** @private */ this._labelCounter = 0;
    /** @private */ this._instructions = [];
    /** @private */ this._functions = [];
    /** @private */ this._globals = [];
    /** @private */ this._breakStack = [];
    /** @private */ this._continueStack = [];
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** @returns {string} Fresh temporary variable name. */
  _newTemp() {
    return `t${this._tempCounter++}`;
  }

  /** @returns {string} Fresh label name. */
  _newLabel() {
    return `L${this._labelCounter++}`;
  }

  /** Emit a TAC instruction into the current instruction list. */
  _emit(op, result, arg1, arg2, extra) {
    this._instructions.push(new TACInstruction(op, result, arg1, arg2, extra));
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Generate TAC from a typed HIR program.
   *
   * @param {object} hirProgram - Root HIR Program node.
   * @returns {{ functions: TACFunction[], globals: object[] }}
   */
  generate(hirProgram) {
    if (!hirProgram || (hirProgram.type !== 'Program' && hirProgram.type !== 'program')) {
      throw new Error('TACGenerator.generate: expected a Program node');
    }

    const items = hirProgram.declarations || hirProgram.body || [];
    for (const node of items) {
      if (node.type === 'FunctionDecl' || node.type === 'FunctionDeclaration') {
        this._genFunction(node);
      } else if (node.type === 'VarDecl' || node.type === 'VariableDeclaration') {
        this._globals.push({ name: node.name, init: node.init });
      } else if (node.type === 'StructDecl' || node.type === 'StructDeclaration') {
        // Struct declaration
      } else {
        // Top-level statement — wrap in implicit main later if needed
        this._genStatement(node);
      }
    }

    // If there were top-level statements, bundle them into a _main function
    if (this._instructions.length > 0) {
      this._functions.push(new TACFunction(
        '_main', [], this._instructions.slice(), this._tempCounter
      ));
      this._instructions = [];
    }

    return { functions: this._functions, globals: this._globals };
  }

  // ── function / declaration ───────────────────────────────────────────────

  /** @private */
  _genFunction(node) {
    const savedInstr = this._instructions;
    const savedTemp = this._tempCounter;
    this._instructions = [];
    this._tempCounter = 0;

    const params = (node.params || []).map(p => p.name || p);

    // Allocate stack slots for params
    for (const p of params) {
      this._emit('alloc', p, 4); // 4 bytes default word size
    }

    this._genStatement(node.body);

    // Ensure there is always a return at the end
    const last = this._instructions[this._instructions.length - 1];
    if (!last || last.op !== 'return') {
      this._emit('return', null, null);
    }

    this._functions.push(new TACFunction(
      node.name, params, this._instructions.slice(), this._tempCounter
    ));

    this._instructions = savedInstr;
    this._tempCounter = savedTemp;
  }

  // ── statements ───────────────────────────────────────────────────────────

  /** @private */
  _genStatement(node) {
    if (!node) return;
    switch (node.type) {
      case 'Block':
      case 'BlockStatement':
        for (const s of (node.stmts || node.body || [])) this._genStatement(s);
        break;
      case 'VarDecl':
      case 'VariableDeclaration':
        this._genVarDecl(node);
        break;
      case 'ExprStmt':
      case 'ExpressionStatement':
        this._genExpression(node.expr || node.expression);
        break;
      case 'ReturnStmt':
      case 'ReturnStatement':
        this._genReturn(node);
        break;
      case 'IfStmt':
      case 'IfStatement':
        this._genIf(node);
        break;
      case 'WhileStmt':
      case 'WhileStatement':
        this._genWhile(node);
        break;
      case 'ForStmt':
      case 'ForStatement':
        this._genFor(node);
        break;
      case 'DoWhileStatement':
        this._genDoWhile(node);
        break;
      case 'BreakStmt':
      case 'BreakStatement':
        this._genBreak();
        break;
      case 'ContinueStmt':
      case 'ContinueStatement':
        this._genContinue();
        break;
      case 'SwitchStatement':
        this._genSwitch(node);
        break;
      default:
        // Treat as expression
        this._genExpression(node);
        break;
    }
  }

  /** @private */
  _genVarDecl(node) {
    this._emit('alloc', node.name, 4);
    const initVal = node.init !== undefined ? node.init : null;
    if (initVal) {
      const val = this._genExpression(initVal);
      this._emit('store', node.name, val);
    }
  }

  /** @private */
  _genReturn(node) {
    const valNode = node.value !== undefined ? node.value : node.argument;
    if (valNode) {
      const val = this._genExpression(valNode);
      this._emit('return', null, val);
    } else {
      this._emit('return', null, null);
    }
  }

  /** @private */
  _genIf(node) {
    const testNode = node.condition || node.test;
    const test = this._genExpression(testNode);
    const lblElse = this._newLabel();
    const lblEnd = this._newLabel();

    const elseNode = node.else || node.alternate;
    const thenNode = node.then || node.consequent;

    if (elseNode) {
      this._emit('ifFalse', null, test, null, { target: lblElse });
      this._genStatement(thenNode);
      this._emit('goto', null, null, null, { target: lblEnd });
      this._emit('label', null, null, null, { label: lblElse });
      this._genStatement(elseNode);
      this._emit('label', null, null, null, { label: lblEnd });
    } else {
      this._emit('ifFalse', null, test, null, { target: lblEnd });
      this._genStatement(thenNode);
      this._emit('label', null, null, null, { label: lblEnd });
    }
  }

  /** @private */
  _genWhile(node) {
    const lblStart = this._newLabel();
    const lblEnd = this._newLabel();

    this._breakStack.push(lblEnd);
    this._continueStack.push(lblStart);

    this._emit('label', null, null, null, { label: lblStart });
    const testNode = node.condition || node.test;
    const test = this._genExpression(testNode);
    this._emit('ifFalse', null, test, null, { target: lblEnd });
    this._genStatement(node.body);
    this._emit('goto', null, null, null, { target: lblStart });
    this._emit('label', null, null, null, { label: lblEnd });

    this._breakStack.pop();
    this._continueStack.pop();
  }

  /** @private */
  _genDoWhile(node) {
    const lblStart = this._newLabel();
    const lblContinue = this._newLabel();
    const lblEnd = this._newLabel();

    this._breakStack.push(lblEnd);
    this._continueStack.push(lblContinue);

    this._emit('label', null, null, null, { label: lblStart });
    this._genStatement(node.body);
    this._emit('label', null, null, null, { label: lblContinue });
    const test = this._genExpression(node.test);
    this._emit('ifTrue', null, test, null, { target: lblStart });
    this._emit('label', null, null, null, { label: lblEnd });

    this._breakStack.pop();
    this._continueStack.pop();
  }

  /** @private */
  _genFor(node) {
    if (node.init) {
      if (node.init.type === 'VariableDeclaration') {
        this._genVarDecl(node.init);
      } else {
        this._genExpression(node.init);
      }
    }

    const lblStart = this._newLabel();
    const lblUpdate = this._newLabel();
    const lblEnd = this._newLabel();

    this._breakStack.push(lblEnd);
    this._continueStack.push(lblUpdate);

    this._emit('label', null, null, null, { label: lblStart });
    if (node.test) {
      const test = this._genExpression(node.test);
      this._emit('ifFalse', null, test, null, { target: lblEnd });
    }
    this._genStatement(node.body);
    this._emit('label', null, null, null, { label: lblUpdate });
    if (node.update) {
      this._genExpression(node.update);
    }
    this._emit('goto', null, null, null, { target: lblStart });
    this._emit('label', null, null, null, { label: lblEnd });

    this._breakStack.pop();
    this._continueStack.pop();
  }

  /** @private */
  _genBreak() {
    if (this._breakStack.length === 0) {
      throw new Error('TACGenerator: break outside loop');
    }
    this._emit('goto', null, null, null, { target: this._breakStack[this._breakStack.length - 1] });
  }

  /** @private */
  _genContinue() {
    if (this._continueStack.length === 0) {
      throw new Error('TACGenerator: continue outside loop');
    }
    this._emit('goto', null, null, null, { target: this._continueStack[this._continueStack.length - 1] });
  }

  /** @private */
  _genSwitch(node) {
    const disc = this._genExpression(node.discriminant);
    const lblEnd = this._newLabel();
    this._breakStack.push(lblEnd);

    const caseLabels = node.cases.map(() => this._newLabel());
    const defaultIdx = node.cases.findIndex(c => c.test === null);

    // Test chain
    for (let i = 0; i < node.cases.length; i++) {
      if (node.cases[i].test === null) continue; // default
      const t = this._genExpression(node.cases[i].test);
      const cmp = this._newTemp();
      this._emit('eq', cmp, disc, t);
      this._emit('ifTrue', null, cmp, null, { target: caseLabels[i] });
    }
    // Jump to default or end
    this._emit('goto', null, null, null, { target: defaultIdx >= 0 ? caseLabels[defaultIdx] : lblEnd });

    // Case bodies
    for (let i = 0; i < node.cases.length; i++) {
      this._emit('label', null, null, null, { label: caseLabels[i] });
      for (const s of node.cases[i].consequent || []) {
        this._genStatement(s);
      }
    }

    this._emit('label', null, null, null, { label: lblEnd });
    this._breakStack.pop();
  }

  // ── expressions ──────────────────────────────────────────────────────────

  /**
   * Generate TAC for an expression, returning the temp/var that holds the result.
   * @private
   * @param {object} node
   * @returns {string|number}
   */
  _genExpression(node) {
    if (!node) return null;
    switch (node.type) {
      case 'IntLiteral':
      case 'CharLiteral':
      case 'StringLiteral':
      case 'BoolLiteral':
      case 'NullLiteral':
      case 'Literal':
        return this._genLiteral(node);
      case 'Identifier':
        return this._genIdentifier(node);
      case 'BinaryExpr':
      case 'BinaryExpression':
        return this._genBinary(node);
      case 'LogicalExpression':
        return this._genLogical(node);
      case 'UnaryExpr':
      case 'UnaryExpression':
        return this._genUnary(node);
      case 'AssignExpr':
      case 'AssignmentExpression':
        return this._genAssignment(node);
      case 'UpdateExpression':
        return this._genUpdate(node);
      case 'CallExpr':
      case 'CallExpression':
        return this._genCall(node);
      case 'MemberExpr':
      case 'MemberExpression':
        return this._genMember(node);
      case 'IndexExpr':
        return this._genIndex(node);
      case 'MallocExpr':
        return this._genMalloc(node);
      case 'SizeofExpr':
        return node.resolvedSize !== undefined ? node.resolvedSize : 4;
      case 'ArrayExpression':
        return this._genArray(node);
      case 'ConditionalExpression':
        return this._genConditional(node);
      case 'SequenceExpression':
        return this._genSequence(node);
      default:
        // Unknown – treat as opaque identifier
        return String(node.name || node.value || 'unknown');
    }
  }

  /** @private */
  _genLiteral(node) {
    if (typeof node.value === 'string') return `"${node.value}"`;
    if (node.value === null || node.type === 'NullLiteral') return 0;
    if (typeof node.value === 'boolean') return node.value ? 1 : 0;
    return node.value; // number
  }

  /** @private */
  _genIdentifier(node) {
    // Load from allocated slot
    const t = this._newTemp();
    this._emit('load', t, node.name);
    return t;
  }

  /** @private */
  _genBinary(node) {
    const left = this._genExpression(node.left);
    const right = this._genExpression(node.right);
    const t = this._newTemp();

    const opMap = {
      '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod',
      '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '==': 'eq', '!=': 'ne',
      '===': 'eq', '!==': 'ne',
      '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'shr'
    };
    const rawOp = node.op || node.operator;
    if (rawOp === '&&') {
      return this._genLogical({ operator: '&&', left: node.left, right: node.right });
    }
    if (rawOp === '||') {
      return this._genLogical({ operator: '||', left: node.left, right: node.right });
    }
    const op = opMap[rawOp] || rawOp;
    this._emit(op, t, left, right);
    return t;
  }

  /** @private — short-circuit evaluation */
  _genLogical(node) {
    const result = this._newTemp();
    const left = this._genExpression(node.left);
    const lblEnd = this._newLabel();

    const rawOp = node.op || node.operator;
    if (rawOp === '&&' || rawOp === 'and') {
      this._emit('copy', result, left);
      this._emit('ifFalse', null, left, null, { target: lblEnd });
      const right = this._genExpression(node.right);
      this._emit('copy', result, right);
      this._emit('label', null, null, null, { label: lblEnd });
    } else {
      // ||
      this._emit('copy', result, left);
      this._emit('ifTrue', null, left, null, { target: lblEnd });
      const right = this._genExpression(node.right);
      this._emit('copy', result, right);
      this._emit('label', null, null, null, { label: lblEnd });
    }
    return result;
  }

  /** @private */
  _genUnary(node) {
    const rawOp = node.op || node.operator;
    const operandNode = node.operand || node.argument;

    // Address-of: &x
    if (rawOp === '&') {
      const t = this._newTemp();
      this._emit('copy', t, operandNode.name || this._genExpression(operandNode));
      return t;
    }
    // Pointer dereference: *p
    if (rawOp === '*') {
      const ptr = this._genExpression(operandNode);
      const t = this._newTemp();
      this._emit('load', t, ptr);
      return t;
    }

    const arg = this._genExpression(operandNode);
    const t = this._newTemp();
    const opMap = { '-': 'neg', '!': 'not', '~': 'not' };
    const op = opMap[rawOp] || rawOp;
    this._emit(op, t, arg);
    return t;
  }

  /** @private */
  _genAssignment(node) {
    const targetNode = node.target || node.left;
    const valNode = node.value || node.right;
    const val = this._genExpression(valNode);
    const rawOp = node.op || node.operator;

    if (targetNode.type === 'Identifier') {
      if (rawOp === '=' || rawOp === undefined) {
        this._emit('store', targetNode.name, val);
        return val;
      }
      // Compound: +=, -=, etc.
      const cur = this._newTemp();
      this._emit('load', cur, targetNode.name);
      const opMap = { '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div', '%=': 'mod' };
      const t = this._newTemp();
      this._emit(opMap[rawOp] || 'add', t, cur, val);
      this._emit('store', targetNode.name, t);
      return t;
    }

    if (targetNode.type === 'MemberExpr' || targetNode.type === 'MemberExpression') {
      const obj = this._genExpression(targetNode.object);
      const field = targetNode.field || (targetNode.property && (targetNode.property.name || targetNode.property.value));
      const offset = (targetNode.fieldOffset !== undefined && targetNode.fieldOffset !== null) ? targetNode.fieldOffset : field;
      this._emit('setfield', obj, val, offset);
      return val;
    }

    if (targetNode.type === 'UnaryExpr' && targetNode.op === '*') {
      // *ptr = val
      const ptr = this._genExpression(targetNode.operand);
      this._emit('store', ptr, val);
      return val;
    }

    if (targetNode.type === 'IndexExpr') {
      const obj = this._genExpression(targetNode.object);
      const idx = this._genExpression(targetNode.index);
      const elemSize = (targetNode.resolvedType && targetNode.resolvedType.size) || 4;
      const addr = this._newTemp();
      const offset = this._newTemp();
      this._emit('mul', offset, idx, elemSize);
      this._emit('add', addr, obj, offset);
      this._emit('store', addr, val);
      return val;
    }

    // Fallback – just store to whatever the left name is
    this._emit('store', targetNode.name || '_unknown', val);
    return val;
  }

  /** @private */
  _genUpdate(node) {
    const operandNode = node.operand || node.argument;
    const name = operandNode.name || operandNode;
    const cur = this._newTemp();
    this._emit('load', cur, name);
    const t = this._newTemp();
    const rawOp = node.op || node.operator;
    const op = rawOp === '++' ? 'add' : 'sub';
    this._emit(op, t, cur, 1);
    this._emit('store', name, t);
    return node.prefix ? t : cur;
  }

  /** @private */
  _genCall(node) {
    const rawArgs = node.args || node.arguments || [];
    const args = rawArgs.map(a => this._genExpression(a));
    for (const a of args) {
      this._emit('param', null, a);
    }
    const callee = node.callee.name || this._genExpression(node.callee);
    const t = this._newTemp();
    this._emit('call', t, callee, args.length);
    return t;
  }

  /** @private */
  _genMember(node) {
    const obj = this._genExpression(node.object);
    const field = node.field || (node.property && (node.property.name || node.property.value));
    const offset = (node.fieldOffset !== undefined && node.fieldOffset !== null) ? node.fieldOffset : field;
    const t = this._newTemp();
    this._emit('getfield', t, obj, offset);
    return t;
  }

  /** @private */
  _genIndex(node) {
    const obj = this._genExpression(node.object);
    const idx = this._genExpression(node.index);
    const elemSize = (node.resolvedType && node.resolvedType.size) || 4;
    const offset = this._newTemp();
    const addr = this._newTemp();
    const t = this._newTemp();
    this._emit('mul', offset, idx, elemSize);
    this._emit('add', addr, obj, offset);
    this._emit('load', t, addr);
    return t;
  }

  /** @private */
  _genMalloc(node) {
    const size = this._genExpression(node.size);
    const t = this._newTemp();
    this._emit('malloc', t, size);
    return t;
  }

  /** @private */
  _genArray(node) {
    const base = this._newTemp();
    const size = (node.elements || []).length;
    this._emit('alloc', base, size * 4);
    for (let i = 0; i < size; i++) {
      const val = this._genExpression(node.elements[i]);
      const addr = this._newTemp();
      this._emit('index', addr, base, i);
      this._emit('store', addr, val);
    }
    return base;
  }

  /** @private */
  _genConditional(node) {
    const test = this._genExpression(node.test);
    const result = this._newTemp();
    const lblElse = this._newLabel();
    const lblEnd = this._newLabel();

    this._emit('ifFalse', null, test, null, { target: lblElse });
    const cons = this._genExpression(node.consequent);
    this._emit('copy', result, cons);
    this._emit('goto', null, null, null, { target: lblEnd });
    this._emit('label', null, null, null, { label: lblElse });
    const alt = this._genExpression(node.alternate);
    this._emit('copy', result, alt);
    this._emit('label', null, null, null, { label: lblEnd });

    return result;
  }

  /** @private */
  _genSequence(node) {
    let last = null;
    for (const e of node.expressions) {
      last = this._genExpression(e);
    }
    return last;
  }
}

module.exports = {
  TACInstruction,
  TACFunction,
  TACGenerator,
  VALID_OPS,
  isLiteral
};
