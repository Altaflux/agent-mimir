import { AgentPlugin, PluginFactory, PluginContext, AgentSystemMessage } from "agent-mimir/plugins";
import { AgentTool, ToolResponse } from "agent-mimir/tools";

import { z } from "zod";
import Sqlite from 'better-sqlite3';

type SqliteConfig = {
    dbPath: string;
    description: string;
}
export class SqliteToolPluginFactory implements PluginFactory {
    name: string = "sqlite_tool_plugin";
    constructor(private args: SqliteConfig) {
    }


    create(context: PluginContext): Promise<AgentPlugin> {
        return Promise.resolve(new SqliteToolPlugin(this.args));
    }
}


class SqliteToolPlugin extends AgentPlugin {
    private db: Sqlite.Database;
    constructor(private args: SqliteConfig) {
        super();
        this.db = new Sqlite(this.args.dbPath);
    }

    
    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: [
                {
                    type: "text",
                    text: `You have access to a SQLite database which can be queried using sqlite tools. The description of the database is ${this.args.description}`
                }
            ]
        }
    }

    async tools(): Promise<(AgentTool)[]> {
        return Promise.resolve([
            new DescribeTableCommand(this.db),
            new ListTableCommand(this.db),
            new ExecuteQueryCommand(this.db)
        ]);
    }
}
class DescribeTableCommand extends AgentTool {

    schema = z.object({
        tableName: z.string().describe("The name of the table to describe."),
    });

    constructor(private db: Sqlite.Database) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {
        let tableName = inputs.tableName;
        if (!(tableName.startsWith("[") && tableName.endsWith("]"))) {
            tableName = `[${tableName}]`;
        }

        const sql = `PRAGMA table_info(${tableName});`;
        const stmt = this.db.prepare(sql);
        const columns = stmt.all(); // No parameters needed here
        return [
            {
                type: "text",
                text: JSON.stringify(columns)
            }
        ];
    }

    name: string = "sqlite_describe_table";
    description: string = "Get the schema information for a specific table";
    outSchema = z.array(z.object({
        "cid": z.number(),
        "name": z.string(),
        "type": z.string(),
        "notnull": z.number(),
        "dflt_value": z.string().nullable(),
        "pk": z.number(),
    }))
}

class ListTableCommand extends AgentTool {

    schema = z.object({});

    constructor(private db: Sqlite.Database) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {
        const stmt = this.db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name;
          `);
        const tables = stmt.pluck().all();

        return [
            {
                type: "text",
                text: JSON.stringify(tables)
            }
        ];
    }

    name: string = "sqlite_list_tables";
    description: string = "List all tables in the SQLite database";

    outSchema = z.array(z.string()).describe("The list of tables in the database.");

}


class ExecuteQueryCommand extends AgentTool {

    schema = z.object({
        query: z.string().describe("The SQL query to execute."),
    });

    constructor(private db: Sqlite.Database) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {
        const stmt = this.db.prepare(inputs.query);
        const results = stmt.all([]);

        return [
            {
                type: "text",
                text: JSON.stringify(results)
            }
        ];
    }

    name: string = "sqlite_read_query";
    description: string = "Execute a read query on the SQLite database";

    outSchema = z.array(z.record(z.any())).describe("The results of the query.");
}