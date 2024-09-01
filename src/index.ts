/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
// Imports
// =================================
import { Redis } from '@upstash/redis/cloudflare';
import { Receiver } from '@upstash/qstash';
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Types
// =================================
export interface Env {
  TELEGRAM_API_TOKEN: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  CLOUDFLARE_WORKER_QUEUE_URL: string;
  QSTASH_CURRENT_SIGNING_KEY: string;
  QSTASH_NEXT_SIGNING_KEY: string;
}

// Constants
// =================================
/**
 * @dev Standard messages
 */
const MESSAGES = {
  DEFAULT: {
    SUCCESS: {
      text: 'OK.',
      status: 200,
    },
    ERROR: {
      text: 'Unknown error occurred.',
      status: 500,
    },
  },
};

/**
 * @dev Regex validation patterns
 */
const VALIDATION = {
  token: /^(\$[a-zA-Z]{1,})/, // starts with '$' and is followed by 3+ letters
  number: /^(0(\.0*[1-9]\d{0,17})?|[1-9]\d*(\.\d{1,18})?)$/, // a number that is greater than 0
  address: /^0x[a-fA-F0-9]{40}$/, // evm wallet/token address
};

// Main Worker
// =================================
/**
 * Main worker handler
 * @dev Queue function that handles processing rpc transactions
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    // 1 - Retrieve the request body
    const body = await request.text();
    const json: { [key: string]: any } = body ? JSON.parse(body) : {};

    // 2 - Validation - Upstash Signature
    const receiver = new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    });

    try {
      await receiver.verify({
        signature: request.headers.get('Upstash-Signature')!,
        body,
      });

      // 3 - Validation - Payload
      const isValidAddress = VALIDATION?.address.test(json.address);
      const isValidToken = VALIDATION?.token.test(json.token);
      const isValidAmount = VALIDATION?.number.test(`${json.amount}`); // Note: Amount needs to be converted into a string

      if (!isValidAddress || !isValidToken || !isValidAmount) {
        throw new Error('Invalid payload request.');
      }

      // 4 - Validation - RPC
      const redis = Redis.fromEnv({
        UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
      });
      const rpc: { [key: string]: any } | null | undefined = await redis.get('rpc');
      if (
        !rpc ||
        typeof rpc !== 'object' ||
        Object.keys(rpc).length !== 7 ||
        !rpc?.chainId ||
        !rpc?.chainName ||
        !rpc?.decimals ||
        !rpc?.token ||
        !rpc?.rpcUrl ||
        !rpc?.blockExplorerUrl ||
        !rpc.privateKey
      ) {
        throw new Error('RPC not configured or found.');
      }

      // 5 - Validation - Token
      const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
      const token = existingTokens?.[json.token.toLowerCase()];
      const isGasToken = rpc.token.toLowerCase() === json.token.toLowerCase();
      if (!isGasToken && (!token || !token.address || !token.decimals)) {
        throw new Error('Invalid token.');
      }

      // 6 - RPC Configuration
      const chain = defineChain({
        id: parseInt(rpc.chainId, 0),
        name: rpc.chainName,
        nativeCurrency: {
          decimals: parseInt(rpc.decimals, 0),
          name: rpc.token,
          symbol: rpc.token,
        },
        rpcUrls: {
          default: {
            http: [rpc.rpcUrl],
          },
        },
        blockExplorers: {
          default: { name: rpc.chainName, url: rpc.blockExplorerUrl },
        },
      });
      const publicClient = createPublicClient({ chain, transport: http() });
      const walletClient = createWalletClient({
        chain,
        transport: http(),
      });

      // 7 - RPC Transaction
      const txHash = isGasToken
        ? await walletClient.sendTransaction({
            account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
            to: `${json.address}` as `0x${string}`,
            value: BigInt(parseFloat(json.amount) * 10 ** parseInt(rpc.decimals, 0)),
          })
        : await walletClient.writeContract({
            account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
            address: `${token.address}` as `0x${string}`,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [`${json.address}` as `0x${string}`, BigInt(parseFloat(json.amount) * 10 ** parseInt(token.decimals, 0))],
          });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // 8 - Return the transaction hash
      const txHashUrl = `${rpc.blockExplorerUrl}/tx/${txHash}`;
      console.log('Transaction Hash:', txHashUrl);
      return new Response(txHashUrl, { status: MESSAGES.DEFAULT.SUCCESS.status });
    } catch (error: any) {
      // Return a success response to avoid retries
      return new Response(error?.message ?? MESSAGES.DEFAULT.ERROR.text, { status: MESSAGES.DEFAULT.SUCCESS.status });
    }
  },
} satisfies ExportedHandler<Env>;
