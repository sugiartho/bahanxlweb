import { describe, expect, it } from "vitest";
import { preprocessFilters, renderErrorPage, renderLayout, renderTemplate, renderWebuiLogin } from "./engine";

describe("SSR engine", () => {
  it("preprocesses Jinja-style filters", () => {
    const out = preprocessFilters("<span>{{price | rp}}</span>", { price: 5000 });
    expect(out).toContain("Rp 5.000");
  });

  it("renders webui login page", () => {
    const html = renderWebuiLogin(new Request("http://localhost/u/login"), {
      mode: "login",
      users_count: 3,
      username: "alice",
    });
    expect(html).toContain("Login WebUI");
    expect(html).toContain("3 user terdaftar");
    expect(html).toContain('value="alice"');
  });

  it("renders error page inside base layout", () => {
    const html = renderErrorPage(new Request("http://localhost/demo/error"), {
      title: "Not Found",
      message: "Halaman tidak ada",
    });
    expect(html).toContain("Not Found");
    expect(html).toContain("Halaman tidak ada");
    expect(html).toContain("WebUI-XL");
    expect(html).toContain("/static/css/custom.css");
  });

  it("renders error page with session user and light theme", () => {
    const html = renderErrorPage(new Request("http://localhost/packages/my"), {
      title: "Gagal fetch",
      message: "API timeout",
      user_theme: "light",
      webui_user: { username: "arifian" },
    });
    expect(html).toContain('class="theme-light"');
    expect(html).toContain("arifian");
    expect(html).not.toContain('href="/u/login" class="btn btn-primary text-xs">Login</a>');
  });

  it("renders layout with content slot", () => {
    const html = renderLayout("error_body", new Request("http://localhost/"), {
      title: "Oops",
      message: "fail",
      message_pre: false,
      page_title: "Oops",
    });
    expect(html).toContain("fail");
    expect(html).not.toContain("{{{content}}}");
  });

  it("loads all base templates", () => {
    expect(renderTemplate("base", { page_title: "T", theme_class: "", content: "BODY", sections: [] })).toContain(
      "BODY",
    );
  });
});