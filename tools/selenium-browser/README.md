# langchain-selenium-browser

A langchain web browser tool based on Selenium

## Usage:
```javascript
    const WebBrowserToolKit = require('@agent-mimir/selenium-browser').WebBrowserToolKit;
    const model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0.9,
    });
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const webToolKit = new WebBrowserToolKit({ browserConfig: { browserName: "chrome" } }, model, embeddings);

    //Add to agents tool:
    tools: [
            ...webToolKit.tools,
        ],
```