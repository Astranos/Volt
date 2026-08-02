export type ComputerRegistrationTimers = {
  setInterval: (callback: () => void, delayMs: number) => number;
  clearInterval: (id: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (id: number) => void;
};

type ComputerRegistrationHeartbeatOptions = {
  attempt: () => Promise<unknown>;
  intervalMs: number;
  retryDelayMs: number;
  timers: ComputerRegistrationTimers;
  onError: (error: unknown) => void;
};

/**
 * Keeps computer presence fresh without allowing failures to create recursive
 * retry chains. Each scheduled heartbeat may make one short auth-race retry.
 */
export function createComputerRegistrationHeartbeat(
  options: ComputerRegistrationHeartbeatOptions,
) {
  let generation = 0;
  let running = false;
  let intervalId: number | null = null;
  let retryId: number | null = null;
  const inFlightGenerations = new Set<number>();

  const attemptRegistration = async (
    activeGeneration: number,
    allowRetry: boolean,
  ) => {
    if (
      !running
      || activeGeneration !== generation
      || inFlightGenerations.has(activeGeneration)
    ) return;

    inFlightGenerations.add(activeGeneration);
    try {
      await options.attempt();
    } catch (error) {
      options.onError(error);
      if (
        allowRetry
        && running
        && activeGeneration === generation
        && retryId === null
      ) {
        retryId = options.timers.setTimeout(() => {
          retryId = null;
          void attemptRegistration(activeGeneration, false);
        }, options.retryDelayMs);
      }
    } finally {
      inFlightGenerations.delete(activeGeneration);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      const activeGeneration = ++generation;
      intervalId = options.timers.setInterval(() => {
        void attemptRegistration(activeGeneration, true);
      }, options.intervalMs);
      void attemptRegistration(activeGeneration, true);
    },
    stop() {
      if (!running) return;
      running = false;
      generation += 1;
      if (intervalId !== null) {
        options.timers.clearInterval(intervalId);
        intervalId = null;
      }
      if (retryId !== null) {
        options.timers.clearTimeout(retryId);
        retryId = null;
      }
    },
  };
}
