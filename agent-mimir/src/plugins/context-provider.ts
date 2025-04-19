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

    /**
     * Processes an incoming user message and potentially enriches it with additional
     * context provided by registered agent plugins.
     *
     * This method iterates through the available plugins, calls their respective
     * `additionalMessageContent` methods, and constructs two versions of the message:
     * 1.  `displayMessage`: Intended for immediate display, includes original user
     * content plus any plugin content marked for display.
     * 2.  `persistentMessage`: Intended for saving to chat history, includes
     * original user content plus any plugin content marked for saving, along
     * with a detailed retention policy array.
     *
     * @param message The original incoming user message (`InputAgentMessage`).
     * @returns A Promise resolving to a `RetentionAwareMessageContent` object containing
     * the `displayMessage` and the `persistentMessage` (with its associated
     * `retentionPolicy`).
     */
    async additionalMessageContent(message: InputAgentMessage): Promise<RetentionAwareMessageContent> {

        return await addAdditionalContentToUserMessage(message, this.plugins);

    }
}




// --- Documentation for the core logic (within addAdditionalContentToUserMessage) ---

/**
 * Core logic for adding plugin content to a user message.
 *
 * **Processing Steps:**
 *
 * 1.  **Plugin Sorting:** Plugins are sorted to process named plugins first,
 * followed by nameless plugins. The original relative order *within* the
 * named group and *within* the nameless group is preserved (stable sort).
 * 2.  **Iteration:** The method iterates through the sorted plugins.
 * 3.  **Plugin Call:** For each plugin, it calls `await plugin.additionalMessageContent(message)`.
 * 4.  **Customization Processing:** It processes the array of `AdditionalContent` objects
 * (`customizations`) returned by the plugin.
 * 5.  **Header Generation:** If any customization from a plugin contributes content to
 * either the display or persistent message, a context header is added for that plugin:
 * -   `\n### PLUGIN PluginName CONTEXT ###` for named plugins.
 * -   `----------------------` for nameless plugins.
 * This header is added *before* the content from that plugin's customizations.
 * 6.  **Content Aggregation:**
 * -   If `customization.displayOnCurrentMessage` is true, the `customization.content`
 * is appended to the `displayMessage.content`.
 * -   If `customization.saveToChatHistory` is set (true or a number > 0), the
 * `customization.content` is appended to the `persistentMessage.message.content`.
 * 7.  **Spacing:** A newline spacing object (`{ type: 'text', text: '\n' }`) is appended
 * after the content parts of *each individual customization* that added content
 * to either the display or persistent message streams.
 * 8.  **Retention Policy Construction:** A `retentionPolicy` array is built alongside
 * the `persistentMessage.message.content`. This array has the same length, and
 * each element corresponds to a content part in the persistent message.
 *
 * **Output Structure (`RetentionAwareMessageContent`):**
 *
 * -   `displayMessage: InputAgentMessage`:
 * -   Contains the original user message content parts.
 * -   Followed by headers, content, and spacing from plugins where
 * `displayOnCurrentMessage` was true for any customization.
 * -   `persistentMessage: { message: InputAgentMessage; retentionPolicy: (number | null)[] }`:
 * -   `message`:
 * -   Contains the original user message content parts.
 * -   Followed by headers, content, and spacing from plugins where
 * `saveToChatHistory` was set for any customization.
 * -   `retentionPolicy`:
 * -   An array parallel to `persistentMessage.message.content`.
 * -   Specifies the retention duration (in turns) or permanence for each content part.
 *
 * **Retention Policy Logic Details (`persistentMessage.retentionPolicy`):**
 *
 * -   **Original User Content:** All content parts from the original `message` always
 * receive `null` retention (meaning they follow the default chat history retention).
 * -   **Plugin Header Content:** The retention for a plugin's header (`### PLUGIN...` or `---...`)
 * in the persistent message is determined by the "highest" retention among all
 * customizations *from that specific plugin* being saved in the current turn:
 * -   It is `null` (permanent relative to chat history limits) if *any* customization
 * from that plugin has `saveToChatHistory: true`.
 * -   Otherwise, it is the *maximum numeric value* among all `saveToChatHistory: <number>`
 * values from that plugin's customizations saved in this turn.
 * -   If no customizations from the plugin are saved, the header isn't added to the
 * persistent message or retention policy.
 * -   **Plugin Content Parts & Spacing:** The retention for the actual content parts
 * (text, images) and their subsequent spacing (`\n`) added by a plugin customization
 * is determined *solely by that specific customization's `saveToChatHistory` value*:
 * -   `null` if `saveToChatHistory` was `true`.
 * -   `<number>` if `saveToChatHistory` was that specific `<number>`.
 * -   This value is *not* affected by other customizations returned by the same plugin.
 *
 * **Example Scenario:**
 *
 * If `PluginA` returns:
 * ```
 * [
 * { content: [txt1], saveToChatHistory: 3, displayOnCurrentMessage: true },
 * { content: [txt2], saveToChatHistory: true, displayOnCurrentMessage: false }
 * ]
 * ```
 * The `persistentMessage` might look like:
 * -   `content`: `[originalUserContent, headerPluginA, txt1, spacing1, txt2, spacing2]`
 * -   `retentionPolicy`: `[null, null, 3, 3, null, null]`
 * -   `null` for original user content.
 * -   `null` for `headerPluginA` (because `saveToChatHistory: true` was present).
 * -   `3` for `txt1` (from its own setting).
 * -   `3` for `spacing1` (inherits from `txt1`).
 * -   `null` for `txt2` (from its own setting).
 * -   `null` for `spacing2` (inherits from `txt2`).
 *
 * The `displayMessage` would contain: `[originalUserContent, headerPluginA, txt1, spacing1]`
 */
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

    const displayMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistentMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistantMessageRetentionPolicy: (number | null)[] = [];

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

    displayMessage.content.push(...additionalContent);
    persistentMessage.content.push(...persistentAdditionalContent);

    persistantMessageRetentionPolicy.unshift(...userContent.map(() => null));

    return {
        displayMessage,
        persistentMessage: {
            message: persistentMessage,
            retentionPolicy: persistantMessageRetentionPolicy
        }
    }
}