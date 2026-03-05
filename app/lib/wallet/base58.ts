const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX: Record<string, number> = Object.fromEntries(
  BASE58_ALPHABET.split('').map((char, index) => [char, index]),
);

export function base58Decode(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  const bytes: number[] = [0];

  for (const char of value) {
    const carryBase = BASE58_INDEX[char];

    if (carryBase === undefined) {
      throw new Error('Invalid base58 character');
    }

    let carry = carryBase;

    for (let i = 0; i < bytes.length; i++) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading "1" chars represent leading zero bytes.
  for (let i = 0; i < value.length && value[i] === '1'; i++) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function base58Encode(input: Uint8Array): string {
  if (!input.length) {
    return '';
  }

  const digits = [0];

  for (const byte of input) {
    let carry = byte;

    for (let i = 0; i < digits.length; i++) {
      const next = digits[i] * 256 + carry;
      digits[i] = next % 58;
      carry = Math.floor(next / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = '';

  for (let i = 0; i < input.length && input[i] === 0; i++) {
    result += '1';
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }

  return result;
}
