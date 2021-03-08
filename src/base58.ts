// Helpers for encoding to base58
// Used for generating public addresses from public keys

// Limited char table excluding things like 0 and O
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base = alphabet.length;
const LEADER = alphabet[0];
const FACTOR = Math.log(base) / Math.log(256); // log(BASE) / log(256), rounded up
const iFACTOR = Math.log(256) / Math.log(base); // log(256) / log(BASE), rounded up

const BASE_MAP = Uint8Array.from({
  length: 256,
}, () => 255);

for (let i = 0; i < alphabet.length; i++) {
  const ch = alphabet[i];
  const xc = ch.charCodeAt(0);

  BASE_MAP[xc] = i;
}

// Rough port of https://github.com/cryptocoinjs/base-x/ to Deno
// Don't try to understand it (I certainly don't)
// Read this for more info on base58 https://tools.ietf.org/id/draft-msporny-base58-01.html#rfc.section.4

export function encode(data: ArrayBuffer | string): string {
  const uint8 = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array
    ? data
    : new Uint8Array(data);

  // Skip leading zeroes
  let zeroes = 0;
  let length = 0;
  let pbegin = 0;
  let pend = uint8.length;

  while (pbegin !== pend && uint8[pbegin] === 0) {
    pbegin += 1;
    zeroes += 1;
  }

  const size = ((pend - pbegin) * iFACTOR + 1) >>> 0;
  const result = new Uint8Array(size);

  while (pbegin !== pend) {
    let carry = uint8[pbegin];

    let i = 0;
    // Apply "b58 = b58 * 256 + ch".
    for (
      var it1 = size - 1;
      (carry !== 0 || i < length) && (it1 !== -1);
      it1--, i++
    ) {
      carry += (256 * result[it1]) >>> 0;
      result[it1] = (carry % base) >>> 0;
      carry = (carry / base) >>> 0;
    }
    if (carry !== 0) throw new Error("Non-zero carry");
    length = i;
    pbegin++;
  }

  let it2 = size - length;
  // Skip leading zeroes
  while (it2 !== size && result[it2] === 0) {
    it2++;
  }

  let str = LEADER.repeat(zeroes);
  for (; it2 < size; ++it2) str += alphabet.charAt(result[it2]);
  return str;
}

export function decode(data: string): Uint8Array {
  let psz = 0;
  let zeroes = 0;
  let length = 0;

  while (data[psz] === LEADER) {
    zeroes++;
    psz++;
  }

  const size = (((data.length - psz) * FACTOR) + 1) >>> 0;
  const result = new Uint8Array(size);

  while (data[psz]) {
    // Ideally we would check for errors here, but we're only encoding ascii text, so idrc
    let carry = BASE_MAP[data.charCodeAt(psz)];

    let i = 0;
    for (
      let it3 = size - 1;
      (carry !== 0 || i < length) && (it3 !== -1);
      it3--, i++
    ) {
      carry += (base * result[it3]) >>> 0;
      result[it3] = (carry % 256) >>> 0;
      carry = (carry / 256) >>> 0;
    }
    length = i;
    psz++;
  }

  var it4 = size - length;
  while (it4 !== size && result[it4] === 0) {
    it4++;
  }
  var vch = new Uint8Array(zeroes + (size - it4));
  vch.fill(0x00, 0, zeroes);
  var j = zeroes;
  while (it4 !== size) {
    vch[j++] = result[it4++];
  }
  return vch;
}
