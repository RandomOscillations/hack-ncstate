import { Connection } from "@solana/web3.js";

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}
