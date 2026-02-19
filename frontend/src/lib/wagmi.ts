import { http, createConfig } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "@wagmi/connectors";

const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(rpcUrl),
  },
  ssr: true,
});
