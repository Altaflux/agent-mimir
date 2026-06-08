import { AgentTool } from "@mimir/agent-core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AdditionalContent,
  AgentPlugin,
  PluginFactory,
  NextMessageUser,
  PluginContext,
  AgentSystemMessage,
} from "@mimir/agent-core/plugins";
import { CoordinateMouseMode } from "./coordinate-mode.js";
import {
  ClickPositionOnDesktop,
  ScrollScreen,
  TypeOnDesktop,
  TypeTextOnDesktop,
} from "./desktop-tools.js";
import { MouseMode } from "./mouse-mode.js";
import { PixelMouseMode } from "./pixel-mode.js";
import { SomMouseMode } from "./som-mode.js";

export type DesktopControlOptions = {
  mouseMode: "SOM" | "COORDINATES" | "PIXEL";
  pixelImageWidth?: number;
  model?: BaseChatModel;
};

export class DesktopControlPluginFactory implements PluginFactory {
  pluginId = "desktopControl";

  constructor(private options: DesktopControlOptions) {}

  async create(context: PluginContext): Promise<AgentPlugin> {
    return new DesktopControlPlugin(context, this.options);
  }
}

class DesktopControlPlugin extends AgentPlugin {
  private readonly mouseMode: MouseMode;

  constructor(
    private context: PluginContext,
    private options: DesktopControlOptions,
  ) {
    super();
    if (options.mouseMode === "COORDINATES") {
      this.mouseMode = new CoordinateMouseMode();
    } else if (options.mouseMode === "SOM") {
      this.mouseMode = new SomMouseMode();
    } else if (options.mouseMode === "PIXEL") {
      this.mouseMode = new PixelMouseMode({
        imageWidth: options.pixelImageWidth ?? 1440,
      });
    } else {
      throw new Error("No valid mouse mode.");
    }
  }

  async init(): Promise<void> {
    await this.mouseMode.init();
  }

  async reset(): Promise<void> {
    await this.mouseMode.reset();
  }

  async destroy(): Promise<void> {
    await this.mouseMode.destroy();
  }
  async getSystemMessages(): Promise<AgentSystemMessage> {
    return {
      content: [
        {
          type: "text",
          text: `\nComputer Control Instruction:\n You can control the computer by moving the mouse, clicking and typing. Make sure to pay close attention to the details provided in the screenshot image to confirm the outcomes of the actions you take to ensure accurate completion of tasks. 
${this.mouseMode.instructionsMessage()}`,
        },
      ],
    };
  }

  async additionalMessageContent(
    message: NextMessageUser,
  ): Promise<AdditionalContent[]> {
    const { content, finalImage } = await this.mouseMode.getScreenshot();

    return [
      {
        saveToChatHistory: 2,
        displayOnCurrentMessage: false,
        content: [
          {
            type: "text",
            text: "The image of the user's computer screen is displayed below.",
          },
          {
            type: "image",
            mimeType: "image/jpeg",
            data: finalImage.toString("base64"),
          },
        ],
      },
      {
        saveToChatHistory: false,
        displayOnCurrentMessage: true,
        content: content,
      },
    ];
  }

  async tools(): Promise<AgentTool[]> {
    const screenshot = async () => {
      return [];
    };
    const mouseTools = await this.mouseMode.getTools();

    return [
      ...mouseTools,
      new ClickPositionOnDesktop(screenshot),
      new TypeTextOnDesktop(screenshot),
      new TypeOnDesktop(screenshot),
      new ScrollScreen(),
    ];
  }
}
