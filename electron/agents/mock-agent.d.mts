/** Types for the plain-JS fixture helpers in mock-agent.mjs (test-only). */
export declare function rewriteFixtureSessionId(line: string, sessionId: string): string;
export declare function isFixtureTurnMarker(line: string): boolean;
export declare function isFixtureTurnBoundary(line: string): boolean;
export declare function splitFixtureTurns(lines: string[]): string[][];
