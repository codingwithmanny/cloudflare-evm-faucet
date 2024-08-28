// Imports
// =================================
import { Redis } from '@upstash/redis/cloudflare';
import { config } from 'dotenv';
import { createPublicClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Config
// =================================
config({
  path: './.dev.vars',
});

/**
 * @dev Regex validation patterns
 */
const VALIDATION = {
  name: /^[a-zA-Z][a-zA-Z0-9]*$/,
  token: /^(\$[a-zA-Z]{4,5})/, // starts with '$' and is followed by 4-5 letters
  number: /^(0(\.0*[1-9]\d{0,17})?|[1-9]\d*(\.\d{1,18})?)$/, // a number that is greater than 0
  address: /^0x[a-fA-F0-9]{40}$/, // evm wallet private key
  url: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
};

/**
 * @dev Redis key for rpc values
 */
const REDIS_RPC_KEY = 'rpc';

// Main Script
// =================================
const main = async () => {
  // 1 - Validation - Environment variables
  const isChainIdValid = VALIDATION.number.test(`${process.env.RPC_CHAIN_ID}`);
  const isChainNameValid = VALIDATION.name.test(`${process.env.RPC_CHAIN_NAME}`);
  const isRpcUrlValid = VALIDATION.url.test(`${process.env.RPC_URL}`);
  const isTokenSymbolValid = VALIDATION.token.test(`${process.env.RPC_TOKEN_SYMBOL}`);
  const isTokenDecimalsValid = VALIDATION.number.test(`${process.env.RPC_TOKEN_DECIMALS}`);
  const isBlockExplorerUrlValid = VALIDATION.url.test(`${process.env.RPC_BLOCKEXPLORER_URL}`);
  const isWalletPrivateKeyValid = VALIDATION.address.test(
    privateKeyToAccount(`${process.env.WALLET_PRIVATE_KEY}` as `0x${string}`).address,
  );

  if (
    !isChainIdValid ||
    !isChainNameValid ||
    !isRpcUrlValid ||
    !isTokenSymbolValid ||
    !isTokenDecimalsValid ||
    !isBlockExplorerUrlValid ||
    !isWalletPrivateKeyValid
  ) {
    throw new Error('Invalid environment variables.');
  }

  // 2 - Validation - RPC
  const publicClient = createPublicClient({
    chain: defineChain({
      id: parseInt(`${process.env.RPC_CHAIN_ID}`, 0),
      name: `${process.env.RPC_CHAIN_NAME}`,
      nativeCurrency: {
        decimals: parseInt(`${process.env.RPC_TOKEN_DECIMALS}`, 0),
        name: `${process.env.RPC_TOKEN_SYMBOL}`,
        symbol: `${process.env.RPC_TOKEN_SYMBOL}`,
      },
      rpcUrls: {
        default: {
          http: [`${process.env.RPC_URL}`],
        },
      },
      blockExplorers: {
        default: { name: `${process.env.RPC_CHAIN_NAME}`, url: `${process.env.RPC_BLOCKEXPLORER_URL}` },
      },
    }),
    transport: http(),
  });
  const chainId = await publicClient.getChainId();
  if (chainId !== parseInt(`${process.env.RPC_CHAIN_ID}`, 0)) {
    throw Error('Invalid RPC settings.');
  }

  // 3 - Redis - Set RPC Values
  const redis = Redis.fromEnv({
    UPSTASH_REDIS_REST_URL: `${process.env.UPSTASH_REDIS_REST_URL}`,
    UPSTASH_REDIS_REST_TOKEN: `${process.env.UPSTASH_REDIS_REST_TOKEN}`,
  });
  await redis.set(
    REDIS_RPC_KEY,
    `${JSON.stringify({
      chainId: parseInt(`${process.env.RPC_CHAIN_ID}`, 0),
      chainName: `${process.env.RPC_CHAIN_NAME}`,
      rpcUrl: `${process.env.RPC_URL}`,
      token: `${process.env.RPC_TOKEN_SYMBOL}`,
      decimals: parseInt(`${process.env.RPC_TOKEN_DECIMALS}`, 0),
      blockExplorerUrl: `${process.env.RPC_BLOCKEXPLORER_URL}`,
      privateKey: `${process.env.WALLET_PRIVATE_KEY}`,
    })}`,
  );

  // 4 - Redis - Confirm Get RPC Values
  const rpc: { [key: string]: any } | null | undefined = await redis.get(REDIS_RPC_KEY);
  console.log({
    chainId: rpc?.chainId,
    chainName: rpc?.chainName,
    rpcUrl: rpc?.rpcUrl,
    token: rpc?.token,
    decimals: rpc?.decimals,
    blockExplorerUrl: rpc?.blockExplorerUrl,
    walletAddress: privateKeyToAccount(rpc?.privateKey as `0x${string}`).address,
  });
};

// Init
// =================================
main()
  .then(() => console.log('Done!'))
  .catch((error) => console.error(error));
