
import { StructuredTool } from "langchain/tools";

import { z } from "zod";

export type SerperParameters = {
  gl?: string;
  hl?: string;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerperResponseExtractor = (response: any) => Promise<string>;

/**
 * Wrapper around serper.
 *
 * You can create a free API key at https://serper.dev.
 *
 * To use, you should have the SERPER_API_KEY environment variable set.
 */
export class Serper extends StructuredTool {
    schema = z.object({
        searchQuery: z.string().describe("The search query to run."),
    });

  protected key: string;

  protected params: Partial<SerperParameters>;

  protected responseExtractor: SerperResponseExtractor;

  constructor(
    apiKey: string | undefined = process.env.SERPER_API_KEY,
    params: Partial<SerperParameters> = {},
    responseExtractor: SerperResponseExtractor = defaultResponseExtractor
  ) {
    super();

    if (!apiKey) {
      throw new Error(
        "Serper API key not set. You can set it as SERPER_API_KEY in your .env file, or pass it to Serper."
      );
    }

    this.key = apiKey;
    this.params = params;
    this.responseExtractor = responseExtractor;
  }

  name = "search";

  /** @ignore */
  async _call(arg: z.input<this["schema"]>) {
    const options = {
      method: "POST",
      headers: {
        "X-API-KEY": this.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: arg.searchQuery,
        ...this.params,
      }),
    };

    const res = await fetch("https://google.serper.dev/search", options);

    if (!res.ok) {
      throw new Error(`Got ${res.status} error from serper: ${res.statusText}`);
    }

    const json = await res.json();
    return await this.responseExtractor(json);
  }

  description =
    "a search engine. useful for when you need to answer questions about current events.";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function defaultResponseExtractor(json: any) {
    const links = json.organic.slice(0, 3).map((link: any) => {
    return `--- Site Title: ${link.title}` + "\nUrl: " + link.link + "\nSnippet: " + link.snippet + "\n";
  }).join("\n");

  
  return `Result: ${json.answerBox?.answer ?? ""}\n${json.answerBox?.snippet ?? ""}\nLinks:\n` + links;
}