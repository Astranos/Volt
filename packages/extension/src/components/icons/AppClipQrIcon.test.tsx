import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AppClipQrIcon } from "./AppClipQrIcon";

it("renders the shared Hugeicons QR artwork at either caller's size", () => {
  const markup = renderToStaticMarkup(<AppClipQrIcon className="h-4 w-4" />);
  expect(markup).toContain('viewBox="0 0 24 24"');
  expect(markup).toContain('class="h-4 w-4"');
  expect(markup).toContain('stroke="currentColor"');
  expect(markup).toContain('aria-hidden="true"');
  expect(markup.match(/<path /g)).toHaveLength(6);
});
