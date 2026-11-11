// SPDX-License-Identifier: Apache-2.0
// Structured, machine-readable errors. Every refusal VYMEM makes carries a stable `code`.
export class VymemError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VymemError';
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(err) {
  if (err instanceof VymemError) {
    return { error: { code: err.code, message: err.message, details: err.details } };
  }
  return { error: { code: 'INTERNAL_ERROR', message: 'Operation failed safely.' } };
}
