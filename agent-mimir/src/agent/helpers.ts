import { Agent } from "../schema.js";


export type HelperManager = {
    getAllHelpers(): Promise<Agent[]>;
}