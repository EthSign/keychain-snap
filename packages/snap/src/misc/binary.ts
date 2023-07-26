/* eslint-disable no-bitwise */
import nacl from 'tweetnacl';

/**
 * Takes in a number and returns its representation as a Uint8Array.
 *
 * @param number - The number to be converted to a binary array.
 * @returns Uint8Array representation of the number passed in as a parameter.
 */
export function numberToBytes(number: number) {
  let num = number;
  const length = Math.ceil(Math.log2(num) / 8);
  const byteArray = new Uint8Array(length);

  for (let index = 0; index < byteArray.length; index++) {
    const byte = num & 0xff;
    byteArray[index] = byte;
    num = (num - byte) / 256;
  }

  return byteArray;
}

/**
 * Use a timestamp to generate a Uint8Array representing a nonce.
 *
 * @param timestamp - The unix timestamp used for nonce generation.
 * @returns Uint8Array nonce value.
 */
export function generateNonce(timestamp: number) {
  const ts = numberToBytes(timestamp);
  const randomBytes = nacl.randomBytes(24 - ts.length);

  const nonce = new Uint8Array(24);
  nonce.set(randomBytes);
  nonce.set(ts, randomBytes.length);

  return nonce;
}

/**
 * Convert a Uint8Array to its string representation.
 *
 * @param arr - Uint8Array to convert to a string.
 * @returns String representation of the provided Uint8Array.
 */
export function uint8ArrayToString(arr: Uint8Array) {
  return btoa(String.fromCharCode.apply(null, Array.from(arr)));
}

/**
 * Convert a string to its Uint8Array representation.
 *
 * @param str - String to convert to a Uint8Array.
 * @returns Uint8Array representation of the provided string.
 */
export function stringToUint8Array(str: string) {
  return new Uint8Array(
    atob(str)
      .split('')
      .map((char) => char.charCodeAt(0))
  );
}
