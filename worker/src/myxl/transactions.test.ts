import { describe, expect, it } from "vitest";
import { formatTransactions } from "./transactions";

describe("formatTransactions", () => {
  it("builds rows with precomputed badge classes", () => {
    const rows = formatTransactions({
      data: {
        list: [
          {
            title: "Paket A",
            price: "IDR 2000",
            status: "SUCCESS",
            payment_status: "PENDING",
            timestamp: 1_759_523_623,
            icon: "",
            payment_method_label: "QRIS",
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Paket A");
    expect(rows[0].status_bg_class).toBe("bg-emerald-500/15");
    expect(rows[0].payment_status_bg_class).toBe("bg-amber-500/15");
    expect(rows[0].show_payment_status).toBe(true);
  });

  it("accepts data object with list directly", () => {
    const rows = formatTransactions({ list: [{ title: "X", status: "FAILED" }] });
    expect(rows[0].status_text_class).toBe("text-red-300");
  });
});