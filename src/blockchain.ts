import { crypto } from "./deps.ts";
import { broadcastLatest, broadCastTransactionPool } from "./peer.ts";
import {
  getCoinbaseTransaction,
  processTransactions,
  Transaction,
  UnspentTxOut,
} from "./transaction.ts";
import {
  addToTransactionPool,
  getTransactionPool,
  updateTransactionPool,
} from "./transactionPool.ts";
import { toHex } from "./utils.ts";
import {
  createTransaction,
  getAddressFromPublic,
  getBalance,
  getPrivateFromWallet,
  getPublicFromWallet,
} from "./wallet.ts";

const createHash = crypto.createHash;

class Block {
  public index: number;
  public hash: string;
  public prevHash: string;
  public timestamp: number;
  public data: Transaction[];

  public difficulty: number;
  // public nonce: number;
  public minterBalance: number;
  public minterAddress: string;

  constructor(
    index: number,
    data: Transaction[],
    prevHash: string,
    difficulty: number,
    minterBalance: number,
    minterAddress: string,
    timestamp: number,
  ) {
    this.index = index;
    this.data = data;
    this.prevHash = prevHash;
    this.timestamp = timestamp;

    this.difficulty = difficulty;
    this.minterBalance = minterBalance;
    this.minterAddress = minterAddress;
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    return calculateHash(
      this.index,
      this.prevHash,
      this.timestamp,
      this.data,
      this.difficulty,
      this.minterBalance,
      this.minterAddress,
    );
  }

  static calculateHash(block: Block): string {
    return calculateHash(
      block.index,
      block.prevHash,
      block.timestamp,
      block.data,
      block.difficulty,
      block.minterBalance,
      block.minterAddress,
    );
  }
}

const calculateHash = (
  index: number,
  prevHash: string,
  timestamp: number,
  data: Transaction[],
  difficulty: number,
  minterBalance: number,
  minterAddress: string,
) => {
  const hash = createHash("sha256");
  hash.update(index.toString());
  hash.update(prevHash);
  hash.update(timestamp.toString());
  hash.update(data.toString());
  hash.update(difficulty.toString());
  hash.update(minterBalance.toString());
  hash.update(minterAddress);

  const digest = hash.digest("hex") as string;

  return digest;
};

const BLOCK_GENERATION_INTERVAL = 10; // in seconds
const DIFFICULT_ADJUSTMENT_INTERVAL = 10; // in blocks
// Number of blocks that can be minted with accounts without any coins
const mintingWithoutCoinIndex = 100;

const getDifficulty = (blockchain: Block[]) => {
  const latestBlock = blockchain[blockchain.length - 1];
  if (
    latestBlock.index % DIFFICULT_ADJUSTMENT_INTERVAL === 0 &&
    latestBlock.index !== 0
  ) {
    return getAdjustedDifficulty(latestBlock, blockchain);
  }
  return latestBlock.difficulty;
};

const getAdjustedDifficulty = (latestBlock: Block, aBlockchain: Block[]) => {
  const prevAdjustmentBlock =
    aBlockchain[blockchain.length - DIFFICULT_ADJUSTMENT_INTERVAL];
  const timeExpected = BLOCK_GENERATION_INTERVAL *
    DIFFICULT_ADJUSTMENT_INTERVAL;
  const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;

  if (timeTaken < timeExpected / 2) {
    return prevAdjustmentBlock.difficulty + 1;
  } else if (timeTaken > timeExpected * 2) {
    return prevAdjustmentBlock.difficulty - 1;
  }
  return prevAdjustmentBlock.difficulty;
};

const getCurrentTimestamp = () => new Date().getTime() / 1000;

