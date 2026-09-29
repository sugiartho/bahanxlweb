export interface Env {
  ENVIRONMENT: string;
  // Secrets (wrangler secret put)
  BASE_API_URL?: string;
  BASE_CIAM_URL?: string;
  BASIC_AUTH?: string;
  UA?: string;
  API_KEY?: string;
  AES_KEY_ASCII?: string;
  AX_FP_KEY?: string;
  AX_FP?: string;
  ENCRYPTED_FIELD_KEY?: string;
  XDATA_KEY?: string;
  AX_API_SIG_KEY?: string;
  X_API_BASE_SECRET?: string;
  SESSION_SECRET?: string;
  STORAGE_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Bindings (enable in wrangler.toml when provisioned)
  DB?: D1Database;
  DATA?: R2Bucket;
  KV?: KVNamespace;
  ASSETS?: Fetcher;
  PURCHASE_QUEUE?: Queue<PurchaseQueueMessage>;
  FAMILY_LOOP?: DurableObjectNamespace;
}

/** Queue payload — mirrors queue/purchase-jobs.ts */
interface PurchaseQueueMessage {
  id: string;
  kind: "option" | "hot2";
  username: string;
  method: string;
  paymentFor: string;
  walletNumber: string;
  qrisAmount: number;
  optionCode?: string;
  hot2Idx?: number;
  createdAt: number;
}