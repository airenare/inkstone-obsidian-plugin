import { requestUrl } from "obsidian";
import type { Fetcher } from "./sourceMap";

/**
 * Fetcher over Obsidian's `requestUrl`, which bypasses the renderer's CORS
 * checks. `throw: false` keeps HTTP errors as statuses, so a 404 from an
 * outdated InkStone reports "update InkStone" instead of "unreachable".
 */
export const obsidianFetcher: Fetcher = async (url) => {
  const res = await requestUrl({ url, method: "GET", throw: false });
  return { status: res.status, text: async () => res.text };
};
