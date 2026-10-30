'use strict';

/**
 * @module history
 * @description Time-Travel Execution History for NexCC Bytecode VM.
 * Enables reversible execution: records step-by-step register states,
 * PC positions, and delta-encoded memory writes so executions can
 * step backwards and forwards freely.
 */

class StepRecord {
  /**
   * @param {number} step
   * @param {number} pc
   * @param {Int32Array} registers - Snapshot of 256 VM registers
   * @param {Array<{ addr: number, oldVal: number, newVal: number }>} memoryWrites
   * @param {number} stdoutLength
   * @param {object} [ins=null]
   */
  constructor(step, pc, registers, memoryWrites = [], stdoutLength = 0, ins = null) {
    this.step = step;
    this.pc = pc;
    this.registers = new Int32Array(registers); // Copy
    this.memoryWrites = memoryWrites;
    this.stdoutLength = stdoutLength;
    this.instruction = ins ? ins.toString() : '';
  }
}

class ExecutionHistory {
  /**
   * @param {number} maxSteps
   */
  constructor(maxSteps = 50000) {
    this.maxSteps = maxSteps;
    this.timeline = []; // Array<StepRecord>
    this.cursor = -1;
  }

  record(pc, registers, memoryWrites = [], stdoutLength = 0, ins = null) {
    // If stepped back and made new execution, discard future branch
    if (this.cursor >= 0 && this.cursor < this.timeline.length - 1) {
      this.timeline.splice(this.cursor + 1);
    }

    const stepNum = this.timeline.length;
    const record = new StepRecord(stepNum, pc, registers, memoryWrites, stdoutLength, ins);
    this.timeline.push(record);
    this.cursor = this.timeline.length - 1;

    if (this.timeline.length > this.maxSteps) {
      this.timeline.shift();
      this.cursor--;
    }

    return record;
  }

  canStepBack() {
    return this.cursor > 0;
  }

  canStepForward() {
    return this.cursor < this.timeline.length - 1;
  }

  getPreviousState() {
    if (!this.canStepBack()) return null;
    this.cursor--;
    return this.timeline[this.cursor];
  }

  getNextState() {
    if (!this.canStepForward()) return null;
    this.cursor++;
    return this.timeline[this.cursor];
  }

  getCurrentState() {
    if (this.cursor >= 0 && this.cursor < this.timeline.length) {
      return this.timeline[this.cursor];
    }
    return null;
  }

  getTimeline() {
    return this.timeline.map((item, idx) => ({
      step: item.step,
      pc: item.pc,
      instruction: item.instruction,
      isCurrent: idx === this.cursor
    }));
  }
}

module.exports = {
  StepRecord,
  ExecutionHistory,
};
