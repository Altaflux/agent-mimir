# javascript-code-runner

A langchain javascript code runner. Runs the javascript code in a sandboxed environment.

## Usage:
```javascript
  
    const JavascriptCodeRunner = require('@agent-mimir/javascript-code-runner').JavascriptCodeRunner;

    //Add to agents tool:
    tools: [
            new JavascriptCodeRunner(),
        ],
```