const genesisTransaction: Transaction = {
  txIns: [{
    signature: "",
    txOutId: "",
    txOutIndex: 0,
  }],
  txOuts: [{
    address:
      "SNJwxA3bCGK7ivDEA3prjD59MUUv3p58kQov8XanmBeXZH2vFaVC2ZcAs8bzstQ7mB3hFb8w8QjoUaZ5Hj3a3EPa",
    amount: 50,
  }],
  id: "44741c0c7417270c93b937a58aabfe0cef63bfb8a808e22903d688646a729f68",
};

// The initial block in the blockchain
const genesisBlock = new Block(
  0,
  [genesisTransaction],
  "",
  0,
  0,
  "",
  1615056269.589,
);
// TODO: Add persistent blockchain
let blockchain = [genesisBlock];

const getBlockchain = () => blockchain;

const getLatestBlock = (): Block => blockchain[blockchain.length - 1];

let unspentTxOuts = processTransactions(
  blockchain[0].data,
  [],
  0,
) as UnspentTxOut[];

const getUnspentTxOuts = () => [...unspentTxOuts || []];

// and txPool should be only updated at the same time
const setUnspentTxOuts = (newUnspentTxOut: UnspentTxOut[]) => {
  unspentTxOuts = newUnspentTxOut;
};

const generateRawNextBlock = (data: Transaction[]): Block | null => {
  const prevBlock = getLatestBlock();
  const difficulty = getDifficulty(getBlockchain());
  const nextIndex = prevBlock.index + 1;
  const newBlock = findBlock(nextIndex, prevBlock.hash, data, difficulty);

  if (addBlockToChain(newBlock)) {
    broadcastLatest();
    return newBlock;
  } else {
    return null;
  }
};

const generateNextBlock = () => {
  const coinbaseTx: Transaction = getCoinbaseTransaction(
    getAddressFromPublic(getPublicFromWallet()),
    getLatestBlock().index + 1,
  );
  const blockData: Transaction[] = [coinbaseTx].concat(getTransactionPool());
  return generateRawNextBlock(blockData);
};

const addBlockToChain = (block: Block) => {
  if (validateNewBlock(block, getLatestBlock())) {
    const retVal = processTransactions(
      block.data,
      getUnspentTxOuts(),
      block.index,
    );
    if (retVal === null) {
      console.log(`Block isn't valid due to invalid transaction`);
      return false;
    }
    blockchain.push(block);
    setUnspentTxOuts(retVal);
    updateTransactionPool(unspentTxOuts);
    return true;
  }
  console.log(`Invalid block ${JSON.stringify(block)}`);
  return false;
};

const validateNewBlock = (newBlock: Block, prevBlock: Block) => {
  if (prevBlock.index + 1 !== newBlock.index) {
    // TODO: Add better logging
    console.error("Err: Invalid index");
    return false;
  }
  if (prevBlock.hash !== newBlock.prevHash) {
    console.error("Invalid prevHash");
    return false;
  }
  const hash = Block.calculateHash(newBlock);
  if (hash !== newBlock.hash) {
    console.error(`Invalid hash: expected ${hash}, got ${newBlock.hash}`);
    return false;
  }
  return true;
};

const getAccountBalance = (key?: string): number => {
  const pubKey = key || getAddressFromPublic(getPublicFromWallet());
  return getBalance(pubKey, getUnspentTxOuts());
};

const sendTransaction = async (receiver: string, amount: number, privateKey: Uint8Array) => {
  const tx = await createTransaction(
    receiver,
    amount,
    privateKey,
    getUnspentTxOuts(),
    getTransactionPool(),
  );
  addToTransactionPool(tx, getUnspentTxOuts());
  broadCastTransactionPool();
  return tx;
};

// TODO: Switch to a more production-ready tool like Joi
const validateBlockStructure = (block: Block) =>
  typeof block.index === "number" &&
  typeof block.hash === "string" &&
  typeof block.prevHash === "string" &&
  typeof block.timestamp === "number" &&
  typeof block.data === "object";

