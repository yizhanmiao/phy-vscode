export interface VsCodeApi<S> {
  postMessage(message: unknown): void;
  getState(): S | undefined;
  setState(state: S): void;
}
declare function acquireVsCodeApi<S>(): VsCodeApi<S>;
/** Call once per webview page. */
export const vscodeApi = <S>(): VsCodeApi<S> => acquireVsCodeApi<S>();
