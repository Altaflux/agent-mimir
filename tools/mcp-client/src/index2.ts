// import { MultiServerMCPClient, loadMcpTools } from "@langchain/mcp-adapters";
// export { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
// export { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// export { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
// import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"


// export async function foo() {

//     const client = new MultiServerMCPClient({
//         math: {
//             transport: "stdio",  // Local subprocess communication
//             command: "node",
//             // Replace with absolute path to your math_server.js file
//             args: ["/path/to/math_server.js"],
//         },
//         weather: {
//             transport: "http",  // HTTP-based remote server
//             // Ensure you start your weather server on port 8000
//             url: "http://localhost:8000/mcp",
//         },
//     });
//     client.getClient()
//     const tools = await client.getTools();  
// }