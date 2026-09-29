import { describe, expect, it } from "vitest";
import { parseNotificationDetail, parseNotificationList } from "./notifications";

describe("notification helpers", () => {
  it("parseNotificationList extracts inbox items", () => {
    const items = parseNotificationList({
      status: "SUCCESS",
      data: {
        inbox: [
          {
            notification_id: "n1",
            category_title: "Promo",
            full_message: "Hello",
            timestamp: "2026-01-15T10:00:00Z",
            is_read: false,
          },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("n1");
    expect(items[0].title).toBe("Promo");
    expect(items[0].is_unread).toBe(true);
  });

  it("parseNotificationDetail unwraps nested data", () => {
    const detail = parseNotificationDetail({
      data: {
        category_title: "Info",
        full_message: "Detail body",
        timestamp: "2026-01-15T10:00:00Z",
        category: "SYSTEM",
      },
    });
    expect(detail.title).toBe("Info");
    expect(detail.body).toBe("Detail body");
    expect(detail.category).toBe("SYSTEM");
  });
});