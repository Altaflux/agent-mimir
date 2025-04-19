import { describe, expect, it, beforeEach } from '@jest/globals';
import { InputAgentMessage } from '../agent-manager/index.js';
import { PluginContextConfig, PluginContextProvider, RetentionAwareMessageContent } from '../plugins/context-provider.js';
import { AdditionalContent, AgentPlugin } from './index.js';
import { ImageMessageContent, TextMessageContent } from '../schema.js';


class DummyPlugin extends AgentPlugin {

    constructor(pluginName: string | undefined, private testContent: AdditionalContent[]) {
        super();
        this.name = pluginName;
    }

    async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {
        return this.testContent;

    }

}



describe('PluginContextProvider', () => {
    let config: PluginContextConfig;
    let initialMessage: InputAgentMessage;

    beforeEach(() => {
        // Reset config and initial message before each test
        config = {}; // Use default config
        initialMessage = {
            content: [
                { type: 'text', text: 'Original user message.' } satisfies TextMessageContent,
            ],
        };
    });

    describe('additionalMessageContent', () => {
        it('should return original message if no plugins are provided', async () => {
            const plugins: AgentPlugin[] = [];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            const expected: RetentionAwareMessageContent = {
                displayMessage: {
                    content: [{ type: 'text', text: 'Original user message.' }],
                },
                persistentMessage: {
                    message: {
                        content: [{ type: 'text', text: 'Original user message.' }],
                    },
                    retentionPolicy: [null], // One null for the original message part
                },
            };

            expect(result).toEqual(expected);
        });

        it('should return original message if plugins provide no additional content', async () => {
            const plugins = [new DummyPlugin('PluginA', [])];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            const expected: RetentionAwareMessageContent = {
                displayMessage: {
                    content: [{ type: 'text', text: 'Original user message.' }],
                },
                persistentMessage: {
                    message: {
                        content: [{ type: 'text', text: 'Original user message.' }],
                    },
                    retentionPolicy: [null],
                },
            };

            expect(result).toEqual(expected);
        });

        it('should add content for display only (named plugin)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Display only content.' }],
                    saveToChatHistory: false,
                    displayOnCurrentMessage: true,
                },
            ];
            const plugins = [new DummyPlugin('PluginA', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            expect(result.displayMessage.content).toEqual([
                { type: 'text', text: 'Original user message.' },
                { type: 'text', text: '\n### PLUGIN PluginA CONTEXT ###' },
                { type: 'text', text: 'Display only content.' },
                { type: 'text', text: '\n' }, // Spacing
            ]);

            // Persistent message should only contain original content
            expect(result.persistentMessage.message.content).toEqual([
                { type: 'text', text: 'Original user message.' },
            ]);

            // Retention policy only for original content
            expect(result.persistentMessage.retentionPolicy).toEqual([null]);
        });

        it('should add content for display only (nameless plugin)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Display only content.' }],
                    saveToChatHistory: false,
                    displayOnCurrentMessage: true,
                },
            ];
            const plugins = [new DummyPlugin(undefined, additionalContent)]; // Nameless
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            expect(result.displayMessage.content).toEqual([
                { type: 'text', text: 'Original user message.' },
                { type: 'text', text: '----------------------' }, // Nameless header
                { type: 'text', text: 'Display only content.' },
                { type: 'text', text: '\n' }, // Spacing
            ]);

            // Persistent message unchanged
            expect(result.persistentMessage.message.content).toEqual([
                { type: 'text', text: 'Original user message.' },
            ]);
            expect(result.persistentMessage.retentionPolicy).toEqual([null]);
        });


        it('should add content for persistence only (named plugin, save=true)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Persistent only content.' }],
                    saveToChatHistory: true,
                    displayOnCurrentMessage: false,
                },
            ];
            const plugins = [new DummyPlugin('PluginB', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            // Display message should only contain original content
            expect(result.displayMessage.content).toEqual([
                { type: 'text', text: 'Original user message.' },
            ]);

            // Persistent message should contain original + plugin content
            expect(result.persistentMessage.message.content).toEqual([
                { type: 'text', text: 'Original user message.' },
                { type: 'text', text: '\n### PLUGIN PluginB CONTEXT ###' },
                { type: 'text', text: 'Persistent only content.' },
                { type: 'text', text: '\n' }, // Spacing
            ]);

            // Retention policy: null for original, null for header, null for content (save=true), null for spacing
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original message
                null, // Header
                null, // Content (save=true)
                null, // Spacing
            ]);
        });

        it('should add content for persistence only (named plugin, save=number)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Persistent only (3 turns).' }],
                    saveToChatHistory: 3, // Retain for 3 turns
                    displayOnCurrentMessage: false,
                },
            ];
            const plugins = [new DummyPlugin('PluginC', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            // Display message unchanged
            expect(result.displayMessage.content).toEqual([
                { type: 'text', text: 'Original user message.' },
            ]);

            // Persistent message has added content
            expect(result.persistentMessage.message.content).toEqual([
                { type: 'text', text: 'Original user message.' },
                { type: 'text', text: '\n### PLUGIN PluginC CONTEXT ###' },
                { type: 'text', text: 'Persistent only (3 turns).' },
                { type: 'text', text: '\n' }, // Spacing
            ]);

            // Retention policy: null for original, 3 for header, 3 for content, 3 for spacing
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original message
                3,    // Header (takes max retention from its content)
                3,    // Content
                3,    // Spacing
            ]);
        });

        it('should add content for both display and persistence (save=true)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Display and Persistent content.' }],
                    saveToChatHistory: true,
                    displayOnCurrentMessage: true,
                },
            ];
            const plugins = [new DummyPlugin('PluginD', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            const expectedAddedContent = [
                { type: 'text', text: '\n### PLUGIN PluginD CONTEXT ###' },
                { type: 'text', text: 'Display and Persistent content.' },
                { type: 'text', text: '\n' }, // Spacing
            ];

            // Both messages should have original + added content
            expect(result.displayMessage.content).toEqual([
                initialMessage.content[0],
                ...expectedAddedContent,
            ]);
            expect(result.persistentMessage.message.content).toEqual([
                initialMessage.content[0],
                ...expectedAddedContent,
            ]);

            // Retention policy: null for original, null for header, null for content, null for spacing
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original
                null, // Header
                null, // Content
                null, // Spacing
            ]);
        });

        it('should add content for both display and persistence (save=number)', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [
                        { type: 'text', text: 'Display and Persistent (5).' } satisfies TextMessageContent,
                        { type: 'text', text: 'Part 2 (also 5).' } satisfies TextMessageContent
                    ],
                    saveToChatHistory: 5,
                    displayOnCurrentMessage: true,
                },
            ];
            const plugins = [new DummyPlugin('PluginE', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            const expectedAddedContent = [
                { type: 'text', text: '\n### PLUGIN PluginE CONTEXT ###' },
                { type: 'text', text: 'Display and Persistent (5).' },
                { type: 'text', text: 'Part 2 (also 5).' },
                { type: 'text', text: '\n' }, // Spacing
            ];

            // Both messages should have original + added content
            expect(result.displayMessage.content).toEqual([
                initialMessage.content[0],
                ...expectedAddedContent,
            ]);
            expect(result.persistentMessage.message.content).toEqual([
                initialMessage.content[0],
                ...expectedAddedContent,
            ]);

            // Retention policy: null for original, 5 for header, 5 for each content part, 5 for spacing
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original
                5,    // Header
                5,    // Content part 1
                5,    // Content part 2
                5,    // Spacing
            ]);
        });

        it('should handle multiple plugins with mixed settings', async () => {
            const initialMsg: InputAgentMessage = { content: [{ type: 'text', text: 'User says hi.' }] };
            const plugins = [
                new DummyPlugin('DisplayOnly', [
                    { content: [{ type: 'text', text: 'Display A' }], saveToChatHistory: false, displayOnCurrentMessage: true }
                ]),
                new DummyPlugin(undefined, [ // Nameless, persistent only
                    { content: [{ type: 'text', text: 'Persistent Nameless' }], saveToChatHistory: true, displayOnCurrentMessage: false }
                ]),
                new DummyPlugin('BothMixedRetention', [
                    { content: [{ type: 'text', text: 'Both B1 (save=2)' }], saveToChatHistory: 2, displayOnCurrentMessage: true },
                    { content: [{ type: 'text', text: 'Both B2 (save=true)' }], saveToChatHistory: true, displayOnCurrentMessage: true } // This makes overall retention null
                ]),
                new DummyPlugin('PersistentOnlyNum', [
                    { content: [{ type: 'text', text: 'Persistent C (save=4)' }], saveToChatHistory: 4, displayOnCurrentMessage: false }
                ]),
            ];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMsg);

            // Expected display content: Original + DisplayOnly + BothMixedRetention
            expect(result.displayMessage.content).toEqual([
                { type: 'text', text: 'User says hi.' },
                // Named plugins first
                { type: 'text', text: '\n### PLUGIN DisplayOnly CONTEXT ###' },
                { type: 'text', text: 'Display A' },
                { type: 'text', text: '\n' }, // Spacing after DisplayOnly content
                { type: 'text', text: '\n### PLUGIN BothMixedRetention CONTEXT ###' },
                { type: 'text', text: 'Both B1 (save=2)' },
                { type: 'text', text: '\n' }, // Spacing after Both B1 content <<-- ADDED
                { type: 'text', text: 'Both B2 (save=true)' },
                { type: 'text', text: '\n' }, // Spacing after Both B2 content
                // Nameless plugins last - none displayed
                // PersistentOnlyNum not displayed
            ]);

            // Expected persistent content: Original + PersistentNameless + BothMixedRetention + PersistentOnlyNum
            expect(result.persistentMessage.message.content).toEqual([
                { type: 'text', text: 'User says hi.' },
                // Named plugins that save
                { type: 'text', text: '\n### PLUGIN BothMixedRetention CONTEXT ###' }, // From BothMixedRetention
                { type: 'text', text: 'Both B1 (save=2)' },
                { type: 'text', text: '\n' }, // Spacing after Both B1 content <<-- ADDED
                { type: 'text', text: 'Both B2 (save=true)' },
                { type: 'text', text: '\n' }, // Spacing after Both B2 content
                { type: 'text', text: '\n### PLUGIN PersistentOnlyNum CONTEXT ###' }, // From PersistentOnlyNum
                { type: 'text', text: 'Persistent C (save=4)' },
                { type: 'text', text: '\n' }, // Spacing after Persistent C content
                // Nameless plugins last
                { type: 'text', text: '----------------------' }, // From PersistentNameless
                { type: 'text', text: 'Persistent Nameless' },
                { type: 'text', text: '\n' }, // Spacing after Persistent Nameless content
            ]);

            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original 'User says hi.'

                // BothMixedRetention (overall block retention null because one part is true)
                null, // Header
                2, // 'Both B1 (save=2)' -> becomes null
                2, // Spacing after B1 <<-- ADDED
                null, // 'Both B2 (save=true)'
                null, // Spacing after B2

                // PersistentOnlyNum (block retention 4)
                4,    // Header
                4,    // 'Persistent C (save=4)'
                4,    // Spacing after C

                // PersistentNameless (block retention null because save=true)
                null, // Header
                null, // 'Persistent Nameless'
                null, // Spacing after Nameless
            ]);

            expect(1).toEqual(1)
        });

        it('should handle complex initial message and multiple plugin contents', async () => {
            const complexInitialMessage: InputAgentMessage = {
                content: [
                    { type: 'text', text: 'Check this image:' } satisfies TextMessageContent,
                    { type: 'image_url', image_url: { url: 'http://example.com/img.png', type: 'png' } } satisfies ImageMessageContent,
                ],
            };
            const plugins = [
                new DummyPlugin('MultiPartPlugin', [
                    {
                        content: [
                            { type: 'text', text: 'Analysis Part 1.' } satisfies TextMessageContent,
                            { type: 'text', text: 'Analysis Part 2 (save=1).' } satisfies TextMessageContent,
                        ],
                        saveToChatHistory: 1, // Max retention for this block is 1
                        displayOnCurrentMessage: true
                    },
                    {
                        content: [{ type: 'text', text: 'Follow up (save=true).' } satisfies TextMessageContent],
                        saveToChatHistory: true, // This makes overall retention null
                        displayOnCurrentMessage: true
                    }
                ])
            ];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(complexInitialMessage);

            const expectedPluginHeader = { type: 'text', text: '\n### PLUGIN MultiPartPlugin CONTEXT ###' };
            const expectedPluginContent1_1 = { type: 'text', text: 'Analysis Part 1.' };
            const expectedPluginContent1_2 = { type: 'text', text: 'Analysis Part 2 (save=1).' };
            const expectedPluginContent2_1 = { type: 'text', text: 'Follow up (save=true).' };
            const spacing = { type: 'text', text: '\n' };

            // Display includes original + all plugin parts
            expect(result.displayMessage.content).toEqual([
                complexInitialMessage.content[0],
                complexInitialMessage.content[1],
                expectedPluginHeader,
                expectedPluginContent1_1,
                expectedPluginContent1_2,
                spacing, // Spacing after first content block
                expectedPluginContent2_1,
                spacing // Spacing after second content block
            ]);

            // Persistent includes original + all plugin parts
            expect(result.persistentMessage.message.content).toEqual([
                complexInitialMessage.content[0],
                complexInitialMessage.content[1],
                expectedPluginHeader,
                expectedPluginContent1_1,
                expectedPluginContent1_2,
                spacing,
                expectedPluginContent2_1,
                spacing
            ]);

            // Retention: null for original, null for header, null for all content parts (because one save=true), null for spacings
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original text
                null, // Original image
                null, // Header
                1, // Content 1_1
                1, // Content 1_2
                1, // Spacing 1
                null, // Content 2_1
                null, // Spacing 2
            ]);
        });

        it('should correctly determine max retention when multiple numeric retentions are present', async () => {
            const additionalContent: AdditionalContent[] = [
                {
                    content: [{ type: 'text', text: 'Save for 2.' }],
                    saveToChatHistory: 2,
                    displayOnCurrentMessage: false,
                },
                {
                    content: [{ type: 'text', text: 'Save for 5.' }],
                    saveToChatHistory: 5, // This is the max
                    displayOnCurrentMessage: false,
                },
                {
                    content: [{ type: 'text', text: 'Save for 1.' }],
                    saveToChatHistory: 1,
                    displayOnCurrentMessage: false,
                },
            ];
            const plugins = [new DummyPlugin('MaxRetentionTest', additionalContent)];
            const provider = new PluginContextProvider(plugins, config);
            const result = await provider.additionalMessageContent(initialMessage);

            // Persistent message includes original + all plugin parts
            expect(result.persistentMessage.message.content).toEqual([
                initialMessage.content[0],
                { type: 'text', text: '\n### PLUGIN MaxRetentionTest CONTEXT ###' },
                { type: 'text', text: 'Save for 2.' },
                { type: 'text', text: '\n' },
                { type: 'text', text: 'Save for 5.' },
                { type: 'text', text: '\n' },
                { type: 'text', text: 'Save for 1.' },
                { type: 'text', text: '\n' },
            ]);

            // Retention policy: null for original, 5 for header (max of content), specific retentions for content, 5 for spacing
            expect(result.persistentMessage.retentionPolicy).toEqual([
                null, // Original
                5,    // Header (max of 2, 5, 1)
                2,    // Content 1
                2,    // Spacing 1 (takes retention of preceding content)
                5,    // Content 2
                5,    // Spacing 2
                1,    // Content 3
                1,    // Spacing 3
            ]);
        });

    });
});