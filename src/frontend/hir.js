'use strict';

/**
 * @module hir
 * @description High-Level Intermediate Representation (HIR) and Type Checker.
 * Performs type inference, type checking, scope management, and AST desugaring.
 */

const { NodeType, createNode } = require('./ast');

class Type {
  static INT = { kind: 'int', size: 4, name: 'int' };
  static CHAR = { kind: 'char', size: 1, name: 'char' };
  static BOOL = { kind: 'bool', size: 4, name: 'bool' };
  static VOID = { kind: 'void', size: 0, name: 'void' };

  static pointer(base) {
    return { kind: 'pointer', base, size: 4, name: `${base.name}*` };
  }

  static array(base, count) {
    return { kind: 'array', base, count, size: base.size * count, name: `${base.name}[${count}]` };
  }

  static struct(structName, fields = []) {
    let offset = 0;
    const resolvedFields = [];
    for (const f of fields) {
      // 4-byte alignment
      const align = Math.min(4, f.type.size || 4);
      if (align > 0 && offset % align !== 0) {
        offset += align - (offset % align);
      }
      resolvedFields.push({ name: f.name, type: f.type, offset });
      offset += f.type.size || 4;
    }
    // Struct total size rounded up to 4 bytes
    if (offset % 4 !== 0) offset += 4 - (offset % 4);

    return {
      kind: 'struct',
      structName,
      fields: resolvedFields,
      size: Math.max(4, offset),
      name: `struct ${structName}`
    };
  }

  static functionType(returnType, paramTypes = []) {
    return {
      kind: 'function',
      returnType,
      paramTypes,
      size: 4,
      name: `(${paramTypes.map(p => p.name).join(', ')}) -> ${returnType.name}`
    };
  }

  static areEqual(t1, t2) {
    if (!t1 || !t2) return false;
    if (t1.kind !== t2.kind) {
      // Allow int and bool or null pointer assignments
      if ((t1.kind === 'int' && t2.kind === 'bool') || (t1.kind === 'bool' && t2.kind === 'int')) return true;
      if (t1.kind === 'pointer' && t2.kind === 'null') return true;
      if (t1.kind === 'null' && t2.kind === 'pointer') return true;
      return false;
    }
    if (t1.kind === 'pointer') return Type.areEqual(t1.base, t2.base);
    if (t1.kind === 'array') return Type.areEqual(t1.base, t2.base);
    if (t1.kind === 'struct') return t1.structName === t2.structName;
    return true;
  }
}

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.symbols = new Map();
  }

  define(name, symbol) {
    this.symbols.set(name, symbol);
  }

  lookup(name) {
    if (this.symbols.has(name)) {
      return this.symbols.get(name);
    }
    if (this.parent) {
      return this.parent.lookup(name);
    }
    return null;
  }
}

class TypeChecker {
  constructor() {
    this.globalScope = new Scope();
    this.currentScope = this.globalScope;
    this.structs = new Map();
    this.currentFunction = null;
    this.errors = [];

    // Register built-in functions
    this.registerBuiltins();
  }

  registerBuiltins() {
    this.globalScope.define('print_int', {
      name: 'print_int',
      type: Type.functionType(Type.VOID, [Type.INT])
    });
    this.globalScope.define('print_str', {
      name: 'print_str',
      type: Type.functionType(Type.VOID, [Type.pointer(Type.CHAR)])
    });
    this.globalScope.define('malloc', {
      name: 'malloc',
      type: Type.functionType(Type.pointer(Type.VOID), [Type.INT])
    });
    this.globalScope.define('free', {
      name: 'free',
      type: Type.functionType(Type.VOID, [Type.pointer(Type.VOID)])
    });
  }

  enterScope() {
    this.currentScope = new Scope(this.currentScope);
  }

