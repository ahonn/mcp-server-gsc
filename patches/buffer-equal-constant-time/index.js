/*jshint node:true */
'use strict';

var Buffer = require('buffer').Buffer;
var crypto = require('crypto');

module.exports = bufferEq;

/**
 * Constant-time buffer comparison.
 *
 * Uses crypto.timingSafeEqual when available (Node.js >= 6.6.0).
 * Falls back to manual XOR comparison for older versions.
 *
 * @param {Buffer} a - First buffer
 * @param {Buffer} b - Second buffer
 * @returns {boolean} - True if buffers are equal
 */
function bufferEq(a, b) {
  // Type check is necessary for correctness
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    return false;
  }

  // Buffer sizes should be well-known information, so this is safe
  if (a.length !== b.length) {
    return false;
  }

  // Use native timing-safe comparison (available since Node.js 6.6.0)
  if (crypto.timingSafeEqual) {
    return crypto.timingSafeEqual(a, b);
  }

  // Fallback for very old Node.js versions (should never be reached in practice)
  var c = 0;
  for (var i = 0; i < a.length; i++) {
    c |= a[i] ^ b[i];
  }
  return c === 0;
}

// Deprecated methods - kept for API compatibility but are now no-ops
// The original implementation modified Buffer.prototype which is unsafe
bufferEq.install = function() {
  // No-op - modifying Buffer.prototype is deprecated
};

bufferEq.restore = function() {
  // No-op - modifying Buffer.prototype is deprecated
};
