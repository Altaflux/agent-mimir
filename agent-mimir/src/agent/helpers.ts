import { BaseChain } from "langchain/chains";
import { Helper } from "../schema.js";


export type HelperManager = {
    getAllHelpers(): Promise<Helper[]>;
}