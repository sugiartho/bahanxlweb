import type { InlineKeyboard } from "./types";

export function kbBackMenu(extraRows: InlineKeyboard["inline_keyboard"] = []): InlineKeyboard {
  return {
    inline_keyboard: [...extraRows, [{ text: "« Menu utama", callback_data: "menu:home" }]],
  };
}

export function mainMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "📱 Nomor", callback_data: "menu:nomor" }],
      [{ text: "📊 Kuota & Saldo", callback_data: "menu:kuota" }],
      [
        { text: "🧾 Riwayat", callback_data: "menu:history" },
        { text: "🛒 Beli Paket", callback_data: "purchase:start" },
      ],
      [
        { text: "🗑️ Unsubscribe", callback_data: "menu:unsub" },
        { text: "❓ Help", callback_data: "menu:help" },
      ],
      [{ text: "🔌 Unlink", callback_data: "menu:unlink" }],
    ],
  };
}

export const HELP_TEXT = `<b>Daftar Command</b>

/link &lt;user&gt; &lt;pass&gt; — Link akun WebUI
/unlink — Hapus link
/nomor — Ganti nomor aktif
/menu — Menu utama
/kuota — Info pelanggan + kuota/paket aktif
/saldo · /paket — sama dengan /kuota
/beli &lt;option_code&gt; — Beli paket
/unsub — Unsubscribe paket aktif
/history — Riwayat (nomor aktif)

Semua fitur memakai nomor aktif sampai diganti via 📱 Nomor.`;