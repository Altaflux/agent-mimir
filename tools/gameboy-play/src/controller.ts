import robotjs from '@jitsi/robotjs';
import { windowManager } from 'node-window-manager';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp'; // For image manipulation (cropping, saving as JPEG)
import * as fs from 'fs';


// Interfaces
interface Controls {
  [key: string]: string;
}

interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Action {
  type: string;
  button?: string;
  buttons?: string[];
  direction?: string;
  steps?: number;
}

class GameboyController {
  private windowTitle?: string;
  private region?: Region;
  private keyDelay: number;
  private controls: Controls;


  constructor(windowTitle?: string, region?: Region) {
    this.windowTitle = windowTitle;
    this.region = region;
    this.keyDelay = 100; // Delay in milliseconds (equivalent to 0.1s in Python)
    
    // GameBoy control mapping for robotjs
    this.controls = {
      'up': 'up',
      'down': 'down',
      'left': 'left',
      'right': 'right',
      'a': 'x',      // Typically X is mapped to A on emulators
      'b': 'z',      // Typically Z is mapped to B on emulators
      'start': 'enter',
      'select': 'backspace'
    };
  }

  findWindow() {
    if (!this.windowTitle) {
      return null;
    }
    
    try {
      // Get all windows
      const windows = windowManager.getWindows();
      
      // Find the window that matches our title
      for (const window of windows) {
        const title = window.getTitle();
        if (title && title.includes(this.windowTitle)) {
          return window;
        }
      }
      
      console.log(`No window with title containing '${this.windowTitle}' found.`);
    } catch (e) {
      console.log(`Error finding window: ${e}`);
    }
    
    return null;
  }
  async captureScreen(): Promise<Buffer> {
    try {

      const window = this.findWindow();
      // First, capture the entire screen
      const screenshotBuffer = await screenshot({screen: (window?.getMonitor() as any).id});
      console.log("Captured entire screen");
      
      // Process the full screenshot
      let imageProcessor = sharp(screenshotBuffer);
      
      // If we have a window, extract just that region
      
      if (window) {
        try {
          // Try to bring window to front
          window.bringToTop();
          await new Promise(resolve => setTimeout(resolve, 200)); // Give window time to come to front
          
          const bounds = window.getBounds();

          const mon = (window?.getMonitor() as any);
          // const scaleFactor = mon.getScaleFactor() || 1;
          const scaleFactor = (mon.getScaleFactor() * mon.getScaleFactor()) || 1;
  
          // Extract just the window region from the full screenshot
          imageProcessor = imageProcessor.extract({
            left: Math.floor(bounds.x! * scaleFactor),
            top: Math.floor(bounds.y!  * scaleFactor),
            width: Math.floor(bounds.width! * scaleFactor),
            height: Math.floor(bounds.height! * scaleFactor)
          });
          
          console.log(`Extracted window: ${this.windowTitle}`);
        } catch (e) {
          console.log(`Error extracting window region: ${e}`);
        }
      } else if (this.region) {
        // Extract the specified region if no window was found but region is defined
        imageProcessor = imageProcessor.extract({
          left: this.region.left,
          top: this.region.top,
          width: this.region.right - this.region.left,
          height: this.region.bottom - this.region.top
        });
        console.log("Extracted specified region");
      }
      
      // Save the processed image as JPEG
     // await imageProcessor.jpeg().toFile(filename);
      return await imageProcessor.toBuffer();
    } catch (e) {
      console.error(`Error capturing screen: ${e}`);
      throw e;
    }
  }

  

  async pressButton(button: string, holdTime = 100): Promise<boolean> {
    // Try to focus the window before pressing keys
    const window = this.findWindow();
    if (window) {
      try {
        window.bringToTop();
        await new Promise(resolve => setTimeout(resolve, 100)); // Short delay
      } catch (e) {
        console.log(`Error focusing window: ${e}`);
      }
    }
    
    if (button in this.controls) {
      const key = this.controls[button];
      robotjs.keyToggle(key, 'down');
      await new Promise(resolve => setTimeout(resolve, holdTime));
      robotjs.keyToggle(key, 'up');
      await new Promise(resolve => setTimeout(resolve, this.keyDelay)); // Short delay after button press
      return true;
    } else {
      console.log(`Unknown button: ${button}`);
      return false;
    }
  }

  async executeAction(action: Action): Promise<boolean> {
    const actionType = action.type || '';
    
    if (actionType === 'button_press' && action.button) {
      return await this.pressButton(action.button);
    } 
    else if (actionType === 'sequence' && action.buttons) {
      // Execute a sequence of button presses
      for (const button of action.buttons) {
        await this.pressButton(button);
      }
      return true;
    } 
    else if (actionType === 'navigate' && action.direction) {
      // Navigate in a direction
      const steps = action.steps || 1;
      
      for (let i = 0; i < steps; i++) {
        await this.pressButton(action.direction);
      }
      return true;
    }
    
    return false;
  }
}

function readImageToBase64(imagePath: string): string {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (e) {
    throw new Error(`Error reading image file: ${e}`);
  }
}

// Export the class and function
export { GameboyController as GameboyController, readImageToBase64 };