const validateChain = (blockchain: Block[]): UnspentTxOut[] | null => {
  const validateGenesis = (block: Block) =>
    JSON.stringify(block) === JSON.stringify(genesisBlock);

  if (!validateGenesis(blockchain[0])) {
    return null;
  }

  let unspentTxOuts: UnspentTxOut[] = [];

  for (let i = 0; i < blockchain.length; i++) {
    const block = blockchain[i];
    if (i === 0) continue;

    if (!validateNewBlock(block, blockchain[i - 1])) return null;

    let temp = processTransactions(block.data, unspentTxOuts, block.index);
    if (unspentTxOuts === null) {
      console.log("invalid transactions in blockchain");
      return null;
    } else {
      unspentTxOuts = temp as UnspentTxOut[];
    }
  }
  return unspentTxOuts;
};

const validateTimestamp = (newBlock: Block, prevBlock: Block) => {
  return (prevBlock.timestamp - 60 < newBlock.timestamp) &&
    newBlock.timestamp - 60 < getCurrentTimestamp();
};

const validateBlockStaking = (block: Block) => {
  let difficulty = block.difficulty + 1;
  let balance = block.minterBalance;

  // Allow minting without coins for a few blocks
  if (block.index <= mintingWithoutCoinIndex) {
    balance += 1;
  }
  // SHA256(prevhash + address + timestamp) <= 2^256 * balance / diff
  const balanceOverDifficulty = (2n ** 256n) * BigInt(balance) /
    BigInt(difficulty);

  const stakingHash = createHash("sha256");
  stakingHash.update(block.prevHash);
  stakingHash.update(block.minterAddress);
  stakingHash.update((block.timestamp * 1000).toString());

  const decimalStakingHash = BigInt(
    parseInt(stakingHash.digest("hex") as string, 16),
  );

  const difference = Number(balanceOverDifficulty - decimalStakingHash);

  const stake = decimalStakingHash <= balanceOverDifficulty;
  console.log(stake);
  return stake;
};

const findBlock = (
  index: number,
  prevHash: string,
  data: Transaction[],
  difficulty: number,
) => {
  let pastTimestamp = 0;
  for (;;) {
    let timestamp = getCurrentTimestamp();
    if (pastTimestamp !== timestamp) {
      const block = new Block(
        index,
        data,
        prevHash,
        difficulty,
        getAccountBalance(),
        getAddressFromPublic(getPublicFromWallet()),
        timestamp,
      );
      let hash = block.calculateHash();
      if (validateBlockStaking(block)) {
        block.hash = hash;
        return block;
      }
    }
    pastTimestamp = timestamp;
  }
};

const replaceChain = (newBlocks: Block[]) => {
  const aUnspentTxOuts = validateChain(newBlocks);
  const validChain = aUnspentTxOuts !== null;
  if (
    validChain &&
    getAccumulatedDifficulty(newBlocks) >
      getAccumulatedDifficulty(getBlockchain())
  ) {
    console.log(
      "Received blockchain is valid. Replacing current blockchain with received blockchain",
    );
    blockchain = newBlocks;
    setUnspentTxOuts(aUnspentTxOuts as UnspentTxOut[]);
    updateTransactionPool(unspentTxOuts);
    broadcastLatest();
  } else {
    console.log("Received blockchain invalid");
  }
};

const getAccumulatedDifficulty = (aBlockchain: Block[]): number => {
  return aBlockchain
    .map((block) => block.difficulty)
    .map((difficulty) => Math.pow(2, difficulty))
    .reduce((a, b) => a + b);
};

const handleReceivedTransaction = (transaction: Transaction) => {
  addToTransactionPool(transaction, getUnspentTxOuts());
};

export {
  addBlockToChain,
  Block,
  generateNextBlock,
  generateRawNextBlock,
  getAccountBalance,
  getBlockchain,
  getLatestBlock,
  getUnspentTxOuts,
  handleReceivedTransaction,
  replaceChain,
  sendTransaction,
  validateBlockStructure,
};
