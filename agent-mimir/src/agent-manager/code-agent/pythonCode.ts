

function getPythonFunction(functionName: string): string {
    return `
async def ${functionName}(args:dict):
    result = await asyncio.create_task(ws_channel.call("${functionName}", args=args))
    return result.result
\n`
}



export function getPythonScript(port: number, tools: string[], code: string): string {
    return `
import uvicorn
from fastapi import FastAPI
from fastapi_websocket_rpc import RpcMethodsBase, WebsocketRPCEndpoint, RpcChannel
import asyncio
import logging
logger = logging.getLogger(__name__)

logging.basicConfig(level=logging.ERROR)

server: uvicorn.Server | None = None
# An event to signal that the work is done and shutdown can commence
shutdown_event = asyncio.Event()

ws_channel: RpcChannel | None = None


${tools.map(tool => getPythonFunction(tool)).join('\n')}


async def allow_queries(args:dict):
    result = await asyncio.create_task(ws_channel.call("allow_queries", args=args))
    return result.result

async def do_work():
    """Performs the main task and signals for shutdown."""
    try:
${indentText(code, '        ')}
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


function indentText(text: string, indent = '    '): string {
    return text
        .split('\n')
        .map(line => indent + line)
        .join('\n');
}