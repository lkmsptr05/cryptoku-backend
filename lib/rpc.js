// 1. Tambahkan 'export' di sini vvv
export const RPC_LIST = {
  ethereum: {
    name: "Ethereum Mainnet",
    chainId: 1,
    symbol: "ETH",
    rpc: "https://eth.llamarpc.com", // Alternatif: https://rpc.ankr.com/eth
    explorer: "https://etherscan.io"
  },
  bsc: {
    name: "BNB Smart Chain",
    chainId: 56,
    symbol: "BNB",
    rpc: "https://bsc-dataseed.binance.org", // Official Binance
    explorer: "https://bscscan.com"
  },
  polygon: {
    name: "Polygon POS",
    chainId: 137,
    symbol: "POL", // Rebranding dari MATIC
    rpc: "https://polygon-rpc.com", // Aggregator (Otomatis cari node sehat)
    explorer: "https://polygonscan.com"
  },
  avalanche: {
    name: "Avalanche C-Chain",
    chainId: 43114,
    symbol: "AVAX",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io"
  },
  fantom: {
    name: "Fantom Opera",
    chainId: 250,
    symbol: "FTM",
    rpc: "https://rpc.ftm.tools",
    explorer: "https://ftmscan.com"
  },

  // === EVM LAYER 2 (ETH SCALING) ===
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    symbol: "ETH",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io"
  },
  optimism: {
    name: "Optimism (OP Mainnet)",
    chainId: 10,
    symbol: "ETH",
    rpc: "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io"
  },
  base: {
    name: "Base",
    chainId: 8453,
    symbol: "ETH",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org"
  },
  zksync: {
    name: "zkSync Era",
    chainId: 324,
    symbol: "ETH",
    rpc: "https://mainnet.era.zksync.io",
    explorer: "https://explorer.zksync.io"
  },
  linea: {
    name: "Linea",
    chainId: 59144,
    symbol: "ETH",
    rpc: "https://rpc.linea.build",
    explorer: "https://lineascan.build"
  },
  scroll: {
    name: "Scroll",
    chainId: 534352,
    symbol: "ETH",
    rpc: "https://rpc.scroll.io",
    explorer: "https://scrollscan.com"
  },
  blast: {
    name: "Blast",
    chainId: 81457,
    symbol: "ETH",
    rpc: "https://rpc.blast.io",
    explorer: "https://blastscan.io"
  },

  // === NON-EVM ===
  solana: {
    name: "Solana",
    chainId: null, // Solana tidak pakai Chain ID standar EVM
    symbol: "SOL",
    rpc: "https://api.mainnet-beta.solana.com", // Hati-hati rate limit ketat
    explorer: "https://solscan.io"
  }
};

// 2. HAPUS BARIS INI (Dihapus atau dikomentari saja)
// module.exports = {RPC_LIST}; <--- HAPUS