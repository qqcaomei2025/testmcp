
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ollama, Tool } from "ollama";
import dotenv from "dotenv";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as readline from "node:readline";
import { json } from "node:stream/consumers";

dotenv.config();

class MCPClient {
  private client: Client | null = null;
  private ollama: Ollama;
  private transport: StdioClientTransport | null = null;

  constructor() {

    this.ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
  }

  async connectToServer(serverScriptPath: string): Promise<void> {
    const command = serverScriptPath.endsWith(".py") ? "python3" : "node";

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });

    this.client = new Client({ name: "mcp-client", version: "1.0.0" }, { capabilities: {} });
    await this.client.connect(this.transport);

    const toolsResponse = await this.client.request(
      { method: "tools/list" },
      ListToolsResultSchema
    );

    console.log("Connected to server with tools:", toolsResponse.tools.map((tool: any) => tool.name));
  }

  formatTools(tools: any[]) {
    return tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: tool.inputSchema.properties,
                required: tool.inputSchema.required,
                additionalProperties: false,
            },
        },
    }));
  }

  async processQuery(query: string): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const toolsResponse = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
    const formattedTools = this.formatTools(toolsResponse.tools);
    console.log("formattedTools=", JSON.stringify(formattedTools));
    let messages: any[] = [{ role: "user", content: query
     }];
    const textResponses: string[] = [];
    let response = await this.ollama.chat({
      model: 'llama3.2',
      messages,
      tools: formattedTools,
    });

        const content = response.message.content;
        console.log("tool_calls=", response.message.tool_calls);
        if (content) {
            textResponses.push(content);
        }
        const tools = response.message.tool_calls;
        if (tools?.length) {
            for (const tool of tools) {
                try {
                    const toolResult = await this.client?.callTool(
                        {name: tool.function.name, arguments: tool.function.arguments},
                    )
                    console.log("toolResult=", toolResult);
                    messages.push({ role: "assistant", content: response.message.content });
                    const toolContent = toolResult?.content || [];
                    let tc = "";
                    if (typeof( toolContent) === "string") {
                        tc = toolContent;
                    } else if (Array.isArray(toolContent)) {
                        tc = toolContent.map((item) => JSON.stringify(item)).join(", ");
                    }
                      messages.push({
                        role: "user",
                        content: tc,
                      
                      });
                      response = await this.ollama.chat({
                        model: "llama3.2",
                        messages,
                      });
                      if (response.message.content) {
                        textResponses.push(response.message.content);
                      }
                } catch (error) {
                    
                }

            }
        }

    
    console.log("textResponses=", JSON.stringify(textResponses));
    return textResponses.join("\n");
  }

  async chatLoop(): Promise<void> {
    console.log("\nMCP Client Started! Type your queries or 'quit' to exit.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const ask = () => {
      rl.question("\nQuery: ", async (query) => {
        if (query.toLowerCase() === "quit") {
          await this.cleanup();
          rl.close();
          return;
        }
        const response = await this.processQuery(query);
        console.log("\n" + response);
        ask();
      });
    };

    ask();
  }

  async cleanup(): Promise<void> {
    if (this.transport) await this.transport.close();
  }
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.log("Usage: ts-node client.ts <server_script>");
    process.exit(1);
  }

  const client = new MCPClient();
  await client.connectToServer(path);
  await client.chatLoop();
}

main();