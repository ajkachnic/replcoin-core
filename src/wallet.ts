import { crypto, path, secp } from "./deps.ts";

import {
  getTransactionId,
  signTxIn,
  Transaction,
  TxIn,
  TxOut,
  UnspentTxOut,
} from "./transaction.ts";
import { fromHex, toHex } from "./utils.ts";
import * as base58 from "./base58.ts";

interface Wallet {
  private: Uint8Array;
  public: Uint8Array;
}

const baseWalletLocation = "node/wallet/";
let currentWalletName = "default";

const getWalletPath = () =>
  path.join(baseWalletLocation, currentWalletName + ".dat");

const VERSION = "00";
const CHECKSUM_LEN = 2;

const generatePrivatekey = () => {
  const key = crypto.randomBytes(32);
  return key;
};

const exists = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

const encodeWallet = (wallet: Wallet): Uint8Array => {
  const modifiedWallet = {
    private: toHex(wallet.private),
    public: toHex(wallet.public),
  };
  const str = JSON.stringify(modifiedWallet);
  const encoder = new TextEncoder();

  return encoder.encode(str);
};
const decodeWallet = (bin: Uint8Array): Wallet => {
  const decoder = new TextDecoder();
  const str = decoder.decode(bin);

  const wallet: any = JSON.parse(str);

  const encoder = new TextEncoder();

  // Validate structure
  if (!wallet.private) {
    throw new Error("Wallet missing private key");
  }
  if (!wallet.public) {
    throw new Error("Wallet missing public key");
  }

  wallet.private = fromHex(wallet.private);
  wallet.public = fromHex(wallet.public);

  return wallet as Wallet;
};

const initWallet = (name?: string) => {
  currentWalletName = name || "default";
  console.log(getWalletPath());
  const fileExists = exists(getWalletPath());
  if (fileExists) {
    return;
  }

  const privateKey = generatePrivatekey();
  const publicKey = secp.getPublicKey(privateKey);

  const wallet: Wallet = {
    private: privateKey,
    public: publicKey,
  };

  Deno.writeFileSync(getWalletPath(), encodeWallet(wallet));
};

const getWallet = () => {
  const bin = Deno.readFileSync(getWalletPath());

  const wallet = decodeWallet(bin);

  return wallet;
};

const getPublicFromWallet = () => {
  const wallet = getWallet();

  return wallet.public;
};

const getPrivateFromWallet = () => {
  const wallet = getWallet();

  return wallet.private;
};

const hashPublicKey = (pubKey: string): string => {
  const sha = crypto.createHash("sha256");
  sha.update(pubKey);

  const ripemd = crypto.createHash("ripemd160");

  ripemd.update(sha.digest("hex"));

  return ripemd.digest("hex") as string;
};

const checksum = (payload: string): string => {
  const first = crypto.createHash("sha256");
  first.update(payload);
  const second = crypto.createHash("sha256");
  second.update(first.digest("hex"));

  return second.digest("hex").slice(0, CHECKSUM_LEN) as string;
};

// Proper addresses are put on hold until I figure out how to handle verifying transaction without a public key
const getAddressFromPublic = (pubKey: Uint8Array): string => {
  // const hashedKey = hashPublicKey(pubKey)

  // const versionedPayload = hashedKey + VERSION
  // const check = checksum(versionedPayload)

  // return base58.encode(versionedPayload + check)
  return base58.encode(pubKey);
};

const getBalance = (address: string, unspentTxOuts: UnspentTxOut[]) => {
  return unspentTxOuts.filter((uTxO) => uTxO.address === address)
    .map((uTxO) => uTxO.amount)
    .reduce((a, b) => a + b, 0);
};

const findTxOutsForAmount = (
  amount: number,
  myUnspentTxOuts: UnspentTxOut[],
) => {
  let currentAmount = 0;
  const includedUnspentTxOuts = [];
  for (const myUnspentTxOut of myUnspentTxOuts) {
    includedUnspentTxOuts.push(myUnspentTxOut);
    currentAmount = currentAmount + myUnspentTxOut.amount;
    if (currentAmount >= amount) {
      console.log(`current:${currentAmount}`);
      const leftOverAmount = currentAmount - amount;
      return { includedUnspentTxOuts, leftOverAmount };
    }
  }
  throw Error("not enough coins to send transaction");
};

const filterTxPoolTxs = (
  unspentTxOuts: UnspentTxOut[],
  transactionPool: Transaction[],
): UnspentTxOut[] => {
  const txIns: TxIn[] = transactionPool
    .map((tx: Transaction) => tx.txIns)
    .reduce((a, b) => [...a, ...b], []);
  const removable: UnspentTxOut[] = [];
  for (const unspentTxOut of unspentTxOuts) {
    const txIn = txIns.find((aTxIn: TxIn) => {
      return aTxIn.txOutIndex === unspentTxOut.txOutIndex &&
        aTxIn.txOutId === unspentTxOut.txOutId;
    });

    if (txIn === undefined) {
    } else {
      removable.push(unspentTxOut);
    }
  }

  return unspentTxOuts.filter((a) => !removable.includes(a));
};

const createTxOuts = (
  receiver: string,
  myAddress: string,
  amount: number,
  leftOverAmount: number,
) => {
  const txOut: TxOut = {
    address: receiver,
    amount,
  };

  if (leftOverAmount === 0) return [txOut];
  const leftOverTx: TxOut = {
    address: myAddress,
    amount: leftOverAmount,
  };

  return [txOut, leftOverTx];
};

const createTransaction = async (
  receiver: string,
  amount: number,
  privateKey: Uint8Array,
  unspentTxOuts: UnspentTxOut[],
  txPool: Transaction[],
) => {
  const publicKey = secp.getPublicKey(privateKey);
  const myAddress = getAddressFromPublic(publicKey);
  const myUnspentTxOutsA = unspentTxOuts.filter((uTxO: UnspentTxOut) =>
    uTxO.address === myAddress
  );

  const myUnspentTxOuts = filterTxPoolTxs(myUnspentTxOutsA, txPool);
  console.log(`Unspent Tx outs: ${myUnspentTxOuts}`);

  const { includedUnspentTxOuts, leftOverAmount } = findTxOutsForAmount(
    amount,
    myUnspentTxOuts,
  );

  const toUnsignedTxIn = (unspentTxOut: UnspentTxOut) => {
    const txIn: TxIn = {
      txOutId: unspentTxOut.txOutId,
      txOutIndex: unspentTxOut.txOutIndex,
      signature: "",
    };
    return txIn;
  };

  const unsignedTxIns = includedUnspentTxOuts.map(toUnsignedTxIn);

  const tx: Transaction = {
    txIns: unsignedTxIns,
    txOuts: createTxOuts(receiver, myAddress, amount, leftOverAmount),
    id: "",
  };

  tx.id = getTransactionId(tx);

  // TODO: Tidy this up
  tx.txIns = await Promise.all(tx.txIns.map(async (txIn, index) => {
    txIn.signature = await signTxIn(tx, index, privateKey, unspentTxOuts);
    return txIn;
  }));

  return tx;
};

export {
  createTransaction,
  getAddressFromPublic,
  getBalance,
  getPrivateFromWallet,
  getPublicFromWallet,
  initWallet,
};
