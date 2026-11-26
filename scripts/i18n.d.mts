export declare const LANGS: string[];
export declare function keysIn(targets: string[]): Map<string, string>;
export declare function catalog(lang: string): { files: string[]; words: Record<string, string> };
export declare function problems(targets?: string[]): string[];
export declare function writeIndex(): void;
export declare function conflicts(): string[];
