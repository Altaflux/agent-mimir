
import { LocalPythonExecutor } from './local-executor.js';
import { AgentTool } from "../../../tools/index.js";

async function runTest() {
    console.log("Starting Verification Test...");

    const executor = new LocalPythonExecutor({
        additionalPackages: []
    });

    const mockTool: AgentTool = {
        name: "mock_tool",
        description: "mock tool",
        call: async () => "mock result"
    } as any;

    const code = "print('Hello World')";
    const callback = () => { };

    console.log("\n--- Execution 1: Installing 'requests' ---");
    // This should trigger installation of 'requests'
    await executor.execute([mockTool], code, ['requests'], callback);

    console.log("\n--- Execution 2: 'requests' again ---");
    // This should NOT trigger installation of 'requests'
    await executor.execute([mockTool], code, ['requests'], callback);

    console.log("\n--- Execution 3: 'requests' and 'colorama' ---");
    // This should trigger installation of 'colorama' ONLY
    await executor.execute([mockTool], code, ['requests', 'colorama'], callback);

    console.log("\nTest Complete.");
}

runTest().catch(console.error);
