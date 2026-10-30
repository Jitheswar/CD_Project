'use strict';

/**
 * @module vm
 * @description NexCC 32-bit Virtual Machine with Shadow Memory and Time-Travel Debugging.
 * Executes bytecode generated from Lowered IR, providing:
 *   - Virtual registers r0 - r255
 *   - Dynamic shadow memory tracking
 *   - Step forward / step back execution
 *   - Memory safety violation diagnostics
 */

const { Opcode } = require('./bytecode');
const { ShadowMemory } = require('./shadow-memory');
const { ExecutionHistory } = require('./history');

class VM {
  /**
   * @param {import('./bytecode').BytecodeProgram} program
   * @param {object} [options={}]
   */
  constructor(program, options = {}) {
    this.program = program;
    this.instructions = program ? program.instructions : [];

    // Registers: 256 32-bit signed integers
    this.registers = new Int32Array(256);
    this.entryPC = (program && program.functionTable && program.functionTable.has('main'))
      ? program.functionTable.get('main')
      : 0;
    this.pc = this.entryPC;
    this.sp = 0xFFFFFFFC;
    this.fp = 0xFFFFFFFC;

    // Call stack for function calls: array of { returnPC, savedFP, savedRegisters }
    this.callStack = [];
    this.argStack = [];

    // Memory
    this.shadowMemory = new ShadowMemory();

    // Output and diagnostics
    this.stdout = [];
    this.isHalted = false;
    this.violations = [];

    // Time-travel history
    this.history = new ExecutionHistory(options.maxHistory || 20000);

    // Track initial state
    this.history.record(this.pc, this.registers, [], 0, null);
  }

  reset() {
    this.registers.fill(0);
    this.pc = this.entryPC || 0;
    this.sp = 0xFFFFFFFC;
    this.fp = 0xFFFFFFFC;
    this.callStack = [];
    this.argStack = [];
    this.shadowMemory = new ShadowMemory();
    this.stdout = [];
    this.isHalted = false;
    this.violations = [];
    this.history = new ExecutionHistory();
    this.history.record(this.pc, this.registers, [], 0, null);
  }

  /**
   * Execute one instruction forward.
   * @returns {{ halted: boolean, pc: number, ins: string|null, violation: string|null }}
   */
  step() {
    if (this.isHalted || this.pc < 0 || this.pc >= this.instructions.length) {
      this.isHalted = true;
      return { halted: true, pc: this.pc, ins: null, violation: null };
    }

    const ins = this.instructions[this.pc];
    const prevPC = this.pc;
    const memoryWrites = [];
    let violation = null;

    // Advance PC by default
    this.pc++;

    switch (ins.opcode) {
      // Arithmetic
      case Opcode.ADD:
        this.registers[ins.rDest] = (this.registers[ins.rSrc1] + (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2])) | 0;
        break;

      case Opcode.SUB:
        this.registers[ins.rDest] = (this.registers[ins.rSrc1] - (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2])) | 0;
        break;

