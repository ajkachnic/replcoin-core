import {
  Transaction,
  TxIn,
  UnspentTxOut,
  validateTransaction,
} from "./transaction.ts";

let transactionPool: Transaction[] = [];

const getTransactionPool = () => [...transactionPool];

const addToTransactionPool = (
  tx: Transaction,
  unspentTxOuts: UnspentTxOut[],
) => {
  if (!validateTransaction(tx, unspentTxOuts)) {
    throw new Error("Trying to add invalid tx to pool");
  }

  if (!validateTxForPool(tx, transactionPool)) {
    throw new Error("Trying to add invalid tx to pool");
  }

  console.log(`adding to txPool: ${JSON.stringify(tx)}`);
  transactionPool.push(tx);
};

const updateTransactionPool = (unspentTxOuts: UnspentTxOut[]) => {
  const invalidTxs: Transaction[] = [];
  for (const tx of transactionPool) {
    for (const txIn of tx.txIns) {
      if (!hasTxIn(txIn, unspentTxOuts)) {
        invalidTxs.push(tx);
        break;
      }
    }
  }
  if (invalidTxs.length > 0) {
    console.log(
      "removing the following transactions from txPool: %s",
      JSON.stringify(invalidTxs),
    );
    transactionPool = transactionPool.filter((tx) => !invalidTxs.includes(tx));
  }
};

const hasTxIn = (txIn: TxIn, unspentTxOuts: UnspentTxOut[]) => {
  return unspentTxOuts.some((uTxO) => {
    return uTxO.txOutId === txIn.txOutId && uTxO.txOutIndex === txIn.txOutIndex;
  });
};

const getTxPoolIns = (aTransactionPool: Transaction[]): TxIn[] => {
  return aTransactionPool
    .map((tx) => tx.txIns)
    .reduce((a, b) => [...a, ...b], []);
};

const validateTxForPool = (
  tx: Transaction,
  aTtransactionPool: Transaction[],
): boolean => {
  const txPoolIns: TxIn[] = getTxPoolIns(aTtransactionPool);

  const containsTxIn = (txIns: TxIn[], txIn: TxIn) => {
    return txPoolIns.find(
      ((txPoolIn) => {
        return txIn.txOutIndex === txPoolIn.txOutIndex &&
          txIn.txOutId === txPoolIn.txOutId;
      }),
    );
  };

  for (const txIn of tx.txIns) {
    if (containsTxIn(txPoolIns, txIn)) {
      console.log("txIn already found in the txPool");
      return false;
    }
  }
  return true;
};

export { transactionPool };

export { addToTransactionPool, getTransactionPool, updateTransactionPool };