  exitScope() {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
    }
  }

  resolveType(typeAst) {
    if (!typeAst) return Type.INT;
    switch (typeAst.kind) {
      case 'int': return Type.INT;
      case 'char': return Type.CHAR;
      case 'bool': return Type.BOOL;
      case 'void': return Type.VOID;
      case 'pointer': return Type.pointer(this.resolveType(typeAst.base));
      case 'array': return Type.array(this.resolveType(typeAst.base), typeAst.size || 0);
      case 'struct': {
        const structDef = this.structs.get(typeAst.structName);
        if (structDef) return structDef;
        // Forward declaration / unresolved
        return { kind: 'struct', structName: typeAst.structName, size: 4, name: `struct ${typeAst.structName}` };
      }
      default: return Type.INT;
    }
  }

  check(ast) {
    if (ast.type !== NodeType.Program) {
      throw new Error("Expected Program AST node");
    }

    // Pass 1: Collect struct declarations
    for (const decl of ast.declarations) {
      if (decl.type === NodeType.StructDecl) {
        // Temporary placeholder for recursive structs (like struct Node* next)
        const placeholder = { kind: 'struct', structName: decl.name, fields: [], size: 4, name: `struct ${decl.name}` };
        this.structs.set(decl.name, placeholder);
      }
    }
    for (const decl of ast.declarations) {
      if (decl.type === NodeType.StructDecl) {
        const resolvedFields = decl.fields.map(f => ({
          name: f.name,
          type: this.resolveType(f.type)
        }));
        const structType = Type.struct(decl.name, resolvedFields);
        this.structs.set(decl.name, structType);
      }
    }

    // Pass 2: Collect function signatures & global variables
    for (const decl of ast.declarations) {
      if (decl.type === NodeType.FunctionDecl) {
        const retType = this.resolveType(decl.returnType);
        const paramTypes = decl.params.map(p => this.resolveType(p.type));
        const fnType = Type.functionType(retType, paramTypes);
        this.globalScope.define(decl.name, { name: decl.name, type: fnType, isFunction: true });
      } else if (decl.type === NodeType.VarDecl) {
        const varType = this.resolveType(decl.varType || decl.dataType || decl.type);
        this.globalScope.define(decl.name, { name: decl.name, type: varType, isGlobal: true });
      }
    }

    // Pass 3: Type check function bodies and expressions
    for (const decl of ast.declarations) {
      if (decl.type === NodeType.FunctionDecl) {
        this.checkFunction(decl);
      } else if (decl.type === NodeType.VarDecl && decl.init) {
        this.checkExpression(decl.init);
      }
    }

    return ast;
  }

  checkFunction(fnDecl) {
    this.currentFunction = fnDecl;
    this.enterScope();

    // Add params to scope
    for (const p of fnDecl.params) {
      const pType = this.resolveType(p.type);
      p.resolvedType = pType;
      this.currentScope.define(p.name, { name: p.name, type: pType, isParam: true });
    }

    // Check body
    this.checkBlock(fnDecl.body);

    this.exitScope();
    this.currentFunction = null;
  }

  checkBlock(block) {
    this.enterScope();
    for (let i = 0; i < block.stmts.length; i++) {
      block.stmts[i] = this.checkStatement(block.stmts[i]);
    }
    this.exitScope();
  }

  checkStatement(stmt) {
    if (!stmt) return null;

    switch (stmt.type) {
      case NodeType.Block:
        this.checkBlock(stmt);
        return stmt;

      case NodeType.VarDecl: {
        const varType = this.resolveType(stmt.varType || stmt.dataType || stmt.type);
        stmt.resolvedType = varType;
        if (stmt.init) {
          stmt.init = this.checkExpression(stmt.init);
        }
        this.currentScope.define(stmt.name, { name: stmt.name, type: varType });
        return stmt;
      }

      case NodeType.ExprStmt:
        stmt.expr = this.checkExpression(stmt.expr);
        return stmt;

      case NodeType.IfStmt:
        stmt.condition = this.checkExpression(stmt.condition);
        stmt.then = this.checkStatement(stmt.then);
        if (stmt.else) {
          stmt.else = this.checkStatement(stmt.else);
        }
        return stmt;

      case NodeType.WhileStmt:
        stmt.condition = this.checkExpression(stmt.condition);
        stmt.body = this.checkStatement(stmt.body);
        return stmt;

      case NodeType.ForStmt: {
        // Desugar for (init; cond; update) body -> { init; while (cond) { body; update; } }
        this.enterScope();
        if (stmt.init) {
          stmt.init = this.checkStatement(stmt.init);
        }
        if (stmt.condition) {
          stmt.condition = this.checkExpression(stmt.condition);
        } else {
          stmt.condition = createNode(NodeType.BoolLiteral, { value: true }, stmt.loc);
          stmt.condition.resolvedType = Type.BOOL;
        }
        if (stmt.update) {
          stmt.update = this.checkExpression(stmt.update);
        }
        stmt.body = this.checkStatement(stmt.body);
        this.exitScope();
        return stmt;
      }

      case NodeType.ReturnStmt:
        if (stmt.value) {
          stmt.value = this.checkExpression(stmt.value);
        }
        return stmt;

      case NodeType.BreakStmt:
      case NodeType.ContinueStmt:
        return stmt;

      default:
        return stmt;
    }
  }

  checkExpression(expr) {
    if (!expr) return null;

    switch (expr.type) {
      case NodeType.IntLiteral:
        expr.resolvedType = Type.INT;
        return expr;

      case NodeType.CharLiteral:
        expr.resolvedType = Type.CHAR;
        return expr;

      case NodeType.StringLiteral:
        expr.resolvedType = Type.pointer(Type.CHAR);
        return expr;

      case NodeType.BoolLiteral:
        expr.resolvedType = Type.BOOL;
        return expr;

      case NodeType.NullLiteral:
        expr.resolvedType = { kind: 'null', size: 4, name: 'null' };
        return expr;

      case NodeType.Identifier: {
        const sym = this.currentScope.lookup(expr.name);
        if (!sym) {
          // Check if it's a function
          const fnSym = this.globalScope.lookup(expr.name);
          if (fnSym) {
            expr.resolvedType = fnSym.type;
            return expr;
          }
          const err = new Error(`Undeclared identifier '${expr.name}' at line ${expr.loc.line}`);
          this.errors.push(err);
          expr.resolvedType = Type.INT; // fallback
          return expr;
        }
        expr.resolvedType = sym.type;
        return expr;
      }

      case NodeType.BinaryExpr: {
        expr.left = this.checkExpression(expr.left);
        expr.right = this.checkExpression(expr.right);
        const lType = expr.left.resolvedType;
        const rType = expr.right.resolvedType;

        // Comparison ops return bool
        if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(expr.op)) {
          expr.resolvedType = Type.BOOL;
        } else if (lType.kind === 'pointer' && rType.kind === 'int') {
          // Pointer arithmetic: ptr + int -> ptr
          expr.resolvedType = lType;
        } else {
          expr.resolvedType = lType || Type.INT;
        }
        return expr;
      }

      case NodeType.UnaryExpr: {
        expr.operand = this.checkExpression(expr.operand);
        const opType = expr.operand.resolvedType;

        if (expr.op === '&') {
          // Address-of: &x -> T*
          expr.resolvedType = Type.pointer(opType);
        } else if (expr.op === '*') {
          // Dereference: *p -> T
          if (opType.kind === 'pointer') {
            expr.resolvedType = opType.base;
          } else {
            expr.resolvedType = Type.INT;
          }
        } else if (expr.op === '!') {
          expr.resolvedType = Type.BOOL;
        } else {
          expr.resolvedType = opType;
        }
        return expr;
      }

      case NodeType.CallExpr: {
        expr.callee = this.checkExpression(expr.callee);
        for (let i = 0; i < expr.args.length; i++) {
          expr.args[i] = this.checkExpression(expr.args[i]);
        }
        if (expr.callee.resolvedType && expr.callee.resolvedType.kind === 'function') {
          expr.resolvedType = expr.callee.resolvedType.returnType;
        } else {
          expr.resolvedType = Type.INT;
        }
        return expr;
      }

      case NodeType.IndexExpr: {
        expr.object = this.checkExpression(expr.object);
        expr.index = this.checkExpression(expr.index);
        const objType = expr.object.resolvedType;
        if (objType && (objType.kind === 'array' || objType.kind === 'pointer')) {
          expr.resolvedType = objType.base;
        } else {
          expr.resolvedType = Type.INT;
        }
        return expr;
      }

      case NodeType.MemberExpr: {
        expr.object = this.checkExpression(expr.object);
        let objType = expr.object.resolvedType;

        if (expr.arrow) {
          // Desugar: expr->field => (*expr).field
          if (objType && objType.kind === 'pointer') {
            objType = objType.base;
          }
        }

        if (objType && objType.kind === 'struct') {
          const structDef = this.structs.get(objType.structName) || objType;
          const field = structDef.fields ? structDef.fields.find(f => f.name === expr.field) : null;
          if (field) {
            expr.resolvedType = field.type;
            expr.fieldOffset = field.offset;
          } else {
            expr.resolvedType = Type.INT;
          }
        } else {
          expr.resolvedType = Type.INT;
        }
        return expr;
      }

      case NodeType.AssignExpr: {
        expr.target = this.checkExpression(expr.target);
        expr.value = this.checkExpression(expr.value);
        expr.resolvedType = expr.target.resolvedType;
        return expr;
      }

      case NodeType.SizeofExpr: {
        let size = 4;
        if (expr.target.kind) {
          // Target is a Type
          const resolved = this.resolveType(expr.target);
          size = resolved.size || 4;
        } else {
          // Target is an Expr
          expr.target = this.checkExpression(expr.target);
          size = (expr.target.resolvedType && expr.target.resolvedType.size) || 4;
        }
        expr.resolvedSize = size;
        expr.resolvedType = Type.INT;
        return expr;
      }

      case NodeType.MallocExpr: {
        expr.size = this.checkExpression(expr.size);
        expr.resolvedType = Type.pointer(Type.VOID);
        return expr;
      }

      default:
        expr.resolvedType = Type.INT;
        return expr;
    }
  }
}

module.exports = {
  Type,
  Scope,
  TypeChecker,
};
