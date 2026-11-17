export interface ParsedParam { name: string; type: string; enum?: string; oneOf?: string[] }
export interface ParsedMethod { name: string; params: ParsedParam[]; returns: string }
export function parseSignature(sig: string, enums?: Record<string, string[]>): ParsedMethod;
