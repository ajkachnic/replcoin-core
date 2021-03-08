import {
  decodeString,
  encodeToString,
} from "https://deno.land/std@0.89.0/encoding/hex.ts";

export const toHex = (src: Uint8Array) => encodeToString(src);

export const fromHex = (src: string) => decodeString(src);
