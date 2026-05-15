/**
 * Pump SDK Patch
 * 
 * This file patches the @pump-fun/pump-swap-sdk initialization issue
 * where it tries to create a PublicKey with invalid data during module load.
 * 
 * The issue is in the SDK's internal initialization where it references
 * program IDs that may not be properly initialized.
 */

import { PublicKey } from '@solana/web3.js';

// Patch the PublicKey constructor to handle invalid inputs gracefully during SDK init
const originalPublicKey = PublicKey;
const OriginalPublicKeyConstructor = PublicKey.prototype.constructor;

// Store the original constructor
const _originalConstructor = PublicKey;

// Create a wrapper that validates input before calling the original
function PatchedPublicKey(value) {
    // If value is undefined, null, empty string, or empty array, use a default valid key
    if (!value || 
        value === '' || 
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'string' && value.trim() === '')) {
        
        console.warn('[PumpSDK Patch] Invalid PublicKey value detected, using default');
        // Use a valid default public key (System Program)
        value = '11111111111111111111111111111111';
    }
    
    // Call the original constructor
    return new _originalConstructor(value);
}

// Copy all static methods and properties
Object.setPrototypeOf(PatchedPublicKey, _originalConstructor);
PatchedPublicKey.prototype = _originalConstructor.prototype;

// Export the patched version
export { PatchedPublicKey as PublicKey };
export default PatchedPublicKey;
