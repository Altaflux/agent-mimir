import {describe, expect, test} from '@jest/globals';
import { InputAgentMessage } from '../agent-manager/index.js';
import { PluginContextProvider } from '../plugins/context-provider.js';



describe("test", () => {

    test("test", async () => {
        let ctsProvider = new PluginContextProvider([], {});
        const inputMessage: InputAgentMessage = {
            content: []
        }
        const messages = await ctsProvider.additionalMessageContent(inputMessage);
        
        expect(JSON.stringify(messages.displayMessage)).toBe(JSON.stringify(messages.persistentMessage.message) );
    });
})