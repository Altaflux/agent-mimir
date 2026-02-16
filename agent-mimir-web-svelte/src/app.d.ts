declare global {
    namespace App {
        interface Error {
            code?: string;
            message: string;
        }
    }
}

export {};
