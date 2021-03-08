import {
  Block,
  generateNextBlock,
  generateRawNextBlock,
  getAccountBalance,
  getBlockchain,
  getUnspentTxOuts,
  sendTransaction,
} from "./blockchain.ts";
import { getTransactionPool } from "./transactionPool.ts";
import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { connectToPeers, getSockets, startPeerServer } from "./peer.ts";
import {
  getAddressFromPublic,
  getPublicFromWallet,
  initWallet,
} from "./wallet.ts";
import { flags, oakCors } from "./deps.ts";
import { fromHex } from "./utils.ts";

const app = new Application();
const router = new Router();

const args = flags.parse(Deno.args);

console.log(args);

const walletName = args.wallet;

// The initial node you want to connect to
// If you don't want to auto-connect to any nodes, leave this as false
const MAIN_NODE: string | false = "ws://localhost:6001";

const HTTP_PORT = parseInt(args["http-port"]) || 3001;
const PEER_PORT = parseInt(args["peer-port"]) || 6001;

router.get("/blocks", (ctx) => {
  ctx.response.body = getBlockchain();
});

router.get("/transaction-pool", (ctx) => {
  ctx.response.body = getTransactionPool();
});

router.get("/transaction/:id", (ctx) => {
  const id = ctx.params.id;

  const tx = getBlockchain()
    .map((block) => block.data)
    .reduce((a, b) => [...a, ...b], [])
    .find((tx) => tx.id === id);

  ctx.response.body = tx;
});

router.get("/address/:address", (ctx) => {
  const { address } = ctx.params;

  const unspentTxOuts = getUnspentTxOuts().filter((x) => x.address === address);

  ctx.response.body = unspentTxOuts;
});

router.get("/balance/:wallet", (ctx) => {
  const { wallet } = ctx.params;

  ctx.response.body = getAccountBalance(wallet);
});

router.post("/mint-block", async (ctx) => {
  console.log(`Minting new block`);
  const newBlock = generateNextBlock();

  ctx.response.body = newBlock;
});

router.post("/mint-raw-block", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const newBlock = generateRawNextBlock(body.data);

  ctx.response.body = newBlock;
});

router.post("/send-transaction", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  try {
    const address = body.address;
    const amount = body.amount;
    const privateKey = fromHex(body.privateKey);

    if (address === undefined || amount === undefined || privateKey === undefined) {
      throw new Error("invalid address, amount, or private key");
    }

    const resp = await sendTransaction(address, amount, privateKey);
    ctx.response.body = resp;
  } catch (e) {
    console.error(e);
    ctx.response.status = 400;
    ctx.response.body = e;
  }
});

// P2P stuff
router.get("/peers", (ctx) => {
  ctx.response.body = getSockets();
});
router.post("/add-peer", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  connectToPeers(body.peer);
  ctx.response.status = 200;
});

app.use(oakCors());
app.use(router.routes());
app.use(router.allowedMethods());

initWallet(walletName);

const pub = getPublicFromWallet();
const address = getAddressFromPublic(pub);

console.log(`Address: ${address}`);

if (MAIN_NODE) {
  connectToPeers(MAIN_NODE);
}

Promise.all([
  app.listen({ port: HTTP_PORT }).catch((err) => console.error(err)),
  startPeerServer(`:${PEER_PORT}`),
]);
