import { Serper } from "langchain/tools";
import { WebBrowser } from "langchain/tools/webbrowser";
import { BaseLanguageModel } from "langchain/base_language";
import { Embeddings } from 'langchain/embeddings'

export function createTools(embeddings: Embeddings, model: BaseLanguageModel) {
    const tools = [];

    if (process.env.SERPER_API_KEY) {
        const searchTool = new Serper(process.env.SERPER_API_KEY);
        tools.push(searchTool);
    }

    if (process.env.ENABLE_BROWSER_TOOL) {
        tools.push(new WebBrowser({
            model: model,
            embeddings: embeddings,
        }));
    }

    return tools;

}