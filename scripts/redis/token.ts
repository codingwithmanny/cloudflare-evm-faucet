// Imports
// =================================
import { Redis } from '@upstash/redis/cloudflare';
import { config } from 'dotenv';
import { createPublicClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Config
// =================================
config({
  path: "./.dev.vars"
});

/**
 * @dev Regex validation patterns
 */
const VALIDATION = {
  name: /^[a-zA-Z][a-zA-Z0-9]*$/,
	token: /^(\$[a-zA-Z]{4,5})/, // starts with '$' and is followed by 4-5 letters
	number: /^(0(\.0*[1-9]\d{0,17})?|[1-9]\d*(\.\d{1,18})?)$/, // a number that is greater than 0
	address: /^0x[a-fA-F0-9]{40}$/, // evm wallet private key
  url: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/
};

/**
 * @dev Redis key for rpc values
 */
const REDIS_RPC_KEY = 'rpc';

/**
 * @dev Redis key for token values
 */
const REDIS_TOKENS_KEY = 'tokens';

// Main Script
// =================================
const main = async () => {
  // 1 - Validation - Validate flags
  const [token, address, decimals] = process.argv.slice(4);
  const tokenSymbol = `$${token.replace('$', '').toLowerCase()}`;
  const isTokenValid = VALIDATION.token.test(tokenSymbol);
  const isAddressValid = VALIDATION.address.test(address);
  const isDecimalsValid = VALIDATION.number.test(`${decimals}`) && parseInt(`${decimals}`, 0) <= 18;
  if (!isTokenValid || !isAddressValid || !isDecimalsValid) {
    throw new Error('Invalid arguments.');
  }

  // 2 - Validation - Check if RPC values set
  const redis = Redis.fromEnv({
    UPSTASH_REDIS_REST_URL: `${process.env.UPSTASH_REDIS_REST_URL}`,
    UPSTASH_REDIS_REST_TOKEN: `${process.env.UPSTASH_REDIS_REST_TOKEN}`,
  });
  const rpc: { [key: string]: any } | null | undefined = await redis.get(REDIS_RPC_KEY);
  const publicClient = createPublicClient({
    chain: defineChain({
      id: parseInt(rpc?.chainId, 0),
      name: rpc?.chainName,
      nativeCurrency: {
        decimals: parseInt(rpc?.decimals, 0),
        name: rpc?.token,
        symbol: rpc?.token,
      },
      rpcUrls: {
        default: {
          http: [rpc?.rpcUrl],
        },
      },
      blockExplorers: {
        default: { name: rpc?.chainName, url: rpc?.blockExplorerUrl },
      },
    }),
    transport: http(),
  });
  const chainId = await publicClient.getChainId();
  if (chainId !== parseInt(`${process.env.RPC_CHAIN_ID}`, 0)) {
    throw Error('Invalid RPC settings.');
  }

  // 2 - Validation - Not native token
  const isNativeToken = tokenSymbol === rpc?.token.toLowerCase();
  if (isNativeToken) {
    throw new Error('Cannot set the same name as the native gas token.');
  }

  // 3 - Redis - Set Token Values
  const existingTokens: { [key: string]: any } = (await redis.get(REDIS_TOKENS_KEY)) || {};
  await redis.set('tokens', {
    ...existingTokens, [tokenSymbol]: {
      address,
      decimals
    }
  });

  // 4 - Redis - Confirm Get Token Values
  const tokens = await redis.get(REDIS_TOKENS_KEY);
  console.log({ tokens });
};

// Init
// =================================
main()
  .then(() => console.log('Done!'))
  .catch((error) => console.error(error));