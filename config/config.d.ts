declare module '../../config/config.js' {
  interface Config {
    rpc_urls: {
      primary: string;
      mainnet_http: string;
      mainnet_wss: string;
      devnet_http: string;
      devnet_wss: string;
    };
    master_wallet: {
      address: string | undefined;
      min_contest_wallet_balance: number;
    };
    transaction_types: {
      PRIZE_PAYOUT: string;
      CONTEST_WALLET_RAKE: string;
      CONTEST_ENTRY: string;
      TOKEN_PURCHASE: string;
      TOKEN_SALE: string;
      WITHDRAWAL: string;
      DEPOSIT: string;
    };
    transaction_statuses: {
      PENDING: string;
      [key: string]: string;
    };
    api_urls: {
      data: string;
      lobby: string;
      reflections: string;
      game: string;
      dd_serv: string;
    };
  }

  export const config: Config;
} 