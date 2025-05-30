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


export function getPythonScript(port: number, tools: string[], code: string): string {
    return `
import uvicorn
from fastapi import FastAPI
from fastapi_websocket_rpc import RpcMethodsBase, WebsocketRPCEndpoint, RpcChannel
import asyncio
import logging
import nest_asyncio

nest_asyncio.apply()

logger = logging.getLogger(__name__)

logging.basicConfig(level=logging.ERROR)

server: uvicorn.Server | None = None
# An event to signal that the work is done and shutdown can commence
shutdown_event = asyncio.Event()

ws_channel: RpcChannel | None = None


${tools.map(tool => getPythonFunction(tool)).join('\n')}


async def do_work():
    """Performs the main task and signals for shutdown."""
    try:
        print("Executing code...")
${indentText(code, '        ')}
        print("Code execution completed.")
        pass
    except Exception as e:
        print(f"Error in executing code: {e}")
    finally:
        if ws_channel:
            try:
                await ws_channel.close()
            except Exception as e:
                print(f"Error closing WebSocket channel: {e}")
        # Signal that the work is complete and server should shut down
        shutdown_event.set()

# --- WebSocket Connection Handling ---
async def on_connect(channel: RpcChannel):
    """Handles new WebSocket connections."""
    global ws_channel
    # Ensure only the first connection triggers the work
    if ws_channel is None:
        ws_channel = channel
        # Start the main task without blocking the connection handler
        asyncio.create_task(do_work())
    else:
        await channel.close()

# --- FastAPI App Setup ---
app = FastAPI()
# Define the RPC endpoint (can be simplified if no server-side methods are needed)
class EmptyMethods(RpcMethodsBase):
    pass

endpoint = WebsocketRPCEndpoint(EmptyMethods(), on_connect=[on_connect])
endpoint.register_route(app, "/ws")

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