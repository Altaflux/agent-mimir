
import sharp from 'sharp';
import envPaths from 'env-paths';
import { ChildProcess, spawn } from 'child_process';

import exitHook from 'async-exit-hook';
import net, { AddressInfo } from "net";



export class MolmoServerControl {

    private process: ChildProcess | null = null;

    private port: number = 8000;

    async init() {
        console.log("Starting MOLMO server.")
        const dataDir = envPaths("mimir-desktop-control").data
        const port = await getPortFree();
        this.port = port;
        const command = `cd ${dataDir} && docker-compose up `;
        const result = spawn(command, [], {
            shell: true, env: {
                ...process.env,
                PORT: port.toString()
            }
        });

        result.stdout.pipe(process.stdout);
        result.stderr.pipe(process.stderr);

        this.process = result;

        exitHook(async (callback) => {
            console.log("Closing MOLMO server.")
            await this.close();
            callback();
        });
    }

    async close() {
        if (this.process) {
            this.process.kill("SIGINT")
            this.process = null;
        }
    }


    async locateItem(screenshotImage: Buffer, description: string, imageWidth: number, imageHeight: number): Promise<{
        x: number,
        y: number
    }> {
       
        const requestBody = {
            model: "allenai/Molmo-7B-D-0924",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Point to the position of: "${description}", it may be close to the current position of the mouse pointer if the mouse is visible.`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${screenshotImage.toString("base64")}`
                            }
                        }
                    ]
                }
            ]
        };

        const url = `http://localhost:${this.port}/v1/chat/completions`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Extract the point coordinates from the response
            const message = data.choices[0].message;
            if (message.content) {
                // Parse the point coordinates using regex
                const pointMatch = message.content.match(/<point x="([\d.]+)" y="([\d.]+)"/);
                if (pointMatch) {
                    const [, x, y] = pointMatch;
                    console.log('Element position:', { x: parseFloat(x), y: parseFloat(y) });
                    const coordinates = translateCoordinates(parseFloat(x), parseFloat(y), imageWidth, imageHeight);
                    return coordinates;
                } else {
                    console.log('No poiunt in the response:', message.content);
                    const errorMessage = 'No content in the response:' + message.content;
                    throw new Error(errorMessage);
                }
            } else {
                const errorMessage = 'No content in the response:' + JSON.stringify(data, null, 2);
                console.log('No content in the response:', JSON.stringify(data, null, 2));
                throw new Error(errorMessage);
            }



        } catch (error) {
            console.error('Error:', error);
            throw error;
        }

    }





}




function translateCoordinates(x: number, y: number, imageWidth: number, imageHeight: number) {
    // Translate coordinates to 0-100 scale
    const normalizedX = ((x / 100) * imageWidth)
    const normalizedY = (y / 100) * imageHeight;

    // Ensure values are between 0-100 and round to 1 decimal place
    return {
        x: Math.floor(normalizedX),
        y: Math.floor(normalizedY)
    };
}

async function getPortFree(): Promise<number> {
    return new Promise(res => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = (srv.address()! as AddressInfo).port
            srv.close((err) => res(port))
        });
    })
}


