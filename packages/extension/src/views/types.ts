import type { CancellationToken, ViewResult } from '@phy-vscode/api';
import type { Compute } from '../compute';
import type { Session } from '../host/session';

export interface HostViewContext {
  readonly session: Session;
  readonly compute: Compute;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** A built-in view's data side; its renderer is added in Plan 2. */
export interface BuiltinView {
  id: string;
  title: string;
  provider(ctx: HostViewContext, token: CancellationToken): Promise<ViewResult>;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export function checkCancel(token: CancellationToken): void {
  if (token.isCancellationRequested) throw new Cancelled();
}
