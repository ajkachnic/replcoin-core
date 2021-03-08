import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  WebSocket as WS,
  WebSocketEvent,
} from "https://deno.land/std@0.89.0/ws/mod.ts";
import { serve } from "https://deno.land/std@0.89.0/http/server.ts";
import {
  addBlockToChain,
  Block,
  getBlockchain,
  getLatestBlock,
  handleReceivedTransaction,
  replaceChain,
  validateBlockStructure,
} from "./blockchain.ts";
import { getTransactionPool } from "./transactionPool.ts";
import { Transaction } from "./transaction.ts";

let clients: WS[] = [];
let servers: WebSocket[] = [];

const getURLFromWS = (ws: WS | WebSocket) => {
  if (ws instanceof WebSocket) {
    return ws.url;
  }
  const addr = ws.conn.remoteAddr as Deno.NetAddr;
  // TODO: Remove this or make less assumptions
  return `ws://${addr.hostname}:6001`;
};

const getSockets = () => {
  return [
    ...clients.map(getURLFromWS),
    ...servers.map(getURLFromWS),
  ];
};

interface Message {
  data: any;
  type: MessageType;
}
enum MessageType {
  QUERY_LATEST = 0,
  QUERY_ALL = 1,
  RESPONSE_BLOCKCHAIN = 2,
  QUERY_TRANSACTION_POOL = 3,
  RESPONSE_TRANSACTION_POOL = 4,
}

const handleServerWs = async (sock: WS) => {
  try {
    for await (const ev of sock) {
      let res = handleServerEvent(sock, ev);
      if (res) {
        return;
      }
    }
  } catch {}
};

const handleServerEvent = (sock: WS, ev: WebSocketEvent): true | void => {
  if (typeof ev === "string") {
    handleMessage(sock, ev);
  } else if (isWebSocketCloseEvent(ev)) {
    clients = clients.filter((ws) => ws !== sock);
    return true;
  }
};

const handleClientWs = async (sock: WebSocket) => {
  sock.addEventListener("message", (msg) => {
    if (typeof msg.data === "string") {
      handleMessage(sock, msg.data);
    }
  });
};

const initConnection = (ws: WS | WebSocket) => {
  if (ws instanceof WebSocket) {
    servers.push(ws);
    handleClientWs(ws);
  } else {
    clients.push(ws);
    handleServerWs(ws);
  }
  write(ws, queryChainLengthMsg());
};

const handleMessage = (sock: WS | WebSocket, data: string) => {
  const message = JSONToObject<Message>(data);
  if (message === null) {
    console.error(`Could not parse received JSON: ${data}`);
    return;
  }

  switch (message.type) {
    case MessageType.QUERY_LATEST:
      write(sock, responseLatestMsg());
      break;
    case MessageType.QUERY_ALL:
      write(sock, responseChainMsg());
      break;
    case MessageType.RESPONSE_BLOCKCHAIN:
      const receivedBlocks = JSONToObject<Block[]>(message.data);
      if (receivedBlocks === null) {
        console.log("invalid blocks received:");
        console.log(message.data);
        break;
      }
      handleBlockchainResponse(receivedBlocks);
      break;
    case MessageType.QUERY_TRANSACTION_POOL:
      write(sock, responseTransactionPoolMsg());
      break;
    case MessageType.RESPONSE_TRANSACTION_POOL:
      const receivedTransactions = JSONToObject<Transaction[]>(message.data);
      if (receivedTransactions == null) {
        console.log(`Invalid transaction: ${JSON.stringify(message.data)}`);
        break;
      }
      receivedTransactions.forEach((transaction) => {
        try {
          handleReceivedTransaction(transaction);
          broadCastTransactionPool();
        } catch (e) {
          console.error(e.message);
        }
      });
  }
};

const startPeerServer = async (port: string) => {
  console.log(`Starting peer server on ${port}`);
  for await (const req of serve(port)) {
    const { conn, r: bufReader, w: bufWriter, headers } = req;
    acceptWebSocket({
      conn,
      bufReader,
      bufWriter,
      headers,
    }).then(initConnection)
      .catch(async (err) => {
        console.error(`failed to accept websocket: ${err}`);
        await req.respond({ status: 400 });
      });
  }
};

const JSONToObject = <T>(data: string): T | null => {
  try {
    return JSON.parse(data);
  } catch (e) {
    console.log(e);
    return null;
  }
};

const write = async (ws: WS | WebSocket, message: Message) => {
  try {
    await ws.send(JSON.stringify(message));
  } catch(err) {
    console.error(err)
  }
};
const broadcast = async (message: Message) =>
  await Promise.all(clients.map((socket) => write(socket, message)));
const queryChainLengthMsg = (): Message => ({
  type: MessageType.QUERY_LATEST,
  data: null,
});

const queryAllMsg = (): Message => ({
  "type": MessageType.QUERY_ALL,
  "data": null,
});

const responseChainMsg = (): Message => ({
  "type": MessageType.RESPONSE_BLOCKCHAIN,
  "data": JSON.stringify(getBlockchain()),
});

const responseLatestMsg = (): Message => ({
  "type": MessageType.RESPONSE_BLOCKCHAIN,
  "data": JSON.stringify([getLatestBlock()]),
});

const responseTransactionPoolMsg = (): Message => ({
  "type": MessageType.RESPONSE_TRANSACTION_POOL,
  "data": JSON.stringify(getTransactionPool()),
});

const queryTransactionPoolMsg = (): Message => ({
  "type": MessageType.QUERY_TRANSACTION_POOL,
  "data": null,
});

const handleBlockchainResponse = (receivedBlocks: Block[]) => {
  if (receivedBlocks.length === 0) {
    console.log("received block chain size of 0");
    return;
  }
  const latestBlockReceived: Block = receivedBlocks[receivedBlocks.length - 1];
  if (!validateBlockStructure(latestBlockReceived)) {
    console.log("Invalid block structure");
    return;
  }
  const latestBlockHeld: Block = getLatestBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log(
      `blockchain possibly behind. We got: ${latestBlockHeld.index} Peer got: ${latestBlockReceived.index}`,
    );
    if (latestBlockHeld.hash === latestBlockReceived.prevHash) {
      if (addBlockToChain(latestBlockReceived)) {
        broadcast(responseLatestMsg());
      }
    } else if (receivedBlocks.length === 1) {
      console.log("We have to query the chain from our peer");
      broadcast(queryAllMsg());
    } else {
      console.log("Received blockchain is longer than current blockchain");
      replaceChain(receivedBlocks);
    }
  } else {
    console.log(
      "received blockchain is not longer than received blockchain. Do nothing",
    );
  }
};

const broadcastLatest = (): void => {
  broadcast(responseLatestMsg());
};

const broadCastTransactionPool = () => {
  broadcast(responseTransactionPoolMsg());
};

const connectToPeers = (newPeer: string) => {
  console.log(`Opened socket with ${newPeer}`);
  try {
    const ws = new WebSocket(newPeer);
    ws.addEventListener("open", () => {
      initConnection(ws);
    });
    ws.addEventListener("error", () => {
      console.log("connection failed");
    });
  } catch (err) {
    console.error(err);
  }
};

export {
  broadcastLatest,
  broadCastTransactionPool,
  connectToPeers,
  getSockets,
  startPeerServer,
};
