import { toPythonFunctionName } from "../utils.js";


function getPythonFunction(functionName: string): string {
    return `
def ${toPythonFunctionName(functionName)}(args:dict):
    result = asyncio.run(ws_channel.call("${functionName}", args=args))
    call_value = result.result["value"]
    if result.result["error"]:
        raise Exception(f"Error in function call ${toPythonFunctionName(functionName)}: {call_value}")
    return call_value
\n`
}


export function getPythonScript(port: number, tools: string[], code: string, wsPath: string, wsFile: string[]): string {
    return `
from typing import IO, Iterator, Dict
import uvicorn
from fastapi import FastAPI
from fastapi_websocket_rpc import RpcMethodsBase, WebsocketRPCEndpoint, RpcChannel
import asyncio
import logging
import nest_asyncio
from pathlib import Path
nest_asyncio.apply()

from contextlib import contextmanager

logger = logging.getLogger(__name__)

logging.basicConfig(level=logging.ERROR)

server: uvicorn.Server | None = None
# An event to signal that the work is done and shutdown can commence
shutdown_event = asyncio.Event()

# WebSocket connection channels
ws_channel: RpcChannel | None = None  # For /ws endpoint
fs_channel: RpcChannel | None = None  # For /ws2 endpoint

workspace_files = ${JSON.stringify(wsFile)}  # Example file names


@contextmanager
def open_workspace_file(args: Dict) -> Iterator[IO]:
    file_name = args.get("name")
    mode = args.get("mode", 'r')
    if file_name in workspace_files:
        asyncio.run(fs_channel.call("load_file", args={"name": file_name}))
    file = open(Path('${wsPath}') / file_name, mode)
    try:
        yield file
    finally:
        file.close()
        asyncio.run(fs_channel.call("save_file", args={"name": file_name}))

${tools.map(tool => getPythonFunction(tool)).join('\n')}

async def check_and_start_work():
    """Check if both websocket connections are established and start work if they are."""
    global ws_channel, fs_channel
    if ws_channel is not None and fs_channel is not None:
        print("Both websocket connections established. Starting work...")
        # Start the main task without blocking the connection handler
        asyncio.create_task(do_work())


async def do_work():
    """Performs the main task and signals for shutdown."""
    global ws_channel, fs_channel
    try:
        print("Executing code...")
${indentText(code, '        ')}
        print("Code execution completed.")
        pass
    except Exception as e:
        print(f"Error in executing code: {e}")
    finally:
        # Close both WebSocket channels
        for i, channel in enumerate([ws_channel, fs_channel], 1):
            if channel:
                try:
                    await channel.close()
                except Exception as e:
                    print(f"Error closing WebSocket channel {i}: {e}")
        
        # Signal that the work is complete and server should shut down
        shutdown_event.set()

# --- WebSocket Connection Handling ---
async def on_connect(channel: RpcChannel):
    """Handles new WebSocket connections on /ws endpoint."""
    global ws_channel
    # Store the connection if it's the first one
    if ws_channel is None:
        ws_channel = channel
        print("Client connected to /ws endpoint!")
        # Check if both connections are ready
        await check_and_start_work()
    else:
        print("Rejecting duplicate connection to /ws")
        await channel.close()

async def another_on_connect(channel: RpcChannel):
    """Handles new WebSocket connections on /ws2 endpoint."""
    global fs_channel
    # Store the connection if it's the first one
    if fs_channel is None:
        fs_channel = channel
        # Check if both connections are ready
        await check_and_start_work()
    else:
        await channel.close()

# --- FastAPI App Setup ---
app = FastAPI()
# Define the RPC endpoint (can be simplified if no server-side methods are needed)
class EmptyMethods(RpcMethodsBase):
    pass

# First endpoint for /ws
endpoint1 = WebsocketRPCEndpoint(EmptyMethods(), on_connect=[on_connect])
endpoint1.register_route(app, "/ws")

# Second endpoint for /ws2
endpoint2 = WebsocketRPCEndpoint(EmptyMethods(), on_connect=[another_on_connect])
endpoint2.register_route(app, "/ws2")

async def main():
    logging.getLogger("fastapi_ws_rpc").setLevel(logging.WARNING)
    """Sets up and runs the Uvicorn server."""
    global server
    config = uvicorn.Config(
        app=app,
        host="0.0.0.0",
        port=${port},
        log_level="warning",
        ws_max_size=16 * 1024 * 1024 # Example: Set max websocket message size if needed
        # Add other Uvicorn config options here if necessary
    )
    server = uvicorn.Server(config)

    # Start the server in the background
    serve_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    logging.getLogger().setLevel(logging.INFO)
    logger.info("INITIALIZED SERVER")


    # Wait until the shutdown event is set by do_work()
    await shutdown_event.wait()

    # Signal Uvicorn to gracefully shutdown
    server.should_exit = True

    # Give the server a moment to process the signal and shutdown tasks
    # You might need to adjust this delay or use server.shutdown() with awaits
    # if more complex cleanup is needed within Uvicorn/FastAPI's lifespan.
    await asyncio.sleep(0.1)

    # Wait for the server task to complete its shutdown
    await serve_task
    

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Shutdown requested by user (Ctrl+C).")

`
}


function indentText(text: string, prefix: string) {
    let inLiteral = false;
  
    return text
      .split('\n')
      .map(line => {
        // count how many times """ appears on this line
        const matches = line.match(/"""/g) || [];
        const tripleCount = matches.length;
  
        // if there's at least one """ on this line, we must prefix it
        // (so the quotes stay indented under your async def)
        if (tripleCount > 0) {
          // prefix the line…
          const out = prefix + line;
          // …and toggle our “inLiteral” state once for each odd occurrence
          if (tripleCount % 2 === 1) inLiteral = !inLiteral;
          return out;
        }
  
        // no quotes here:
        //  - if we’re inside a literal, emit the line _as is_
        //  - otherwise, prefix it
        return inLiteral ? line : prefix + line;
      })
      .join('\n');
  }