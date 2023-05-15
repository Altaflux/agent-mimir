# langchain-selenium-browser

A langchain web browser tool based on Selenium

## Usage:
```javascript
    const SeleniumWebBrowser = require('@agent-mimir/selenium-browser').SeleniumWebBrowser;
    const model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0.9,
    });
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const webBrowserTool = new SeleniumWebBrowser({
        model: model,
        embeddings: embeddings,
        seleniumDriverOptions: {
            browserName: 'chrome',
        }
    })
```