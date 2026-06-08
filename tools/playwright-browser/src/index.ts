import { WebDriverManager } from "./driver-manager.js";

import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "@langchain/core/embeddings";
import {
  WebBrowserTool,
  PassValueToInput,
  ClickWebSiteLinkOrButton,
  ScrollTool,
} from "./tools.js";
import {
  AgentPlugin,
  PluginContext,
  PluginFactory,
  AdditionalContent,
  NextMessageUser,
  NextMessage,
  PluginRuntimeContext,
} from "@mimir/agent-core/plugins";
import { AgentTool } from "@mimir/agent-core/tools";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import sharp from "sharp";
import { InteractableElement } from "html-processor.js";

export {
  WebDriverManager,
  PlaywrightDriverOptions as SeleniumDriverOptions,
  WebBrowserOptions,
} from "./driver-manager.js";
export {
  WebBrowserTool,
  PassValueToInput,
  AskSiteQuestion,
  ClickWebSiteLinkOrButton,
} from "./tools.js";

export class WebBrowserPluginFactory implements PluginFactory {
  pluginId = "playwrightBrowser";

  constructor(
    private config: WebBrowserOptions,
    private model: BaseLanguageModel,
    private embeddings: Embeddings,
  ) {}

  async create(context: PluginContext): Promise<AgentPlugin> {
    return new WebBrowserPlugin(
      context.runtime,
      this.config,
      this.model,
      this.embeddings,
      context,
    );
  }
}

class WebBrowserPlugin extends AgentPlugin {
  driverManager: WebDriverManager;
  toolList: AgentTool[];

  constructor(
    private readonly runtime: PluginRuntimeContext,
    private config: WebBrowserOptions,
    model: BaseLanguageModel,
    embeddings: Embeddings,
    private context: PluginContext,
  ) {
    super();
    this.driverManager = new WebDriverManager(config, model, embeddings);
    this.toolList = [
      new WebBrowserTool(this.driverManager),
      new ScrollTool(this.driverManager),
      new ClickWebSiteLinkOrButton(this.driverManager),
      new PassValueToInput(this.driverManager),
    ];
  }

  async readyToProceed(message: NextMessage): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  async additionalMessageContent(
    message: NextMessageUser,
  ): Promise<AdditionalContent[]> {
    if (!(await this.driverManager.isActive())) {
      return [];
    }

    const screenshot = await this.driverManager.getScreenshot();
    await this.driverManager.refreshPageState();
    const title = await this.driverManager.getTitle();
    const url = await this.driverManager.getUrl();
    const realDimensions = await this.driverManager.getScreenDimensions();
    const resizedImaged = await resizeToDimensions(
      Buffer.from(screenshot, "base64"),
      realDimensions,
    );
    const imageWithLabels = await addLabels(
      resizedImaged,
      this.driverManager.interactableElements,
    );

    const result = await this.driverManager.obtainSummaryOfPage("", "");
    const resultWithoutIds = removeIdAttribute(result);
    const currentScrollBlock =
      await this.driverManager.calculateCurrentScrollBlock();

    await this.runtime.events.emit({
      type: "STATE",
      markdown:
        `## Current browser view:\n\n` +
        `![Current browser view](asset://smoke-state)\n\n` +
        `## Current browser view NO RESIZE:\n\n` +
        `![Current browser view](asset://no-resize)\n\n` +
        `## Current URL:\n\n` +
        "````\n" +
        url +
        "\n````\n\n\n" +
        `## List of all labels view:\n\n` +
        "````\n" +
        JSON.stringify(
          Object.fromEntries(this.driverManager.interactableElements),
        ) +
        "\n````\n\n\n" +
        `## Markdown view:\n\n` +
        "````\n" +
        result +
        "\n````",
      assets: [
        {
          id: "smoke-state",
          fileName: "browser.png",
          contentType: "image/png",
          bytes: imageWithLabels,
        },
        {
          id: "no-resize",
          fileName: "no-resize.png",
          contentType: "image/png",
          bytes: Buffer.from(screenshot, "base64"),
        },
      ],
    });

    return [
      {
        saveToChatHistory: true,
        displayOnCurrentMessage: false,
        content: [
          {
            type: "text",
            text: `The following is a page summary in markdown format of the website in the browser.:\n\nSTART OF SITE MARKDOWN:\n${resultWithoutIds}\n\nEND OF SITE MARKDOWN\n\n`,
          },
          {
            type: "text",
            text: `You are currently viewing part "${currentScrollBlock.currentBlock}" of "${currentScrollBlock.totalBlocks}", you can use the scroll tool to view other parts of the page.`,
          },
        ],
      },
      {
        saveToChatHistory: 2,
        displayOnCurrentMessage: false,
        content: [
          {
            type: "text",
            text: `The following image is a screenshot of the browser which is currently at page ${title}:`,
          },
          {
            type: "image",
            mimeType: "image/png",
            data: resizedImaged.toString("base64"),
          },
        ],
      },
      {
        saveToChatHistory: false,
        displayOnCurrentMessage: true,
        content: [
          {
            type: "text",
            text: `The following image is a screenshot of the browser which is currently at page "${title}" and the browser URL is: "${url}":`,
          },
          {
            type: "image",
            mimeType: "image/png",
            data: imageWithLabels.toString("base64"),
          },
        ],
      },
      {
        saveToChatHistory: false,
        displayOnCurrentMessage: true,
        content: [
          {
            type: "text",
            text: `The following is a page summary in markdown format of the website in the browser. You can use the IDs on "x-interactableId"'s in the elements to click or type on them. To interact with elements that are not currently visible on the screen you need scroll it into view first.\n\nSTART OF SITE MARKDOWN:\n${result}\n\nEND OF SITE MARKDOWN\n\n`,
          },
          {
            type: "text",
            text: `You are currently viewing part "${currentScrollBlock.currentBlock}" of "${currentScrollBlock.totalBlocks}", you can use the scroll tool to view other parts of the page.`,
          },
        ],
      },
    ];
  }

