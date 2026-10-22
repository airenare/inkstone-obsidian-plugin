import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BLANK_LINK_SCRIPT } from "../src/blankLinks";

type Handler = (e: unknown) => void;

/** Runs the injected script against a minimal fake page. */
function makePage(href = "http://127.0.0.1:8000/blog/post") {
  const listeners: Handler[] = [];
  const win = {
    location: { href },
    open: () => "real-open",
  } as Record<string, unknown> & { location: { href: string } };
  const doc = {
    addEventListener: (type: string, fn: Handler, capture: boolean) => {
      if (type === "click" && capture === true) listeners.push(fn);
    },
  };
  const sandbox = { window: win, document: doc, URL };
  const load = () => runInNewContext(BLANK_LINK_SCRIPT, sandbox);
  load();

  const anchor = (attrs: Record<string, string>) => ({
    closest: (sel: string) =>
      sel === "a[target]" && "target" in attrs ? self : null,
    getAttribute: (k: string) => attrs[k] ?? null,
  });
  let self: unknown;
  const click = (attrs: Record<string, string>, defaultPrevented = false) => {
    const a = anchor(attrs);
    self = a;
    let prevented = false;
    for (const l of listeners) {
      l({
        defaultPrevented,
        target: a,
        preventDefault: () => {
          prevented = true;
        },
      });
    }
    return prevented;
  };
  return { win, listeners, click, load };
}

describe("target=_blank links in the preview", () => {
  it("turns a relative _blank link into a same-page navigation", () => {
    const p = makePage();
    expect(p.click({ target: "_blank", href: "/blog/other" })).toBe(true);
    expect(p.win.location.href).toBe("http://127.0.0.1:8000/blog/other");
  });

  it("navigates external https links so the host can open them in the browser", () => {
    const p = makePage();
    expect(p.click({ target: "_blank", href: "https://example.com/x" })).toBe(true);
    expect(p.win.location.href).toBe("https://example.com/x");
  });

  it("allows mailto links", () => {
    const p = makePage();
    p.click({ target: "_blank", href: "mailto:me@example.com" });
    expect(p.win.location.href).toBe("mailto:me@example.com");
  });

  it("swallows but never follows javascript: and other unsafe schemes", () => {
    const p = makePage();
    for (const href of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "obsidian://open"]) {
      expect(p.click({ target: "_blank", href })).toBe(true);
      expect(p.win.location.href).toBe("http://127.0.0.1:8000/blog/post");
    }
  });

  it("leaves ordinary links alone", () => {
    const p = makePage();
    expect(p.click({ target: "_self", href: "/x" })).toBe(false);
    expect(p.click({ target: "", href: "/x" })).toBe(false);
    expect(p.click({ href: "/x" })).toBe(false);
    expect(p.win.location.href).toBe("http://127.0.0.1:8000/blog/post");
  });

  it("ignores anchors without an href and clicks that were already handled", () => {
    const p = makePage();
    expect(p.click({ target: "_blank" })).toBe(false);
    expect(p.click({ target: "_blank", href: "/y" }, true)).toBe(false);
    expect(p.win.location.href).toBe("http://127.0.0.1:8000/blog/post");
  });

  it("handles window.open the same way and never opens a real window", () => {
    const p = makePage();
    const open = p.win.open as (u?: string) => unknown;
    expect(open("/gallery/x")).toBeNull();
    expect(p.win.location.href).toBe("http://127.0.0.1:8000/gallery/x");
    expect(open("javascript:alert(1)")).toBeNull();
    expect(p.win.location.href).toBe("http://127.0.0.1:8000/gallery/x");
  });

  it("installs only once per page even if injected twice", () => {
    const p = makePage();
    p.load();
    expect(p.listeners).toHaveLength(1);
  });
});
