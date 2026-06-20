import type {
  RuntimeMessage,
  RuntimeMessageSender,
  RuntimeSendResponse,
} from "./messages";

export type LogFn = (...args: unknown[]) => void;

export type RuntimeActionHandler<TMessage extends RuntimeMessage = RuntimeMessage> = (
  message: TMessage,
  sender: RuntimeMessageSender,
  sendResponse: RuntimeSendResponse
) => boolean | void;

export type RuntimeActionRegistry = ReturnType<typeof createRuntimeActionRegistry>;

export function createRuntimeActionRegistry() {
  const handlers = new Map<string, RuntimeActionHandler>();

  function register<TAction extends Extract<RuntimeMessage, { action: string }>["action"]>(
    actions: TAction | TAction[],
    handler: RuntimeActionHandler<Extract<RuntimeMessage, { action: TAction }>>
  ) {
    for (const action of Array.isArray(actions) ? actions : [actions]) {
      handlers.set(action, handler as RuntimeActionHandler);
    }
  }

  function handle(
    message: RuntimeMessage,
    sender: RuntimeMessageSender,
    sendResponse: RuntimeSendResponse
  ) {
    if (!("action" in message)) return false;
    const handler = handlers.get(message.action);
    if (!handler) return false;
    const result = handler(message, sender, sendResponse);
    return result !== false;
  }

  return {
    handle,
    register,
  };
}