  async reset(): Promise<void> {
    await this.driverManager.close();
  }

  async tools(): Promise<AgentTool[]> {
    return this.toolList;
  }
}
async function resizeToDimensions(
  buffer: Buffer,
  dimensions: { width: number; height: number },
) {
  const img = sharp(buffer);
  return await img.resize(dimensions.width, dimensions.height).toBuffer();
}
async function addLabels(
  buffer: Buffer,
  coordinates: Map<string, InteractableElement>,
) {
  const img = sharp(buffer);
  const metadata = await img.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const svgElements: string[] = [];
  const labelScale = 1.15;
  const blockWidth = Math.min(42, Math.max(26, (width / 42) * labelScale));
  const blockHeight = Math.min(36, Math.max(22, (height / 44) * labelScale));
  const labelGap = Math.max(3, blockWidth * 0.18);
  const labelVerticalGap = Math.max(3, blockHeight * 0.12);
  const leaderBorderWidth = Math.max(3, blockWidth * 0.09);
  const leaderInnerWidth = Math.max(2, leaderBorderWidth * 0.5);
  const targetRadius = Math.max(3, Math.min(blockWidth, blockHeight) * 0.12);
  const collisionPadding = Math.max(
    1,
    Math.min(blockWidth, blockHeight) * 0.03,
  );
  const labelColors = [
    "#0072B2",
    "#D55E00",
    "#009E73",
    "#CC79A7",
    "#6F4E9A",
    "#C75600",
    "#008C8C",
    "#C43C65",
  ];
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  const maxLabelX = Math.max(0, width - blockWidth);
  const maxLabelY = Math.max(0, height - blockHeight);
  const placedLabels: {
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  const overlapsPlacedLabel = (candidate: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    return placedLabels.some(
      (placed) =>
        candidate.x < placed.x + placed.width + collisionPadding &&
        candidate.x + candidate.width + collisionPadding > placed.x &&
        candidate.y < placed.y + placed.height + collisionPadding &&
        candidate.y + candidate.height + collisionPadding > placed.y,
    );
  };
  const findLabelY = (labelX: number, preferredY: number) => {
    const startY = clamp(preferredY, 0, maxLabelY);
    const candidateYs = [startY];
    const step = blockHeight + labelVerticalGap;
    const attempts = 2;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      candidateYs.push(startY + step * attempt, startY - step * attempt);
    }

    for (const candidateY of candidateYs) {
      const labelY = clamp(candidateY, 0, maxLabelY);
      const candidate = {
        x: labelX,
        y: labelY,
        width: blockWidth,
        height: blockHeight,
      };

      if (!overlapsPlacedLabel(candidate)) {
        return labelY;
      }
    }

    return startY;
  };

  let labelIndex = 0;
  for (const [i, mask] of coordinates.entries()) {
    if (!mask.location.isViewable) {
      continue;
    }
    const elementTop = clamp(
      Math.min(mask.location.top, mask.location.bottom),
      0,
      height,
    );
    const elementBottom = clamp(
      Math.max(mask.location.top, mask.location.bottom),
      0,
      height,
    );
    const accentColor = labelColors[labelIndex % labelColors.length];
    labelIndex++;
    const targetX = clamp(
      mask.location.left + (mask.location.right - mask.location.left) / 2,
      0,
      width,
    );
    const targetY = clamp(
      elementTop + (elementBottom - elementTop) / 2,
      0,
      height,
    );
    const labelFitsOnLeft = targetX >= blockWidth + labelGap;
    const labelX = labelFitsOnLeft
      ? targetX - blockWidth - labelGap
      : clamp(targetX + labelGap, 0, maxLabelX);
    const labelYBelow = elementBottom + labelVerticalGap;
    const labelYAbove = elementTop - blockHeight - labelVerticalGap;
    const preferredLabelY =
      labelYBelow <= maxLabelY
        ? labelYBelow
        : labelYAbove >= 0
          ? labelYAbove
          : clamp(targetY - blockHeight / 2, 0, maxLabelY);
    const labelY = findLabelY(labelX, preferredLabelY);
    placedLabels.push({
      x: labelX,
      y: labelY,
      width: blockWidth,
      height: blockHeight,
    });
    const arrowStartX = labelFitsOnLeft ? labelX + blockWidth : labelX;
    const arrowStartY = labelY + blockHeight / 2;
    const leaderDistance = Math.hypot(
      targetX - arrowStartX,
      targetY - arrowStartY,
    );
    const leaderSvg =
      leaderDistance > Math.max(blockWidth, blockHeight) * 0.8
        ? `<line x1="${arrowStartX}" y1="${arrowStartY}" x2="${targetX}" y2="${targetY}" stroke="black" stroke-width="${leaderBorderWidth}" stroke-linecap="round" stroke-opacity="0.82" />
            <line x1="${arrowStartX}" y1="${arrowStartY}" x2="${targetX}" y2="${targetY}" stroke="${accentColor}" stroke-width="${leaderInnerWidth}" stroke-linecap="round" stroke-opacity="0.95" />`
        : "";

    svgElements.push(`${leaderSvg}
            <svg width="${blockWidth}px" height="${blockHeight}px" preserveAspectRatio="xMinYMin" x="${labelX}"  y="${labelY}">
            <rect width="100%" height="100%" fill="white" fill-opacity="0.86" style="stroke-width:4;stroke:rgb(0,0,0)" />
            <rect x="3" y="3" width="${Math.max(0, blockWidth - 6)}" height="${Math.max(0, blockHeight - 6)}" fill="none" stroke="${accentColor}" stroke-width="3" />
            <text x="50%" y="60%" width="100%" height="100%" text-anchor="middle"  alignment-baseline="central" font-family="monospace" dominant-baseline="central" font-weight="bold" font-size="${blockWidth / 2.7}px">${i}</text>
        
    </svg>
            <circle cx="${targetX}" cy="${targetY}" r="${targetRadius + 3}" fill="white" fill-opacity="0.78" stroke="black" stroke-width="2" />
            <circle cx="${targetX}" cy="${targetY}" r="${targetRadius}" fill="none" stroke="${accentColor}" stroke-width="3" />
            <circle cx="${targetX}" cy="${targetY}" r="${Math.max(2, targetRadius * 0.35)}" fill="black" />`);
  }
  const overlaySvg = `<svg height="${height}" width="${width}">${svgElements.join("")}</svg>`;

  const overlayBuffer = Buffer.from(overlaySvg);
  return await img
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .toBuffer();
}

function removeIdAttribute(str: string) {
  return str.replace(/x-interactableId="\d+"/g, "");
}
