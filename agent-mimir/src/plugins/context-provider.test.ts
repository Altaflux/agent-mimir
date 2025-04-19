import { describe, expect, test } from '@jest/globals';
import { InputAgentMessage } from '../agent-manager/index.js';
import { PluginContextProvider } from '../plugins/context-provider.js';
import { AdditionalContent, AgentPlugin } from './index.js';
import { textComplexMessage } from '../utils/format.js';

describe("PluginContextProvider", () => {

    test("test without any plugin", async () => {
        let ctxProvider = new PluginContextProvider([], {});
        const inputMessage: InputAgentMessage = {
            content: []
        }
        const messages = await ctxProvider.additionalMessageContent(inputMessage);

        expect(JSON.stringify(inputMessage)).toBe(JSON.stringify(messages.persistentMessage.message));
    });

    test("test with plugin permanent messages", async () => {

        const additionalContent: AdditionalContent[] = [
            {
                content: [
                    textComplexMessage("test1"),
                ],
                saveToChatHistory: 2,
                displayOnCurrentMessage: true
            },
            {
                content: [
                    textComplexMessage("test2"),
                ],
                saveToChatHistory: 1,
                displayOnCurrentMessage: true
            }
        ]
        const additionalContent2: AdditionalContent[] = [
            {
                content: [
                    textComplexMessage("additionalContent2"),
                ],
                saveToChatHistory: 4,
                displayOnCurrentMessage: true
            },
        ];

        let ctxProvider = new PluginContextProvider([ new DummyPlugin(undefined, additionalContent2), new DummyPlugin("PluginName", additionalContent), new DummyPlugin("PluginName2", additionalContent)], {});
        const inputMessage: InputAgentMessage = {
            content: [textComplexMessage("originalMessage2"), textComplexMessage("originalMessage2")]
        }
        const messages = await ctxProvider.additionalMessageContent(inputMessage);
        expect(messages.persistentMessage.retentionPolicy[0]).toBe(null);
        expect(messages.persistentMessage.retentionPolicy[1]).toBe(null);
    });


})


class DummyPlugin extends AgentPlugin {

    constructor(pluginName: string | undefined, private testContent: AdditionalContent[]) {
        super();
        this.name = pluginName;
    }

    async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {
        return this.testContent;

    }

}