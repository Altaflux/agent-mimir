import { InputAgentMessage } from "../agent-manager/index.js";
import { ComplexMessageContent } from "../schema.js";
import { isEmptyMessageContent } from "../utils/format.js";
import { AgentPlugin } from "./index.js";


const PROMPT = `
#Plugin System
There is a plugin system that enhances your capabilities and context about the systems and environment you are working with and have available. This plugins may provide you with tools/functions that enable you to accomplish task and may also inject context thruought the conversation about the state of a resource managed by the plugin.

The following is the list of plugins and their context:

`
export type PluginContextConfig = {
    toolNameSanitizer?: (toolName: string) => string;
}

export type RetentionAwareMessageContent = {
    displayMessage: InputAgentMessage;
    persistentMessage: {
        message: InputAgentMessage;
        retentionPolicy: (number | null)[];
    };
}
export class PluginContextProvider {

    constructor(private plugins: AgentPlugin[], private config: PluginContextConfig) {


    }


    async getSystemPromptContext(): Promise<ComplexMessageContent[]> {

        const namedPlugins = this.plugins.filter((plugin) => plugin.name);
        const results = (await Promise.all(namedPlugins.map(async (plugin) => {
            const { content } = await plugin.getSystemMessages();
            const header = `\n\n### PLUGIN: ${plugin.name} ###\n\n`;
            const pluginList = (await plugin.tools()).map((tool) => {
                return `- ${this.config.toolNameSanitizer ? this.config.toolNameSanitizer(tool.name) : tool.name}`
            });

            //No system message content, no plugin list, return empty
            if (content.every(c => isEmptyMessageContent(c)) && pluginList.length === 0) {
                return content;
            }

            let pluginMessage: ComplexMessageContent[] = pluginList.length === 0 ? [] : [
                {
                    type: "text",
                    text: `\nThe plugin provides and manages the following tools/functions:\n${pluginList.join("\n")}`,
                } satisfies ComplexMessageContent
            ]
            return [
                {
                    type: "text",
                    text: header
                } satisfies ComplexMessageContent,
                ...content,
                ...pluginMessage
            ]
        }))).flatMap((x) => x);

        const namelessPlugins = this.plugins.filter((plugin) => !plugin.name);
        const namelessPluginsSysMessage = (await Promise.all(namelessPlugins.map(async (plugin) => {
            const { content } = await plugin.getSystemMessages();
            if (content.every(c => isEmptyMessageContent(c))) {
                return content;
            }
            return [
                {
                    type: "text",
                    text: `\n\---------------------\n`
                } satisfies ComplexMessageContent,
                ...content
            ];
        }))).flatMap((x) => x);

        return [
            ...(results.every(e => isEmptyMessageContent(e)) ? [] : [{ type: "text", text: PROMPT } satisfies ComplexMessageContent]),
            ...results,
            ...namelessPluginsSysMessage
        ]
    }

    async additionalMessageContent(message: InputAgentMessage): Promise<RetentionAwareMessageContent> {

        return await addAdditionalContentToUserMessage(message, this.plugins);

    }
}


async function addAdditionalContentToUserMessage(message: InputAgentMessage, plugins: AgentPlugin[]) {

    const namedPlugins: AgentPlugin[] = [];
    const namelessPlugins: AgentPlugin[] = [];
    for (const plugin of plugins) {
        if (plugin.name) {
            namedPlugins.push(plugin);
        } else {
            namelessPlugins.push(plugin);
        }
    }

    // Combine the groups: named first, then nameless
    const sortedPlugins = [...namedPlugins, ...namelessPlugins];
    // const sortedPlugins = [...plugins].sort((a, b) => a.name ? -1 : 1);

    const displayMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistentMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistantMessageRetentionPolicy: (number | null)[] = [];
    // const spacing: ComplexMessageContent = {
    //     type: "text",
    //     text: "\n-----------------------------------------------\n\n"
    // }
    const spacing: ComplexMessageContent = {
        type: "text",
        text: "\n"
    }
    const additionalContent: ComplexMessageContent[] = [];
    const persistentAdditionalContent: ComplexMessageContent[] = [];
    const userContent = message.content;
    for (const plugin of sortedPlugins) {
        const customizations = await plugin.additionalMessageContent(persistentMessage);
        if (!customizations) continue;
        const pluginContextName = {
            type: "text",
            text: plugin.name ? `\n### PLUGIN ${plugin.name} CONTEXT ###` : '----------------------'
        } satisfies ComplexMessageContent;

        if (customizations.some((customization) => customization.displayOnCurrentMessage)) {
            additionalContent.push(pluginContextName);
        }
        //Checks where at least one customization is true or a number bigger than 0
        if (customizations.some(customization => customization.saveToChatHistory)) {
            const maxRetention = Math.max(...customizations.filter((customization) => typeof customization.saveToChatHistory === "number")
                .filter(f => (f.saveToChatHistory as number) > 0)
                .map(f => f.saveToChatHistory as number));

            const containsOnePermanent = customizations.some((customization) => customization.saveToChatHistory === true);
            const calculatedRetention = containsOnePermanent ? null : maxRetention === -Infinity ? null : maxRetention; //We need to remove the current message from the retention policy
            persistantMessageRetentionPolicy.push(calculatedRetention);
            persistentAdditionalContent.push(pluginContextName);
        }
        for (const customization of customizations) {
            if (customization.displayOnCurrentMessage) {
                additionalContent.push(...customization.content)
                additionalContent.push(spacing)
            }

            if (customization.saveToChatHistory) {
                const retention = typeof customization.saveToChatHistory === "number" ? customization.saveToChatHistory : null;
                persistantMessageRetentionPolicy.push(...customization.content.map(() => retention));
                persistentAdditionalContent.push(...customization.content);
                persistentAdditionalContent.push(spacing)
                persistantMessageRetentionPolicy.push(retention); //This one is for spacing
            }
        }
    }
    // displayMessage.content.unshift(...additionalContent);
    // persistentMessage.content.unshift(...persistentAdditionalContent);
    // //Add nulls to the retention policy for the user content
    // persistantMessageRetentionPolicy.push(...userContent.map(() => null));

    displayMessage.content.push(...additionalContent);
    persistentMessage.content.push(...persistentAdditionalContent);
    //Add nulls to the retention policy for the user content
    persistantMessageRetentionPolicy.unshift(...userContent.map(() => null));

    return {
        displayMessage,
        persistentMessage: {
            message: persistentMessage,
            retentionPolicy: persistantMessageRetentionPolicy
        }
    }
}