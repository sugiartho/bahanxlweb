export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  from?: TelegramUser;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface ChatStateData {
  step?: string | null;
  data?: Record<string, unknown>;
  active_msisdn?: number | null;
  account_msisdn?: number | null;
  pkg_map?: Record<string, string>;
  unsub_map?: Record<string, string>;
  dcy_map?: Record<string, string>;
  bm_map?: Record<string, string>;
  pending_purchase?: Record<string, unknown>;
  pending_hot?: Record<string, unknown>;
  pending_hot_method?: string;
  [key: string]: unknown;
}

export interface PendingConfirm {
  action: string;
  expires: number;
  [key: string]: unknown;
}