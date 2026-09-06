export interface DiagnosticEvent {
  readonly name: string;
  readonly at: number;
  readonly durationMs?: number;
  readonly operation?: string;
  readonly account?: string;
  readonly requests?: number;
  readonly stopReason?: string;
}

export type DiagnosticListener = (event: DiagnosticEvent) => void;
