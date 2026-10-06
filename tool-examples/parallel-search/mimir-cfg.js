module.exports = async function () {
  const { ChatOpenAI, OpenAIEmbeddings } = await import("@langchain/openai");
  const { McpClientPluginFactory, StreamableHTTPClientTransport } =
    await import("@mimir/mcp-client");

  if (!process.env.OPENAI_API_KEY || !process.env.AGENT_OPENAI_MODEL) {
    throw new Error(
      "Set OPENAI_API_KEY and AGENT_OPENAI_MODEL to use this example.",
    );
  }

  const chatModel = new ChatOpenAI({
    model: process.env.AGENT_OPENAI_MODEL,
    temperature: 0,
  });

  return {
    continuousMode: false,
    embeddings: new OpenAIEmbeddings(),
    agents: {
      Researcher: {
        description: "An assistant that researches public web sources.",
        definition: {
          profession: "a research assistant who cites source URLs",
          chatModel,
          plugins: [
            {
              prefix: "parallel",
              factory: new McpClientPluginFactory({
                servers: {
                  parallel: {
                    description:
                      "Search the web and fetch public pages with Parallel.",
                    transport: () =>
                      new StreamableHTTPClientTransport(
                        new URL("https://search.parallel.ai/mcp"),
                        {
                          requestInit: {
                            headers: {
                              "User-Agent":
                                "agent-mimir/parallel-search-example",
                            },
                          },
                        },
                      ),
                  },
                },
              }),
            },
          ],
        },
      },
    },
  };
};