      case Opcode.MUL:
        this.registers[ins.rDest] = Math.imul(this.registers[ins.rSrc1], (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]));
        break;

      case Opcode.DIV: {
        const divisor = ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2];
        this.registers[ins.rDest] = divisor !== 0 ? ((this.registers[ins.rSrc1] / divisor) | 0) : 0;
        break;
      }

      case Opcode.MOD: {
        const divisor = ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2];
        this.registers[ins.rDest] = divisor !== 0 ? (this.registers[ins.rSrc1] % divisor) : 0;
        break;
      }

      case Opcode.AND:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] & (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]);
        break;

      case Opcode.OR:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] | (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]);
        break;

      case Opcode.XOR:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] ^ (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]);
        break;

      case Opcode.SHL:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] << (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]);
        break;

      case Opcode.SHR:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] >> (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]);
        break;

      // Comparison
      case Opcode.LT:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] < (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      case Opcode.LE:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] <= (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      case Opcode.GT:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] > (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      case Opcode.GE:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] >= (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      case Opcode.EQ:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] === (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      case Opcode.NE:
        this.registers[ins.rDest] = this.registers[ins.rSrc1] !== (ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc2]) ? 1 : 0;
        break;

      // Register moves
      case Opcode.LOAD_IMM:
        this.registers[ins.rDest] = ins.imm | 0;
        break;

      case Opcode.MOV:
        this.registers[ins.rDest] = this.registers[ins.rSrc1];
        break;

      // Memory
      case Opcode.LOAD: {
        const addr = this.registers[ins.rSrc1] + ins.imm;
        const check = this.shadowMemory.checkRead(addr, 4);
        if (!check.ok) {
          violation = check.violation;
          this.violations.push(violation);
        }
        this.registers[ins.rDest] = this.shadowMemory.read32(addr);
        break;
      }

      case Opcode.STORE: {
        const addr = this.registers[ins.rDest] + ins.imm;
        const val = this.registers[ins.rSrc1];
        const check = this.shadowMemory.checkWrite(addr, 4);
        if (!check.ok) {
          violation = check.violation;
          this.violations.push(violation);
        }
        const oldVal = this.shadowMemory.write32(addr, val);
        memoryWrites.push({ addr, oldVal, newVal: val });
        break;
      }

      case Opcode.MALLOC: {
        this.argStack = this.argStack || [];
        const size = this.argStack.length > 0 ? this.argStack.pop() : (this.registers[ins.rSrc1] || ins.imm || 4);
        const addr = this.shadowMemory.malloc(size);
        this.registers[ins.rDest] = addr;
        break;
      }

      case Opcode.FREE: {
        this.argStack = this.argStack || [];
        const addr = this.argStack.length > 0 ? this.argStack.pop() : this.registers[ins.rSrc1];
        const check = this.shadowMemory.free(addr);
        if (!check.ok) {
          violation = check.violation;
          this.violations.push(violation);
        }
        break;
      }

      // Control flow
      case Opcode.JMP:
        this.pc = ins.imm;
        break;

      case Opcode.JMP_IF:
        if (this.registers[ins.rSrc1] !== 0) {
          this.pc = ins.imm;
        }
        break;

      case Opcode.JMP_IF_NOT:
        if (this.registers[ins.rSrc1] === 0) {
          this.pc = ins.imm;
        }
        break;

      case Opcode.CALL: {
        const savedRegs = new Int32Array(this.registers);
        this.callStack.push({
          returnPC: this.pc,
          savedFP: this.fp,
          destReg: ins.rDest,
          savedRegisters: savedRegs
        });
        this.fp = this.sp;

        const numArgs = ins.rSrc2 || 1;
        const args = [];
        for (let i = 0; i < numArgs; i++) {
          if (this.argStack && this.argStack.length > 0) {
            args.unshift(this.argStack.pop());
          }
        }
        for (let i = 0; i < args.length; i++) {
          this.registers[i] = args[i];
        }

        this.pc = ins.imm;
        break;
      }

      case Opcode.PUSH: {
        const val = ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc1];
        this.argStack = this.argStack || [];
        this.argStack.push(val);
        break;
      }

      case Opcode.POP: {
        this.argStack = this.argStack || [];
        this.registers[ins.rDest] = this.argStack.length > 0 ? this.argStack.pop() : 0;
        break;
      }

      case Opcode.RET: {
        const returnVal = ins.imm !== 0 ? ins.imm : this.registers[ins.rSrc1];
        if (this.callStack.length > 0) {
          const frame = this.callStack.pop();
          this.pc = frame.returnPC;
          this.fp = frame.savedFP;
          this.registers.set(frame.savedRegisters);
          this.registers[frame.destReg] = returnVal;
        } else {
          // Returning from main
          this.registers[0] = returnVal;
          this.isHalted = true;
        }
        break;
      }

      // Runtime Built-ins
      case Opcode.PRINT_INT: {
        this.argStack = this.argStack || [];
        const val = this.argStack.length > 0 ? this.argStack.pop() : (this.registers[ins.rSrc1] || ins.imm || this.registers[0]);
        this.stdout.push(String(val));
        break;
      }

      case Opcode.PRINT_STR: {
        // Read null-terminated string from address in rSrc1
        const addr = this.registers[ins.rSrc1] || this.registers[0];
        let str = '';
        for (let i = 0; i < 256; i++) {
          const byte = this.shadowMemory.dataView.getUint8(this.shadowMemory._physicalOffset(addr + i));
          if (byte === 0) break;
          str += String.fromCharCode(byte);
        }
        this.stdout.push(str);
        break;
      }

      case Opcode.HALT:
        this.isHalted = true;
        break;

      default:
        break;
    }

    // Record step in execution history
    this.history.record(this.pc, this.registers, memoryWrites, this.stdout.length, ins);

    return {
      halted: this.isHalted,
      pc: this.pc,
      prevPC,
      ins: ins.toString(),
      violation
    };
  }

  /**
   * Step backwards one instruction in time.
   * @returns {boolean} true if stepped back
   */
  stepBack() {
    if (!this.history.canStepBack()) {
      return false;
    }

    // Get current record to reverse its memory writes
    const current = this.history.getCurrentState();
    if (current && current.memoryWrites) {
      // Revert writes in reverse order
      for (let i = current.memoryWrites.length - 1; i >= 0; i--) {
        const w = current.memoryWrites[i];
        this.shadowMemory.write32(w.addr, w.oldVal);
      }
    }

    // Restore previous state
    const prev = this.history.getPreviousState();
    if (prev) {
      this.pc = prev.pc;
      this.registers.set(prev.registers);
      this.isHalted = false;
      if (this.stdout.length > prev.stdoutLength) {
        this.stdout.length = prev.stdoutLength;
      }
      return true;
    }

    return false;
  }

  /**
   * Run until HALT or maximum instruction limit.
   * @param {number} [maxSteps=100000]
   * @returns {{ returnValue: number, stdout: string[], steps: number, violations: string[] }}
   */
  run(maxSteps = 100000) {
    let steps = 0;
    while (!this.isHalted && steps < maxSteps) {
      this.step();
      steps++;
    }

    return {
      returnValue: this.registers[0],
      stdout: [...this.stdout],
      steps,
      violations: [...this.violations]
    };
  }

  getState() {
    return {
      pc: this.pc,
      registers: Array.from(this.registers.slice(0, 32)), // First 32 registers
      isHalted: this.isHalted,
      stdout: [...this.stdout],
      violations: [...this.violations],
      heapAllocations: this.shadowMemory.addressMap.map(a => ({
        id: a.id,
        base: `0x${a.base.toString(16)}`,
        size: a.size,
        region: a.region
      }))
    };
  }
}

module.exports = { VM };
